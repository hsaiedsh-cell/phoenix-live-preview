# PHX-LAUNCH-001-R2 — Vercel Setup Guide (Correction)

Supersedes the connection-mode guidance in both the original setup guide and
the R1 addendum, which contradicted each other (Section 7.2 of the R2
addendum). Deployment is still NOT performed by this revision (no push, no
Vercel project creation, no DNS change).

## 1. One authoritative database connection rule

The original setup guide recommended Supabase's transaction-mode connection
pooler (the normal choice for serverless traffic). The R1 addendum then
required a session-scoped `pg_advisory_lock`, which needs a persistent
session-mode connection — directly contradicting the original guidance. R2
removes the session-scoped lock entirely (see the R2 Implementation Report
§3), so the contradiction is resolved. There is exactly one rule now:

```text
Vercel runtime (this application's API routes, INTAKE_DATABASE_URL as
  used by apps/website at request time): Supabase's transaction-mode
  pooler (Supavisor/PgBouncer in transaction-pooling mode). Every
  function in src/lib/intake/db.ts is a single short statement or a
  single short transaction, released back to the pool immediately —
  there is no code path anywhere in the intake runtime that holds a
  connection open across an external network call or relies on
  session state persisting between statements.

Migration / administration (scripts/db-migrate.ts, direct psql
  access, any one-off maintenance): a direct connection, or an
  explicitly approved session-mode connection. These are not part of
  the serverless request path and have no transaction-pooler
  constraint to satisfy — use whichever connection string Supabase's
  dashboard provides for direct/administrative access.
```

When configuring `INTAKE_DATABASE_URL` in Vercel's environment variables,
use Supabase's **transaction pooler** connection string (typically on port
6543). Do not use the session-mode/direct connection string (typically port
5432) for the deployed application — reserve that for running
`scripts/db-migrate.ts` by hand.

## 2. Migration

The tracked migration (`db/migrations/0001_public_intake_schema.sql`) was
revised in place again for R2 — `public_intake_idempotency_keys` now has a
genuinely `UNIQUE` `idempotency_key_hash` column and a `state` machine
(`pending`/`completed`/`failed`), not R1's non-unique, advisory-lock-backed
design. This file has still never been applied to any hosted Supabase
project. Run the *current* file — there is no separate compatibility
migration to also apply:

```bash
cd apps/website
INTAKE_DATABASE_URL=<supabase-direct-or-session-connection-string> npx tsx scripts/db-migrate.ts
```

Use a direct/session connection string for this command specifically (see
§1 above) — migrations run DDL and are not part of the serverless request
path.

## 3. No new environment variables

Every server-only and public environment variable from the original setup
guide is unchanged. `StorageAdapter.deleteObject` (new in R2, used by
`cleanup --apply`) uses the same `SUPABASE_SERVICE_ROLE_KEY` and
`SUPABASE_INTAKE_BUCKET` already required for signing and verification — no
new credential is needed.

## 4. Before flipping Private Beta "Go"

In addition to the original guide's §8 checklist and the R1 addendum's
Supabase-pooler-compatibility item (now resolved by this correction), verify
once real infrastructure exists that `cleanup --apply` actually removes an
orphaned object from the real private bucket, and that a second `cleanup
--apply` run against the same (already-cleaned) state is a true no-op —
this sprint's QA proves both against a fake adapter only.
