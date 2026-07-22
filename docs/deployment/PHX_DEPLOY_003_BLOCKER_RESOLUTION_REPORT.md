# PHX-DEPLOY-003 — Hosted Preview Blocker Resolution Report

**Task:** Hosted Preview Blocker Resolution (source-code readiness sprint, not a
deployment sprint). **No public deployment. No hosted deployment performed.**

This sprint operated against a real, previously-fragmented source snapshot
provided by the operator (`PHOENIX-REAL-SOURCE-FOR-DEPLOY-003-CLEAN`), containing
every prior sprint's deliverable directory. No source was invented — every file
in the resulting tree originates from one of those prior deliverables or is a
new file/edit made and verified in this sprint.

---

## B1 — Unified source tree

**Status: RESOLVED.**

### What was found

Diffing the provided packages confirmed the exact split PHX-DEPLOY-002 had
suspected but could not inspect directly:

- **`PHX-AUTH-002-R1-HOSTED-AUTH-PRODUCTION-RESOLVER`** contained the full auth
  lineage: PHX-BACKEND-001 through 008-R1's read/write/ownership/audit
  foundation, PHX-BACKEND-009-R1's `ActorResolver` abstraction
  (`dev-header` / `production-disabled` / `token-placeholder`), and
  PHX-AUTH-002/002-R1's `oidc-jwt` resolver, JWKS verification, and
  `auth_identities` migration/repository. Confirmed by content diff that
  AUTH-002-R1's `actor-resolver.ts` (328 lines) is a strict superset of
  BACKEND-009-R1's `actor-resolver.ts` (241 lines) — same three placeholder
  modes, plus `oidc-jwt` added on top. **This package had no CORS middleware
  at all** — `src/middleware/` contained only `request-id.ts`,
  `error-handler.ts`, `database-required.ts`.
- **`PHX-DEPLOY-001-LOCAL-PREVIEW-PACKAGING`** (identical to
  `PHX-LIVE-001-PLATFORM-LIVE-INTEGRATION-READINESS`'s backend, byte-for-byte
  except `.env.example`) had `src/middleware/dev-cors.ts`, but its
  `src/auth/request-actor.ts` file header literally reads "PHX-BACKEND-006 —
  Auth Session Foundation & Permission Boundary" — this backend snapshot
  **predates PHX-BACKEND-009-R1 entirely**. It has no `actor-resolver.ts`,
  no `token-verifier.ts`, no `auth_identities` migration, and no
  `PHOENIX_AUTH_MODE` support of any kind.

These are the two unreconciled lineages PHX-DEPLOY-002's Blocker B1 named.
Neither package alone contains oidc-jwt auth **and** CORS together.

### What was done

1. Took `PHX-AUTH-002-R1`'s `apps/backend` as the base (the genuine superset —
   verified above).
2. Added a new `src/middleware/cors.ts` implementing the production allowlist
   this sprint's Task 2 requires (see B2 below), rather than porting the old
   dev-only `dev-cors.ts` forward as-is.
3. Wired the new middleware into `server.ts`, ahead of route registration.
4. Retained `dev-cors.ts` in the tree (copied from `PHX-DEPLOY-001`) for
   reference/local-dev convenience, but **did not** wire it into `server.ts` —
   running both together would risk duplicate/conflicting CORS headers. This
   is documented at the top of the file itself.
5. Extended `src/config/env.ts`'s neighbor `readiness.ts` (not `env.ts` itself)
   with a safe `cors` status block (see B2/Task 3 below).

### Verification (not just a claim)

- `pnpm --filter @phoenix/backend type-check` — **PASS**, no errors.
- `pnpm --filter @phoenix/backend lint` — **PASS**, no errors.
- `pnpm --filter @phoenix/backend build` — **PASS**, no errors.
- `db:migrate` — both migrations applied, including `0002_auth_identities.sql`.
- `db:seed` — applied, then **re-run for idempotency** — identical row counts
  both times (see `PHX_DEPLOY_003_RUNTIME_QA_REPORT.md`).
- `db:smoke` — connected, 23 public tables including `auth_identities`.
- All five `PHOENIX_AUTH_MODE` values (`dev-header`, `production-disabled`,
  `token-placeholder`, `oidc-jwt` configured/misconfigured) exercised against
  the live, running merged backend — see runtime QA report for the full
  request/response matrix.

One unified, buildable backend source tree now exists, and it was actually
built and run, not merely assembled.

### Platform side

Unlike the backend, the platform lineage in the provided snapshot was a
**clean, monotonic superset chain**: 009 → DEPLOY-001 → 010 → 010-R1 → 011 →
011-R1, verified by diffing each pair's `apps/platform/src` file list (each
step is strictly additive; nothing was dropped along the way except two files
in the 009→010 step that were superseded by richer equivalents, confirmed by
inspection). `PHX-PLATFORM-011-R1-LIVE-READ-MIGRATION` was taken as the
platform base with no further reconciliation needed for B1.

---

## B2 — Production CORS allowlist

**Status: RESOLVED.**

- New `src/middleware/cors.ts`: `PHOENIX_ALLOWED_ORIGINS` (comma-separated),
  no wildcard ever honored (a literal `*` entry is parsed and explicitly
  discarded, with a one-time console warning — never expanded to "allow
  all"), correct preflight/`Vary`/expose headers, safe under
  `NODE_ENV=production`, no `Access-Control-Allow-Credentials` (this backend
  uses bearer tokens / a dev header, never cookies).
- Registered unconditionally in `server.ts`, ahead of route registration.
- `/api/readiness` now exposes a safe `cors` block — see B3's sibling, Task 3,
  below.
- Full curl QA matrix (allowed origin, disallowed origin, preflight, actual
  GET, wildcard-rejection) run against a live backend — see
  `PHX_DEPLOY_003_RUNTIME_QA_REPORT.md` and
  `PHX_DEPLOY_003_CORS_SECURITY_DESIGN.md`.

## Task 3 — Readiness CORS status

**Status: RESOLVED.** `/api/readiness`'s `cors` block reports
`status` (`configured` | `not_configured`), `allowedOriginsCount`, and
`wildcardAllowed` (always `false`) — never the actual configured origin
strings themselves, treated as sensitive enough to omit per the task brief's
own allowance ("do not expose the actual origins... if exposing is
considered sensitive"). Verified live in all CORS runtime QA runs.

---

## B3 — Platform Clerk middleware

**Status: ALREADY RESOLVED in the provided source — verified, not rebuilt.**

`apps/platform/src/middleware.ts` was already present in
`PHX-PLATFORM-011-R1-LIVE-READ-MIGRATION`, and its contents match the task
brief's required code verbatim:

```typescript
import { clerkMiddleware } from '@clerk/nextjs/server';

export default clerkMiddleware();

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
```

`@clerk/nextjs` is pinned to `^6.12.0` in `apps/platform/package.json`, which
is compatible with `clerkMiddleware()` from `@clerk/nextjs/server`.

Confirmed compiled into the production build: `pnpm --filter @phoenix/platform
build` reports a `ƒ Middleware  78.5 kB` bundle.

### Important finding surfaced by actually running it (see Task 10 / QA report)

`clerkMiddleware()`'s matcher intentionally covers nearly every route,
which means **it requires syntactically-valid Clerk publishable and secret
keys to be present just to boot** — in every `NEXT_PUBLIC_PHOENIX_API_MODE`,
including `mock` and `real-dev`, which have nothing to do with Clerk
conceptually. Without both keys, every matched route 500s with
`@clerk/nextjs: Missing publishableKey` / `Missing secretKey`, regardless of
API mode. This is not a mock/real-dev regression introduced by this sprint —
it is how the already-approved PHX-PLATFORM-011-R1 middleware behaves, and a
real hosted deployment (per `PHX_DEPLOY_002_ENV_AND_SECRETS_CHECKLIST.md`)
will always have both keys configured. It is called out here because local
QA without a real Clerk app required supplying placeholder-shaped keys to
even observe mock/real-dev pages boot, and because **both keys must be
present at `next build` time**, not only at runtime — a `next start` against
artifacts built without them will keep failing even if `.env.local` is
corrected afterward, until a rebuild happens. See
`PHX_DEPLOY_003_RUNTIME_QA_REPORT.md` §Task 10 for the full reproduction and
`PHX_DEPLOY_002_ENV_AND_SECRETS_CHECKLIST.md` for why hosted preview always
has real keys anyway. No code change was made for this — it is documented as
an operational requirement for anyone running local QA without a Clerk app.

---

## Task 5 — Clerk backend token template

**Status: ALREADY RESOLVED in the provided source — verified, not rebuilt.**

`apps/platform/src/lib/auth/platform-auth.server.ts` line ~191:
```typescript
const token = await getToken({ template: 'phoenix-backend' });
```
`apps/platform/src/lib/real-api-client.server.ts` confirmed: production-auth
sends `Authorization: Bearer <token>` only, real-dev sends `X-Phoenix-User-Id`
only, mock mode sends neither. No token is written to
`localStorage`/`sessionStorage` anywhere in `apps/platform/src` (confirmed by
grep — see security scan report); the only browser-storage usage found is a
mock-mode "active role" label in `mock-session.ts`, unrelated to
authentication.

---

## Overall status

| Item | Status |
|---|---|
| B1 — unified backend source tree | **Resolved**, built and run |
| B2 — production CORS allowlist | **Resolved**, curl-verified |
| B3 — platform Clerk middleware | **Already resolved**, verified in place |
| Task 3 — readiness CORS status | **Resolved** |
| Task 5 — Clerk backend token template | **Already resolved**, verified |
| Hosted Private Preview | Still gated — see Release Notes for the
  remaining human-in-the-loop items (real Clerk app, real preview DNS/hosting
  target) this sprint could not perform from a sandboxed environment |
| Public Deployment | **No-Go**, unchanged |
| PBRS scoring / dimensions / certification thresholds | **Unchanged** —
  confirmed six-dimension model intact in `packages/pbrs/src/index.ts` via
  `@phoenix/core`'s `PBRS_DIMENSIONS`; no file under `packages/pbrs` or
  `packages/core`'s PBRS contracts was touched this sprint |
