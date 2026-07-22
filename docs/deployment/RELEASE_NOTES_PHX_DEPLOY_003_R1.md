# Release Notes — PHX-DEPLOY-003-R1 — Middleware Mode Safety Fix & Doc Cleanup

**Type:** Focused fix + documentation cleanup on top of PHX-DEPLOY-003.
**No deployment was performed — public or hosted.**

## What changed

- **`apps/platform/src/middleware.ts`:** `clerkMiddleware()` is now only
  constructed and invoked when `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and
  `CLERK_SECRET_KEY` are both present. Otherwise, a plain pass-through
  middleware runs — no Clerk SDK code is imported or executed, and no
  Clerk network call is ever attempted, in mock or real-dev mode.
- **`apps/backend/.env.example`:** two passages that incorrectly implied a
  misconfigured `oidc-jwt` mode "falls back" to a different default are
  corrected to state the actual behavior: explicit `oidc-jwt` always stays
  `oidc-jwt`; incomplete config reports `misconfigured`; protected routes
  return `401 AUTH_NOT_CONFIGURED`; there is no fallback to `dev-header`.

## What was preserved (re-verified, not assumed)

- Production-auth's Clerk session detection: confirmed via
  `x-clerk-auth-status` / `x-clerk-auth-reason` response headers, present
  only when `clerkMiddleware()` genuinely executes.
- Production-auth's fail-closed config-missing gate
  (`ClerkProviderShell`, PHX-PLATFORM-010): confirmed unchanged and still
  renders its "Auth configuration error" panel — never mock data, never a
  crash — when Clerk isn't configured.
- Bearer-token / `X-Phoenix-User-Id` / no-mock-token backend auth header
  behavior: unchanged, re-confirmed by inspection (no file in
  `apps/platform/src/lib/auth/` or `real-api-client*.ts` was touched).
- No token of any kind in `localStorage`/`sessionStorage`.
- PBRS scoring, dimensions, and certification thresholds: unchanged.

## What was fixed

Mock mode and real-dev mode now build, start, and serve all 9 routes
(`/`, `/login`, `/dashboard`, `/assessments`, `/assessments/new`,
`/settings`, `/passports`, `/certifications`, `/reports`) with **zero**
Clerk environment variables configured — verified by actually building and
running both modes with no Clerk keys present anywhere, and confirming
zero Clerk-related errors in server logs.

## Known limitation carried forward (unchanged from PHX-DEPLOY-003)

Real Clerk sign-in was not exercised — `clerk.com` / `api.clerk.dev` (and
even a placeholder fake Clerk domain used for this sprint's local QA) are
unreachable from this sandbox's network egress. A real human/local QA
pass with normal network access against a real Clerk test app is still
required before Hosted Private Preview can go live.

## Go/No-Go

- **Hosted Private Preview: still No-Go.** The middleware mode-safety
  blocker that prompted this R1 is now fixed and verified. The remaining
  gap — a real-network Clerk sign-in QA pass — is unchanged from
  PHX-DEPLOY-003 and still requires a human/unrestricted-network QA pass.
- **Public Deployment: No-Go**, unchanged.

## Next recommended step

Same as PHX-DEPLOY-003: a follow-up sprint or human QA pass to run the
real-Clerk sign-in verification from a network-unrestricted environment
against this now-corrected tree, then make the actual hosted-preview
Go/No-Go call.
