# S.A.M. — Safety · Assurance · Management

Clair Group compliance & safety platform. Beta stack: **Next.js on Vercel** + **Supabase** (PostgreSQL, Auth, Storage), Microsoft Entra ID for identity. Decisions: project doc `claude/architecture-decisions.md` (INF-01, UX-03, DOC-09, SAF-01…).

## Setup (once the accounts exist)

### 1 · Push this code to GitHub
```bash
cd sam
git init -b main
git add . && git commit -m "S.A.M. beta skeleton"
git remote add origin https://github.com/clair-group-sam/sam.git
git push -u origin main
git checkout -b dev && git push -u origin dev
```
Then in GitHub › Settings › Branches: protect `main` (require a pull request).

### 2 · Supabase
1. Dashboard › project `sam-prod` › **Project settings › API** → copy *Project URL* and *anon public* key (for Vercel), keep *service_role* for server env only.
2. **Authentication › Providers › Azure** → enable; paste the Entra *Application (client) ID*, the *client secret*, and *Azure Tenant URL* = `https://login.microsoftonline.com/<tenant-id>`. Note the **Callback URL** shown there: it goes into the Entra app registration.
3. **Authentication › URL configuration** → Site URL `https://sam.clair-group.com`, redirect URLs `https://sam.clair-group.com/**`, `https://*.vercel.app/**`, `http://localhost:3000/**`.
4. Apply the schema:
```bash
npm i
npx supabase login
npx supabase link --project-ref <sam-dev ref>
npx supabase db push          # dev first
npx supabase link --project-ref <sam-prod ref>
npx supabase db push          # then prod
```
5. **Storage** → create private buckets `manuals`, `certificates`, `evidence`.

### 3 · Vercel
1. https://vercel.com/new → import `clair-group-sam/sam` → Framework Next.js (auto) → **Environment variables** (from `.env.example`): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `CRON_SECRET` (any long random string). Set Production and Preview separately (preview → `sam-dev`).
2. Deploy. Region is `cdg1` (vercel.json).
3. **Settings › Domains** → add `sam.clair-group.com`; give IT the CNAME shown.
4. **Settings › Deployment Protection** → Vercel Authentication on previews.

### 4 · Entra ID (IT Clair Group)
App registration `S.A.M. (beta)`, single tenant, Web redirect = the Supabase callback URL (step 2.2), client secret (24 months), **Token configuration → add groups claim (Security groups, Group ID)** or use `optionalClaims`; API permissions `openid profile email User.Read`. Groups: `CG-SAM-BETA`, `CG-ASF-CFI`, `CG-ASF-HT`, `CG-ASF-CTKI`, `CG-ASF-FSO`, `CG-TEC-MAM`, `CG-GROUP-CMM`, `CG-GROUP-SM`, `CG-GROUP-AM`.
The `groups` claim is copied to `app_metadata.groups` by an Auth hook (step 2 of the plan); until then roles can be set manually in `people`.

## Local development
```bash
cp .env.example .env.local   # fill from Supabase sam-dev
npm run dev                  # http://localhost:3000
```

## Layout
- `app/` — Next.js app router (login, auth callback, home/Inbox, API routes, cron)
- `lib/` — Supabase clients, scope from Entra groups (UX-03)
- `supabase/migrations/` — versioned SQL schema with RLS (apply with `supabase db push`)
- `vercel.json` — region cdg1, hourly cron
- Never commit `.env*`; secrets live in Vercel and Supabase only.
