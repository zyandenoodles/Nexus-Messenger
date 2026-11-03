import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { createClient } from "@supabase/supabase-js";
import { MessageCircle, Users, Plus, LogOut, Send, Search, Hash, UserRound, Menu, X, Copy, Check, Radio } from "lucide-react";
import "./style.css";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

function App() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [authMode, setAuthMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(null);
  const [chats, setChats] = useState([]);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [newMode, setNewMode] = useState("dm");
  const [target, setTarget] = useState("");
  const [roomName, setRoomName] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [copied, setCopied] = useState(false);
  const [mobileSidebar, setMobileSidebar] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, current) => setSession(current));
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session?.user) { setProfile(null); setChats([]); setActive(null); return; }
    loadProfile();
  }, [session?.user?.id]);

  async function loadProfile() {
    const { data } = await supabase.from("profiles").select("*").eq("id", session.user.id).maybeSingle();
    if (data) setProfile(data);
  }

  useEffect(() => {
    if (!session || !profile) return;
    loadChats();
  }, [session?.user?.id, profile?.id]);

  async function loadChats() {
    const uid = session.user.id;
    const [{ data: conversations }, { data: memberships }] = await Promise.all([
      supabase.from("conversations").select("*").or(`user_a.eq.${uid},user_b.eq.${uid}`).order("created_at", { ascending: false }),
      supabase.from("room_members").select("room_id").eq("user_id", uid)
    ]);
    const dmItems = [];
    for (const c of conversations || []) {
      const other = c.user_a === uid ? c.user_b : c.user_a;
      const { data: p } = await supabase.from("profiles").select("username").eq("id", other).maybeSingle();
      dmItems.push({ id: c.id, kind: "dm", title: p?.username || "Unknown user", otherId: other, created_at: c.created_at });
    }
    const roomItems = [];
    for (const m of memberships || []) {
      const { data: r } = await supabase.from("rooms").select("*").eq("id", m.room_id).maybeSingle();
      if (r) roomItems.push({ id: r.id, kind: "room", title: r.name, code: r.code, created_at: r.created_at });
    }
    setChats([...roomItems, ...dmItems]);
  }

  useEffect(() => {
    setMessages([]);
    if (!active || !session) return;
    const column = active.kind === "dm" ? "conversation_id" : "room_id";
    const load = async () => {
      const { data, error: e } = await supabase.from("messages").select("*, profiles:sender_id(username)")
        .eq(column, active.id).order("created_at", { ascending: true }).limit(300);
      if (!e) setMessages(data || []);
    };
    load();
    const channel = supabase.channel(`messages-${active.kind}-${active.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `${column}=eq.${active.id}` }, async (payload) => {
        const { data } = await supabase.from("profiles").select("username").eq("id", payload.new.sender_id).maybeSingle();
        setMessages(prev => prev.some(m => m.id === payload.new.id) ? prev : [...prev, { ...payload.new, profiles: data }]);
      }).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [active?.id, active?.kind, session?.user?.id]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  async function startDM(e) {
    e.preventDefault(); setError("");
    const clean = target.trim().toLowerCase();
    const { data: p, error: pe } = await supabase.from("profiles").select("id,username").eq("username", clean).maybeSingle();
    if (pe || !p) { setError("No account found for that username."); return; }
    if (p.id === session.user.id) { setError("You can't start a private chat with yourself."); return; }
    const [a,b] = [session.user.id,p.id].sort();
    let { data: c } = await supabase.from("conversations").select("*").eq("user_a", a).eq("user_b", b).maybeSingle();
    if (!c) {
      const { data, error: ce } = await supabase.from("conversations").insert({ user_a: a, user_b: b }).select().single();
      if (ce) { setError(ce.message); return; }
      c = data;
    }
    const item = { id: c.id, kind: "dm", title: p.username, otherId: p.id };
    setChats(prev => prev.some(x => x.id === c.id) ? prev : [item, ...prev]);
    setActive(item); setShowNew(false); setTarget(""); setMobileSidebar(false);
  }

  async function createRoom(e) {
    e.preventDefault(); setError("");
    const code = Math.random().toString(36).slice(2, 8).toUpperCase();
    const { data: r, error: re } = await supabase.from("rooms").insert({ name: roomName.trim() || "New room", code, created_by: session.user.id }).select().single();
    if (re) { setError(re.message); return; }
    const { error: me } = await supabase.from("room_members").insert({ room_id: r.id, user_id: session.user.id });
    if (me) { setError(me.message); return; }
    const item = { id: r.id, kind: "room", title: r.name, code: r.code };
    setChats(prev => [item, ...prev]); setActive(item); setShowNew(false); setRoomName(""); setMobileSidebar(false);
  }

  async function joinRoom(e) {
    e.preventDefault(); setError("");
    const { data: r, error: re } = await supabase.rpc("join_room", { room_code: roomCode.trim() });
    if (re || !r) { setError(re?.message || "Room code not found."); return; }
    const item = { id: r.id, kind: "room", title: r.name, code: r.code };
    setChats(prev => prev.some(x => x.id === r.id) ? prev : [item, ...prev]); setActive(item); setShowNew(false); setRoomCode(""); setMobileSidebar(false);
  }

  async function sendMessage(e) {
    e.preventDefault();
    const body = draft.trim();
    if (!body || !active) return;
    setDraft("");
    const payload = { sender_id: session.user.id, body, conversation_id: active.kind === "dm" ? active.id : null, room_id: active.kind === "room" ? active.id : null };
    const { error: e1 } = await supabase.from("messages").insert(payload);
    if (e1) { setError(e1.message); setDraft(body); }
  }

  async function copyCode() {
    try { await navigator.clipboard.writeText(active.code); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { setError("Copy failed. Room code: " + active.code); }
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileSidebar ? "mobile-open" : ""}`}>
        <div className="brand"><img className="brand-logo" src="/logo.png" alt="Nexus"/><span>NEXUS</span><button className="icon-btn mobile-close" onClick={() => setMobileSidebar(false)}><X size={18}/></button></div>
        <div className="user-card"><div className="avatar">{profile?.username?.[0]?.toUpperCase() || "?"}</div><div className="user-meta"><strong>{profile?.username || "Your account"}</strong><span><i className="online-dot"/> Online</span></div><button className="icon-btn" title="Sign out" onClick={() => supabase.auth.signOut()}><LogOut size={17}/></button></div>
        <div className="side-label">MESSAGES <button className="icon-btn add-btn" onClick={() => {setShowNew(true);setError("");}}><Plus size={17}/></button></div>
        <div className="searchbox"><Search size={15}/><input placeholder="Search chats" value={search} onChange={e => setSearch(e.target.value)}/></div>
        <div className="chat-list">
          {chats.filter(c => c.title.toLowerCase().includes(search.toLowerCase())).map(c => <button key={c.id} className={`chat-item ${active?.id === c.id ? "selected" : ""}`} onClick={() => {setActive(c);setMobileSidebar(false);}}>
            <div className={`chat-avatar ${c.kind === "room" ? "room-avatar" : ""}`}>{c.kind === "room" ? <Hash size={19}/> : c.title[0]?.toUpperCase()}</div>
            <div className="chat-item-text"><strong>{c.title}</strong><span>{c.kind === "room" ? `Room · ${c.code}` : "Private message"}</span></div>
          </button>)}
          {!chats.length && <div className="empty-list">No chats yet.<br/>Start a conversation.</div>}
        </div>
        <div className="sidebar-footer"><span className="secure-mark"><Radio size={13}/> REALTIME CONNECTED</span><span className="version">NEXUS · v1.0</span></div>
      </aside>
      {mobileSidebar && <div className="scrim" onClick={() => setMobileSidebar(false)}/>}
      <main className="main-panel">
        {!active ? <div className="welcome"><img className="welcome-logo" src="/logo.png" alt="Nexus"/><h1>Good conversations<br/><span>start here.</span></h1><p>Choose a chat from the sidebar or create a new conversation.</p><button className="primary-btn" onClick={() => setShowNew(true)}><Plus size={17}/> Start a chat</button></div> :
        <><header className="chat-header"><button className="icon-btn mobile-menu" onClick={() => setMobileSidebar(true)}><Menu size={19}/></button><div className={`chat-avatar small ${active.kind === "room" ? "room-avatar" : ""}`}>{active.kind === "room" ? <Hash size={17}/> : active.title[0]?.toUpperCase()}</div><div className="header-meta"><strong>{active.title}</strong><span>{active.kind === "room" ? "Group room" : "Private conversation"}</span></div>{active.kind === "room" && <button className="code-chip" onClick={copyCode}><Hash size={14}/>{active.code}{copied ? <Check size={13}/> : <Copy size={13}/>}</button>}</header>
          <section className="messages">
            {messages.length === 0 ? <div className="chat-empty"><div className="welcome-orb mini"><MessageCircle size={20}/></div><strong>It's quiet in here.</strong><span>Send the first message to get things going.</span></div> : messages.map(m => <div key={m.id} className={`message-row ${m.sender_id === session.user.id ? "mine" : ""}`}><div className="message-avatar">{m.sender_id === session.user.id ? (profile?.username?.[0]?.toUpperCase() || "Y") : (m.profiles?.username?.[0]?.toUpperCase() || "?")}</div><div className="message-content"><div className="message-author">{m.sender_id === session.user.id ? "You" : m.profiles?.username || "User"} <time>{new Date(m.created_at).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}</time></div><div className="bubble">{m.body}</div></div></div>)}
            <div ref={bottomRef}/></section>
          <form className="composer" onSubmit={sendMessage}><div className="composer-inner"><input value={draft} onChange={e => setDraft(e.target.value)} placeholder={`Message ${active.title}...`} maxLength={4000}/><button className="send-btn" disabled={!draft.trim()} aria-label="Send message"><Send size={17}/></button></div><div className="composer-hint">Enter to send <span>·</span> Messages sync across devices</div></form></>}
      </main>
      {showNew && <div className="modal-backdrop" onClick={() => setShowNew(false)}><div className="modal" onClick={e => e.stopPropagation()}><div className="modal-head"><div><h2>Start a conversation</h2><p>Connect with someone or create a room.</p></div><button className="icon-btn" onClick={() => setShowNew(false)}><X size={18}/></button></div><div className="tabs"><button className={newMode === "dm" ? "active" : ""} onClick={() => {setNewMode("dm");setError("");}}>Private chat</button><button className={newMode === "create" ? "active" : ""} onClick={() => {setNewMode("create");setError("");}}>Create room</button><button className={newMode === "join" ? "active" : ""} onClick={() => {setNewMode("join");setError("");}}>Join room</button></div>
        {newMode === "dm" ? <form onSubmit={startDM}><label>Username</label><div className="field"><UserRound size={16}/><input autoFocus placeholder="e.g. alex_23" value={target} onChange={e => setTarget(e.target.value)} required/></div><button className="primary-btn full">Open private chat <MessageCircle size={16}/></button></form> :
        newMode === "create" ? <form onSubmit={createRoom}><label>Room name</label><div className="field"><Hash size={16}/><input autoFocus placeholder="e.g. weekend plans" value={roomName} onChange={e => setRoomName(e.target.value)} required/></div><button className="primary-btn full">Create room <Plus size={16}/></button></form> :
        <form onSubmit={joinRoom}><label>Room code</label><div className="field"><Hash size={16}/><input autoFocus placeholder="6-character code" value={roomCode} onChange={e => setRoomCode(e.target.value)} required maxLength={6}/></div><button className="primary-btn full">Join room <Users size={16}/></button></form>}
        {error && <div className="error-note">{error}</div>}</div></div>}
      {error && !showNew && <div className="toast" onClick={() => setError("")}>{error}<X size={14}/></div>}
    </div>
  );

}

function AuthScreen() {
  const [mode, setMode] = useState("login");
  const [email,setEmail] = useState(""); const [password,setPassword] = useState(""); const [username,setUsername] = useState(""); const [error,setError] = useState(""); const [busy,setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault(); setBusy(true); setError("");
    try {
      if (mode === "signup") {
        const clean = username.trim().toLowerCase();
        if (!/^[a-z0-9_]{3,24}$/.test(clean)) throw new Error("Username must be 3–24 characters: letters, numbers, underscores.");
        const { data: free } = await supabase.rpc("username_available", { name: clean });
        if (free === false) throw new Error("That username is already taken.");
        const { data, error: err } = await supabase.auth.signUp({ email, password, options: { data: { username: clean } } });
        if (err) throw err;
        if (!data.session) setError("Check your email to confirm your account, then log in.");
      } else {
        const { error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err) throw err;
      }
    } catch (err) { setError(err.message || "Something went wrong."); }
    setBusy(false);
  }
  return <div className="auth-screen"><div className="auth-glow"/><div className="auth-card"><div className="brand centered"><img className="brand-logo" src="/logo.png" alt="Nexus"/><span>NEXUS</span></div><h1>{mode === "login" ? "Welcome back." : "Create your account."}</h1><p className="auth-sub">{mode === "login" ? "Your conversations are waiting." : "A better way to stay connected."}</p><form onSubmit={submit}>{mode === "signup" && <><label>Username</label><div className="field"><UserRound size={16}/><input value={username} onChange={e=>setUsername(e.target.value)} placeholder="choose_a_username" required minLength={3} maxLength={24}/></div></>}<label>Email</label><div className="field"><input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com" required/></div><label>Password</label><div className="field"><input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="At least 6 characters" required minLength={6}/></div>{error && <div className="error-note">{error}</div>}<button className="primary-btn full" disabled={busy}>{busy ? "Please wait..." : mode === "login" ? "Log in" : "Create account"}</button></form><div className="auth-switch">{mode === "login" ? "New to NEXUS?" : "Already have an account?"} <button onClick={()=>{setMode(mode==="login"?"signup":"login");setError("");}}>{mode==="login"?"Create an account":"Log in"}</button></div><div className="auth-foot"><Radio size={13}/> Secure authentication · Realtime messaging</div></div></div>;
}

function Setup() { return <div className="setup-screen"><div className="setup-card"><div className="brand centered"><img className="brand-logo" src="/logo.png" alt="Nexus"/><span>NEXUS</span></div><h1>Connect your backend</h1><p>To enable real accounts and cross-device messaging, add your Supabase project credentials to a <code>.env</code> file.</p><ol><li>Create a project at <a href="https://supabase.com" target="_blank" rel="noreferrer">supabase.com</a>.</li><li>Run <code>supabase/schema.sql</code> in the SQL Editor.</li><li>Copy <code>.env.example</code> to <code>.env</code> and fill in your project URL and anon key.</li><li>Run <code>npm install</code>, then <code>npm run dev</code>.</li></ol><div className="setup-note">Only use your Supabase public anon/publishable key in the browser. Never put a service-role key here.</div></div></div>; }
function Root() {
  if (!supabase) return <Setup />;
  return <AuthenticatedApp />;
}
function AuthenticatedApp() {
  const [session,setSession] = useState(null);
  useEffect(()=>{supabase.auth.getSession().then(({data})=>setSession(data.session)); const {data:l}=supabase.auth.onAuthStateChange((_e,s)=>setSession(s)); return ()=>l.subscription.unsubscribe();},[]);
  return session ? <App/> : <AuthScreen/>;
}
createRoot(document.getElementById("root")).render(<Root/>);
