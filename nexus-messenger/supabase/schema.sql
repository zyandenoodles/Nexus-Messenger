-- NEXUS schema. Run ALL of this in Supabase → SQL Editor. Safe to re-run on an existing project.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null check (username ~ '^[a-z0-9_]{3,24}$'),
  created_at timestamptz not null default now()
);
create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name text not null,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table if not exists public.room_members (
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references auth.users(id) on delete cascade,
  user_b uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  check (user_a <> user_b),
  unique (user_a, user_b)
);
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references public.conversations(id) on delete cascade,
  room_id uuid references public.rooms(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now(),
  check ((conversation_id is not null and room_id is null) or (conversation_id is null and room_id is not null))
);
-- The app joins messages -> profiles to show usernames, which needs this FK to point at profiles.
alter table public.messages drop constraint if exists messages_sender_id_fkey;
alter table public.messages add constraint messages_sender_id_fkey
  foreign key (sender_id) references public.profiles(id) on delete cascade;

create index if not exists messages_conversation_created_idx on public.messages(conversation_id, created_at);
create index if not exists messages_room_created_idx on public.messages(room_id, created_at);
create index if not exists room_members_user_idx on public.room_members(user_id);

alter table public.profiles enable row level security;
alter table public.rooms enable row level security;
alter table public.room_members enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;

-- Start clean so re-running replaces any older policies.
do $$ declare p record; begin
  for p in select policyname, tablename from pg_policies
           where schemaname = 'public' and tablename in ('profiles','rooms','room_members','conversations','messages')
  loop execute format('drop policy %I on public.%I', p.policyname, p.tablename); end loop;
end $$;

-- Membership check as SECURITY DEFINER avoids the "infinite recursion in policy" error
-- the old room_members policy caused by querying its own table.
create or replace function public.is_room_member(rid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.room_members where room_id = rid and user_id = auth.uid());
$$;

create policy profiles_read   on public.profiles for select to authenticated using (true);
create policy profiles_update on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Rooms are visible only to members, so room codes can't be enumerated. Joining goes through join_room().
create policy rooms_read   on public.rooms for select to authenticated using (created_by = auth.uid() or public.is_room_member(id));
create policy rooms_create on public.rooms for insert to authenticated with check (created_by = auth.uid());

create policy members_read  on public.room_members for select to authenticated using (public.is_room_member(room_id));
create policy members_owner on public.room_members for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from public.rooms r where r.id = room_id and r.created_by = auth.uid()));
create policy members_leave on public.room_members for delete to authenticated using (user_id = auth.uid());

create policy conv_read   on public.conversations for select to authenticated using (user_a = auth.uid() or user_b = auth.uid());
create policy conv_create on public.conversations for insert to authenticated with check (user_a = auth.uid() or user_b = auth.uid());

create policy msg_read on public.messages for select to authenticated using (
  (messages.conversation_id is not null and exists (select 1 from public.conversations c
     where c.id = messages.conversation_id and (c.user_a = auth.uid() or c.user_b = auth.uid())))
  or (messages.room_id is not null and public.is_room_member(messages.room_id))
);
create policy msg_send on public.messages for insert to authenticated with check (
  sender_id = auth.uid() and (
    (messages.conversation_id is not null and exists (select 1 from public.conversations c
       where c.id = messages.conversation_id and (c.user_a = auth.uid() or c.user_b = auth.uid())))
    or (messages.room_id is not null and public.is_room_member(messages.room_id))
  )
);

-- Profile is created by the database at signup (username comes from signup metadata),
-- so it works even when email confirmation is on.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username) values (new.id, lower(new.raw_user_meta_data->>'username'));
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.username_available(name text) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from public.profiles where username = lower(name));
$$;
grant execute on function public.username_available(text) to anon, authenticated;

create or replace function public.join_room(room_code text) returns public.rooms
language plpgsql security definer set search_path = public as $$
declare r public.rooms;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select * into r from public.rooms where code = upper(trim(room_code));
  if not found then raise exception 'Room code not found.'; end if;
  insert into public.room_members (room_id, user_id) values (r.id, auth.uid()) on conflict do nothing;
  return r;
end $$;

-- Realtime for messages (no error if it's already enabled).
do $$ begin
  alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null; end $$;
