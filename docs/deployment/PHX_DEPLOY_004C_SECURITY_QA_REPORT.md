# PHX-DEPLOY-004C — Security QA Report

Scope: the new `vercel-supabase-preview` mode only. No other mode's
security posture was changed by this sprint.

## 1. No secrets exposed to the client

Grep of the full production build output (`.next/static` — the only
directory ever shipped to a browser) for the connection string, the
server-only module name, and any `require('pg')`/`require("pg")`
occurrence:

```
grep -rl "PHOENIX_DATABASE_URL\|preview-db.server\|require(\"pg\")\|require('pg')" .next/static
→ matched only .next/static/chunks/app/login/page-*.js and one shared chunk
```

Inspecting the match:

```
grep -o ".\{40\}PHOENIX_DATABASE_URL.\{20\}" .next/static/chunks/app/login/page-*.js
→ "vercel-supabase-preview"===t.mode?"PHOENIX_DATABASE_URL":"NEXT_PUBLIC_PHOEN...
```

This is `ClerkSignInPanel.tsx`'s (client component) **display copy** —
the literal string naming which env var to configure, shown only in the
"sign-in is not configured" error panel. It is not a read of the actual
value, not the connection string, and not reachable unless Clerk itself
is already misconfigured (in which case no data of any kind is
reachable regardless). No actual secret value, connection string, or
`pg` module code appears anywhere in `.next/static`.

Separately, a full build with a fake `PHOENIX_DATABASE_URL` and fake
`CLERK_SECRET_KEY` set was grepped for the literal fake values across
the entire `.next` directory (static and server):

```
grep -rl "phoenix_preview_qa\|sk_test_fake_key_for_build_qa_only" .next
→ no matches
```

## 2. `pg` (and the DB connection string) never reaches client code

```
grep -rl "getPreviewDatabasePool\|preview-db.server" .next/server
→ .next/server/chunks/697.js only (a server chunk)
```

`lib/db/preview-db.server.ts` is imported only by
`lib/preview-api-client.server.ts`, which is imported only by
`lib/platform-data-source.ts`, which is called only from Server
Component pages (`dashboard`, `assessments`, `assessments/[id]`,
`settings` — none of them `'use client'`). Next.js's server/client
module graph therefore never bundles `pg` toward the browser. As
defense in depth, `preview-db.server.ts` also throws immediately if
`typeof window !== 'undefined'` at module-evaluation time, so any future
accidental client import fails loudly at build/runtime instead of
silently shipping a connection string.

## 3. `PHOENIX_DATABASE_URL` is read only server-side

The variable is:
- Read in exactly one place for its value: `lib/db/preview-db.server.ts`'s
  `readPreviewDatabaseUrl()`.
- Checked for *presence only* (boolean, value never touched) in
  `lib/auth/preview-auth.server.ts`'s `getPreviewAuthConfigStatus()`.
- Never passed through `lib/api-config.ts` (the client-safe
  `NEXT_PUBLIC_*` surface) at all — `api-config.ts` has no reference to
  it.
- Never logged. `preview-db.server.ts`'s error paths mirror
  `apps/backend/src/db/client.ts`'s existing discipline: error messages
  describe the *shape* of the failure, never the connection string.

Deliberately named `PHOENIX_DATABASE_URL`, not `DATABASE_URL`, so a
Vercel-side Postgres integration that auto-injects its own `DATABASE_URL`
can never be silently substituted for the explicitly-configured Supabase
connection string.

## 4. `CLERK_SECRET_KEY` handling — unchanged pattern, reused correctly

`preview-auth.server.ts`'s `isServerClerkSecretConfigured()` is a
byte-for-byte copy of `platform-auth.server.ts`'s existing
`isServerClerkSecretConfigured()` — reads the var, returns a boolean
only, never assigns the value to anything that outlives the function,
never logs it, never returns it. `@clerk/nextjs/server` is dynamically
imported only after the full config gate (`fullyConfigured`) is
confirmed true — a missing or partial Clerk config never reaches
`auth()`/`currentUser()`.

## 5. No roles/workspaces trusted from Clerk claims

`resolvePreviewSessionState()` returns, at most, a Clerk user id and a
verified-or-not email — nothing else from the Clerk session is read.
Role and workspace membership are **always** re-resolved from
`workspace_users` via `resolvePreviewActor()`, on every read, exactly
mirroring the backend's `getActorForWorkspace()`. No permission decision
anywhere in `preview-api-client.server.ts` is made from a Clerk claim.

## 6. No auto-provisioning, no public signup

`resolvePreviewUserId()` never issues an `INSERT` into `users` — only
into `auth_identities`, and only when linking an *already-existing*
`users` row matched by a *verified* email. An unmatched or unverified
identity returns `401 AUTH_REQUIRED` with a message telling the caller
to ask a Phoenix Owner/Admin to invite them — it does not create an
account. `ClerkSignInPanel.tsx`'s sign-up link continues to point back
at `/login` (unchanged), and Clerk's own sign-up flow was never wired
into any account-provisioning path.

## 7. Permission enforcement — same matrix, same ordering, DB-derived

Every `previewGet*` function enforces, in the same order the backend
enforces it: (existence check where relevant, e.g. workspace/assessment
not found → 404) → (Clerk-identity → Phoenix-user mapping, else 401) →
(workspace membership + Active status, else 403) → (role carries the
required permission, else 403). The permission matrix in
`preview-auth.server.ts` is copied verbatim from
`apps/backend/src/auth/permissions.ts` — confirmed identical by
inspection (Owner/Admin unrestricted; Reviewer has no
`assessment.create`/`assessment.submit`/`audit.read`; Contributor has no
`audit.read`; Viewer/Auditor are read-only; only Owner/Admin/Auditor
carry `audit.read`).

## 8. Parameterized SQL only

Every query in `preview-api-client.server.ts` and
`preview-auth.server.ts` uses `$1`/`$2`/… bound parameters — no string
interpolation of any caller-influenced value (`workspaceId`,
`assessmentId`, Clerk user id, email) into SQL text anywhere in either
file.

## 9. No new cookies, tokens, or session storage

This sprint adds no cookie handling, no token storage, and no session
store of its own — Clerk's own SDK continues to own the session cookie
exactly as it already does for `production-auth`. Nothing in
`preview-auth.server.ts` or `preview-api-client.server.ts` reads,
writes, or inspects a raw cookie or bearer token.

## Summary

No secret value, connection string, or server-only module reaches the
client bundle. `PHOENIX_DATABASE_URL` and `CLERK_SECRET_KEY` are
read/checked only in server-only modules. Role/permission decisions are
always DB-derived, never trusted from Clerk claims. No user
auto-provisioning exists. All database access is parameterized.
