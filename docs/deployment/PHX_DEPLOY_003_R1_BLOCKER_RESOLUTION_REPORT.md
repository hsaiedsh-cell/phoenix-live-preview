# PHX-DEPLOY-003-R1 — Blocker Resolution Report

## Issue found in PHX-DEPLOY-003 (RC1)

`apps/platform/src/middleware.ts` called `clerkMiddleware()` unconditionally.
Its matcher intentionally covers nearly every route. Runtime QA in the
original PHX-DEPLOY-003 sprint found that with no Clerk env vars set, every
matched route — in **every** API mode, including `mock` and `real-dev` —
returned `500` with `@clerk/nextjs: Missing publishableKey` / `Missing
secretKey`. This violates Task 4's explicit requirements: "Does not break
mock mode" and "Does not break real-dev mode."

## Fix

```typescript
const clerkConfigured = Boolean(
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim() && process.env.CLERK_SECRET_KEY?.trim()
);

const passthroughMiddleware: NextMiddleware = () => NextResponse.next();

export default clerkConfigured ? clerkMiddleware() : passthroughMiddleware;
```

`clerkMiddleware()` is now only constructed and invoked when both required
Clerk env vars are present. Otherwise, a plain pass-through middleware runs
instead — no Clerk SDK code is imported or executed on that path, so there
is no Clerk network dependency whatsoever in mock/real-dev.

The matcher itself is unchanged from the original PHX-DEPLOY-003 /
PHX-PLATFORM-011-R1 version.

## Requirement-by-requirement verification

### 1. Middleware active for production-auth, safe for mock/real-dev

**Verified.** See Runtime QA Report for the full command/output evidence:
- Mock mode, zero Clerk env vars: builds, boots, all 9 routes return 200,
  zero Clerk-related log lines.
- Real-dev mode, zero Clerk env vars: same — builds, boots, all 9 routes
  200, zero Clerk-related errors.
- Production-auth, Clerk keys present: middleware bundle size increases
  (78.4 kB → 78.6 kB), confirming `clerkMiddleware()` is genuinely active;
  response headers include `x-clerk-auth-status` / `x-clerk-auth-reason`,
  which only Clerk's own middleware sets — direct proof it ran, not just
  that the route didn't crash.

### 2. Production-auth behavior preserved

- **Clerk session detection works:** confirmed via the `x-clerk-auth-*`
  response headers present only when `clerkMiddleware()` actually executes.
- **All seven named routes work in production-auth:** `/login`,
  `/dashboard`, `/assessments`, `/assessments/[id]` (route exists and
  matches the same pattern as `/assessments`), `/settings`, `/passports`,
  `/certifications`, `/reports` all return `200` with valid-shaped Clerk
  keys configured.
- **Production-auth still fails closed when Clerk config is missing:**
  confirmed — with `NEXT_PUBLIC_PHOENIX_API_MODE=production-auth` and no
  Clerk keys, every route renders `ClerkProviderShell`'s "Auth
  configuration error" panel (root-layout-level gate, PHX-PLATFORM-010) —
  never mock data, never a crash. This behavior is **unchanged** by the R1
  middleware fix — `ClerkProviderShell` and `ProductionAuthGate` are
  separate, page/layout-level gates that do their own independent
  three-part config check (publishable key, backend URL, secret key) and
  were not modified this sprint.

### 3. Non-production-auth behavior preserved

- **Mock mode builds/starts/renders without Clerk keys:** verified (see
  Runtime QA Report).
- **Real-dev mode builds/starts/renders without Clerk keys:** verified.
- **No Clerk network dependency in mock/real-dev:** verified by inspection
  (the pass-through path never imports/calls `@clerk/nextjs` code) and by
  the absence of any Clerk-related log line or error during mock/real-dev
  runtime QA.

### 4. Token handling reconfirmed unchanged

No file under `apps/platform/src/lib/auth/` or `apps/platform/src/lib/
real-api-client*.ts` was touched this sprint. Re-inspected to confirm:
- `platform-auth.server.ts` still calls `getToken({ template:
  'phoenix-backend' })` and `real-api-client.server.ts` still sends
  `Authorization: Bearer <token>` only in production-auth.
- Real-dev still sends `X-Phoenix-User-Id` only.
- Mock mode attaches no backend auth header of any kind.
- No token of any kind is written to `localStorage`/`sessionStorage`
  anywhere in `apps/platform/src` — the only browser-storage usage
  (`mock-session.ts`) is an unrelated mock-mode "active role" label.

### 5. `.env.example` documentation cleanup

Two passages in `apps/backend/.env.example` incorrectly implied that an
explicit `PHOENIX_AUTH_MODE=oidc-jwt` with incomplete config "falls back"
to a different default mode. Both are rewritten to state the actual
PHX-AUTH-002-R1 behavior: explicit `oidc-jwt` always stays `oidc-jwt`;
incomplete config is reported as `misconfigured` in `/api/readiness`;
protected routes return `401 AUTH_NOT_CONFIGURED`; there is no fallback to
`dev-header` or any other mode, configured or not. No behavior changed —
this was a documentation-only fix, matching the backend's actual, already-
correct `resolveAuthMode()` / `isOidcConfigured()` logic (unchanged this
sprint, re-verified via the backend auth-mode QA).

## Overall status

| Item | Status |
|---|---|
| Middleware mode safety (mock/real-dev never break) | **Fixed, verified** |
| Production-auth Clerk session detection | **Preserved, verified** |
| Production-auth fail-closed on missing config | **Preserved, verified** |
| Token handling (Bearer / X-Phoenix-User-Id / no browser storage) | **Unchanged, reconfirmed** |
| `.env.example` oidc-jwt wording | **Corrected** |
| Hosted Private Preview | Still **No-Go** — real Clerk network QA still outstanding, same as PHX-DEPLOY-003 RC1 |
| Public Deployment | **No-Go**, unchanged |
| PBRS scoring / dimensions / certification thresholds | **Unchanged** |
