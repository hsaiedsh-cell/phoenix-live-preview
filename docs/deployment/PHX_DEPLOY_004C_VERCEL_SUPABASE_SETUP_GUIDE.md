# PHX-DEPLOY-004C — Vercel + Supabase Free Preview Setup Guide

This is a **preview** deployment path, not a production launch. Public
Deployment remains No-Go — keep sign-up disabled and invite only trusted
reviewers as Phoenix users first (see step 5).

## What you get

- `apps/platform` hosted on Vercel's free Hobby tier.
- PostgreSQL hosted on Supabase's free tier.
- Clerk for sign-in (same provider `production-auth` already uses).
- **No second host for the Express backend.** `apps/backend` stays in
  the repo, untouched, unused by this mode — the platform reads
  Supabase directly, server-side, for `/dashboard`, `/assessments`,
  `/assessments/[id]`, and Settings' activity/audit preview. Passports,
  Certifications, and Reports stay preview-only (mock-backed), same as
  every other non-mock mode today.

## 1. Create the Supabase project

1. Create a free Supabase project.
2. From **Project Settings → Database**, copy the connection string.
   Use the **connection pooler** string (recommended for serverless —
   Vercel functions are short-lived) or the direct connection string;
   either works with this adapter's `pg.Pool` (max 3 connections).
3. This becomes `PHOENIX_DATABASE_URL` in step 4 — **not** `DATABASE_URL`.

## 2. Run migrations and seed against Supabase

From `apps/backend`, locally (not on Vercel — this is a one-time setup
step, not a deploy step):

```bash
cd apps/backend
DATABASE_URL="<your Supabase connection string>" \
PHOENIX_ENABLE_DATABASE=true \
npx tsx src/db/migrate.ts

DATABASE_URL="<your Supabase connection string>" \
PHOENIX_ENABLE_DATABASE=true \
npx tsx src/db/seed.ts   # optional — only if you want demo data
```

This uses the exact same migration files (`db/migrations/`) and
seed script the backend already uses locally — no separate schema
exists for this mode. Note: if you extracted this repo from a `.tar.gz`
created on macOS, strip any `._*` AppleDouble files first
(`find . -name '._*' -delete`) — they sort before the real `.sql` files
and will break the migration runner.

## 3. Create a Clerk application

1. Create a Clerk application (or reuse the one already configured for
   `production-auth`, if this is the same Phoenix instance).
2. Copy the **Publishable key** and **Secret key**.
3. Under Clerk's JWT Templates, no new template is required for this
   mode specifically — this mode never sends a bearer token anywhere
   (there's no backend to send it to); it only uses Clerk for session
   identity, exactly like `production-auth`'s session-detection half.

## 4. Configure Vercel project env vars

Import the repo into Vercel. **Set the project's Root Directory to
`apps/platform`** (this is a pnpm workspace monorepo — Vercel needs to
know which app to build).

Set these environment variables in the Vercel project (Production and
Preview, as appropriate):

```
NEXT_PUBLIC_PHOENIX_API_MODE=vercel-supabase-preview
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=<from Clerk>
CLERK_SECRET_KEY=<from Clerk — mark as a Vercel "Secret"/sensitive var>
PHOENIX_DATABASE_URL=<from Supabase — mark as a Vercel "Secret"/sensitive var>
NEXT_PUBLIC_PHOENIX_PRODUCTION_WORKSPACE_ID=<a workspace id from your seeded/migrated DB>
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/login
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/login
NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=/dashboard
NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL=/dashboard
```

`NEXT_PUBLIC_PHOENIX_PRODUCTION_WORKSPACE_ID` is the same interim
bridge `production-auth` already uses — the backend (and this mode) has
no "workspaces for the authenticated identity" lookup yet, so this env
var is the only way the deployment knows which workspace to scope reads
to. Find a real workspace id with:

```sql
SELECT id, name, slug FROM workspaces WHERE deleted_at IS NULL;
```

**Never set `NEXT_PUBLIC_PHOENIX_BACKEND_URL`** for this mode — it's
unused (there is no backend host), and leaving it unset is how you
confirm to yourself the deployment truly has no backend dependency.

## 5. Link a Phoenix user to a Clerk identity (no auto-provisioning)

This mode never creates a Phoenix user automatically. Before someone can
see data, they need either:

- **A pre-linked identity**: insert a row into `auth_identities` mapping
  their Clerk user id (`external_subject`) to an existing `users.id`,
  or
- **A verified-email match**: they sign in with Clerk using the same
  email address as an existing `users.email` row, with that email
  verified in Clerk. On first sign-in, the adapter links it
  automatically (same rule the backend's `auth-identity.repository.ts`
  already implements) — it does **not** create a new `users` row, only
  the link.

If neither is true, the person sees a clear "no Phoenix user is linked
to this identity" message, not a silent account creation and not a
blank/broken page.

## 6. Deploy

Push to the branch Vercel is watching, or trigger a deploy manually.
Vercel builds `apps/platform` with `next build` — no backend build step
is needed or run.

## 7. Verify

1. Visit the deployed URL → redirected to `/login` → Clerk sign-in.
2. Sign in as a user linked per step 5.
3. `/dashboard`, `/assessments`, `/assessments/[id]`, and Settings'
   Audit Preview should show a "Live" badge and real Supabase data.
4. Passports, Certifications, and Reports should still show their
   existing mock-preview banners — this is expected and correct for
   this sprint's scope, not a bug.
5. Sign out (or use an incognito window) and confirm `/dashboard`
   redirects to "Sign in required" rather than showing any data.

## Limitations of this preview path

- No backend write endpoints are reachable from this mode — creating,
  submitting, or editing anything is not available (read-only preview).
- Passports/Certifications/Reports have no live endpoint in this mode
  (same as every other non-mock mode today).
- Workspace scoping is the same single, env-var-configured workspace
  every session reads from — this mode does not yet resolve "which
  workspaces does this signed-in identity belong to" (tracked as future
  work, same as `production-auth`'s equivalent limitation — see
  PHX-AUTH-001).
- This is not a production launch. Public Deployment remains No-Go.
