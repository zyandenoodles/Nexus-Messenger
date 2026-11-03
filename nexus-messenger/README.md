# NEXUS Messenger

Dark-mode realtime messenger: private chats by username, group rooms by 6-character code. React + Vite + Supabase.

## Setup
1. Create a project at https://supabase.com.
2. SQL Editor → paste and run all of `supabase/schema.sql` (safe to re-run).
3. Project Settings → API: copy the Project URL and public anon/publishable key into a `.env` file in this folder (see `.env.example`).
4. `npm install` then `npm run dev`.
5. Sign up two accounts (two browsers/devices) and message each other by username.

## Get the Android app (APK)
1. Create a free GitHub repo and upload everything in this folder (the `.env` file is ignored on purpose).
2. Repo → Settings → Secrets and variables → Actions → add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
3. Actions tab → "Build Android APK" → Run workflow. After ~5 minutes download `nexus-apk` from the run and unzip it.
4. Send `app-debug.apk` to your phone and install it (allow "install unknown apps"). Both people need the app and their own account.

Prefer building locally? Install Android Studio, then `npm install`, `npx cap add android`, `npx capacitor-assets generate --android`, `npm run android`.
iPhone: on a Mac with Xcode run `npx cap add ios`, then `npm run ios`. Installing on real iPhones needs an Apple Developer account.
Google Play needs a signed release build, which comes after this debug build works.

## Notes
- Only use the public anon key in the frontend, never the service-role key.
- Supabase Auth → Providers → Email: turn off "Confirm email" while testing, or confirm via the emailed link.
- Room codes are invite codes, not strong security. Before production add rate limits, moderation/reporting and privacy disclosures.
- Deploy with `npm run build` (output in `dist/`) to Netlify, Vercel or Cloudflare Pages, setting the two env vars there.
