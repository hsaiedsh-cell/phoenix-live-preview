# PHX-LAUNCH-001-R4 — Vercel Setup Guide (Addendum)

Supersedes nothing structurally in the R2/R3 setup guide corrections (connection
mode, `ALLOWED_PREVIEW_ORIGINS`), which remain accurate and unchanged. This
addendum adds two new environment variables and restates the Section 9
live-provider Go/No-Go list in full, since R4 adds several new items to it.

## 1. New environment variables: Turnstile hostname/action

```
TURNSTILE_ALLOWED_HOSTNAMES=phoenixops.ai,<your-preview-origin>.vercel.app
TURNSTILE_EXPECTED_ACTION=public-intake
```

Before Private Beta Go: set `TURNSTILE_ALLOWED_HOSTNAMES` to the exact
hostname(s) your production and preview Turnstile widgets are actually
rendered on (Cloudflare's own Siteverify response reports this as
`hostname`, and the server checks it exactly). `TURNSTILE_EXPECTED_ACTION`
defaults to `public-intake`, matching what `IntakeForm.tsx`'s widget already
sends — only change this if you deliberately configure a different action
in the Cloudflare dashboard. Leaving either unset disables that specific
check (safe default for environments without live Turnstile configured yet)
but must not be left unset in production.

Separate widgets per environment (production vs. preview) remain
recommended where practical, per the addendum — this is a Cloudflare
dashboard configuration step, not something this codebase can enforce.

## 2. Migration

The tracked migration continues to be revised in place. R4 adds `'cancelled'`
to the reservation-status check constraint and a few new event types. Still
never applied to any hosted Supabase project — run the *current* file with
`scripts/db-migrate.ts` using a direct/session connection string (per the R2
correction).

## 3. Live-provider Go/No-Go — full restated list

Before Private Beta Go, a deployed environment must separately prove every
item below. None of these are claimed by this local revision:

```
real Supabase signed upload and direct browser PUT
  -- IMPORTANT: official Supabase JS documentation treats
     uploadToSignedUrl(path, token, file) as the supported SDK upload
     flow. This codebase currently does a raw signed-URL PUT instead.
     Explicitly verify the raw PUT actually works against your selected
     Supabase project's Storage configuration (CORS, upload policies)
     during Go/No-Go -- do not assume it from these fake-adapter tests.
real provider-recorded metadata (size/Content-Type) on verification
real reservation retry/cancel against Supabase Storage specifically
real orphan deletion (cleanup --apply against the real bucket)
real Turnstile hostname/action validation (Section 1 above)
real Resend delivery and provider idempotency
real Sentry ingestion after the R3/R4 sanitizer (confirm nothing
  unexpected survives in an ACTUAL captured event, not just synthetic
  fixtures)
real Vercel transaction-pooler connection behavior under load
real browser mobile/desktop/accessibility QA (unavailable in this
  sandbox for the whole project to date)
DNS/domain verification
```

## 4. Before flipping Private Beta "Go" — carried forward from R3

The R3 setup guide's concurrent-Finish-uploading verification item against
the real Supabase transaction-mode pooler remains open and is now folded
into the restated list above.
