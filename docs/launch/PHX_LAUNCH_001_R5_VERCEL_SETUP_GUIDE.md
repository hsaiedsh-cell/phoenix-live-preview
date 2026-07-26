# PHX-LAUNCH-001-R5 — Vercel Setup Guide (Addendum)

Supersedes nothing structurally in the R2–R4 setup guide corrections
(connection mode, `ALLOWED_PREVIEW_ORIGINS`, Turnstile hostname/action
variables), all of which remain accurate and unchanged. This addendum adds
one new required environment variable and restates the Section 12
live-provider Go/No-Go list, since R5 adds several items.

## 1. New environment variable: none required, but one column requires the migration to be re-run if already applied elsewhere

R5 adds `reservation_key_hash` to `public_intake_files` and a matching
partial unique index. No new environment variable is introduced. As
always, the migration has still never been applied to any hosted Supabase
project in this engagement — run the *current* file (not a version from
before this revision) with `scripts/db-migrate.ts`, using a direct/session
connection string per the R2 correction.

## 2. New route: `/api/upload/:token/cancel` already covered by existing matchers

No new deployment configuration is needed for the `cancel` route (added in
R4) — it already falls under the same `/api/upload/:path*` middleware
matcher (R5 §8) as every other upload action route.

## 3. Live-provider Go/No-Go — full restated list

Before Private Beta Go, a deployed environment must separately prove every
item below. None of these are claimed by this local revision:

```
real Supabase signed upload / uploadToSignedUrl SDK compatibility
  -- unchanged open item from R4; still not resolved locally
real provider-recorded metadata (size/Content-Type) on verification
real reservation retry/cancel against Supabase Storage specifically
real orphan deletion (cleanup --apply against the real bucket)
real transaction-pooler connection behavior under load
real Turnstile hostname/action validation (configure
  TURNSTILE_ALLOWED_HOSTNAMES / TURNSTILE_EXPECTED_ACTION for the actual
  deployed domain and confirm against a real Cloudflare challenge)
real Resend delivery and provider idempotency
real Sentry ingestion -- confirm the R5-closed sanitizer gaps (headers,
  env, transaction/span query strings) hold against an ACTUAL captured
  event from the deployed app, not only synthetic fixtures
real Vercel request-log redaction -- confirm Vercel's own
  platform-level access/function logs do not retain the raw upload
  token in a URL even though the application-level Sentry sanitizer
  and Cache-Control/Referrer-Policy/X-Robots-Tag headers are all now
  in place; this is a platform log-retention setting outside this
  codebase's control
real browser/mobile/accessibility QA (unavailable in this sandbox for
  the whole project to date)
DNS/domain verification
```

## 4. Next phase after R5 approval

Per the R5 addendum itself: after independent review approves this
revision, the expected next phase is to push the task branch, open a pull
request, deploy an isolated Website Preview, configure non-production
provider credentials, and run the real browser/provider Go/No-Go checks
above. No production merge or launch is authorized by R5, and none was
performed.
