# PHX-LAUNCH-001-R1 — Vercel Setup Guide (Addendum)

Supersedes nothing in `PHX-LAUNCH-001-VERCEL-SETUP-GUIDE.md` — R1 introduced
no new environment variables and no new external provider. This addendum
only updates what changed structurally. Deployment is still NOT performed
by this revision (no push, no Vercel project creation, no DNS change).

## 1. Database migration

The tracked migration (`db/migrations/0001_public_intake_schema.sql`) was
**revised in place** for R1 — it now creates **6** tables instead of 5
(the new `public_intake_idempotency_keys` table), and `public_upload_sessions`
gains a `finalized_at` column. This file has still never been applied to
any hosted Supabase project. Whoever runs it for the first time should run
the *current* file (not a version from before this revision) — there is no
separate `0002_*.sql` to also apply:

```bash
cd apps/website
INTAKE_DATABASE_URL=<supabase-connection-string> npx tsx scripts/db-migrate.ts
```

## 2. No new environment variables

Every server-only and public environment variable listed in the original
setup guide is unchanged. In particular, `INTAKE_OPS_SECRET` (already
required by the two internal routes) now also gates the Content-Type check
added in R1 — no new secret is required for that.

## 3. Before flipping Private Beta "Go"

The original guide's §8 checklist is unchanged and still the authoritative
list of what a real, deployed environment still needs verified end-to-end
(real Turnstile challenge, real Resend delivery, real Supabase Storage
upload, real Sentry-captured error) before any customer is invited. R1 adds
one item to specifically re-verify once real infrastructure exists: that a
**genuinely concurrent** pair of browser tabs/retries submitting the same
form data resolves to one request, not two — this was proven against local
Postgres in R1's QA but has not been proven against hosted Supabase's
connection pooling behavior (e.g. Supavisor/pgbouncer in transaction mode
can affect how session-scoped advisory locks behave — confirm
`withAdvisoryLock` in `db.ts` is used against a **session-mode** (not
transaction-mode) connection string, since `pg_advisory_lock` requires a
persistent session).
