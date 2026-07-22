# Release Notes — PHX-PLATFORM-010-R1: Clerk Config Gate & Mock Data Transparency Fix

**Release label:** PHX-PLATFORM-010-R1-CLERK-PLATFORM-AUTH-INTEGRATION
**Type:** Targeted safety/transparency fix on top of PHX-PLATFORM-010. No
new features. **Not a public launch.**

## What changed

**Issue 1 — CLERK_SECRET_KEY fail-closed gate:**

- `lib/auth/platform-auth.server.ts` gained a server-only
  `getServerAuthConfigStatus()` check that verifies
  `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `NEXT_PUBLIC_PHOENIX_BACKEND_URL`,
  **and** `CLERK_SECRET_KEY` are all present before `resolveProductionAuthState()`
  or `getServerBackendToken()` ever imports `@clerk/nextjs/server`.
- A missing `CLERK_SECRET_KEY` — even with the publishable key and backend
  URL both present — now resolves to `config-missing`, and `auth()`/
  `currentUser()` are never called in that state. It can no longer be
  conflated with an ordinary `signed-out` session.
- The secret key's value is never read into any exported variable, logged,
  or displayed — only a boolean ("configured: yes/no") is ever produced.
- Settings runtime indicator now shows, in production-auth mode: Clerk
  publishable key configured (yes/no), Clerk server key configured
  (yes/no), Backend URL configured (yes/no), and Auth state (config
  missing / signed out / signed in).

**Issue 2 — mock data transparency (Option A):**

- A new persistent banner (`MockDataTransparencyBanner.tsx`) is shown on
  every signed-in production-auth route: "Production-auth is active. Some
  platform data is still mock-backed until live read migration is
  completed in PHX-PLATFORM-011."
- Rendered only by `ProductionAuthGate`'s signed-in branch — never in mock
  or real-dev mode, and never in the config-missing/signed-out states.

## What was preserved

- All four modes (mock, real-dev, real-disabled, production-auth) remain
  present — none were removed.
- `mock` and `real-dev` behavior, build output, and UI are byte-for-byte
  unchanged.
- `AuthGate.tsx`, `SessionProvider.tsx`, `mock-session.ts`,
  `LoginRoleSelector.tsx`, the mock login form: unmodified.
- `real-api-client.ts`'s header-attachment logic (X-Phoenix-User-Id in
  real-dev, Authorization Bearer in production-auth) was not touched and
  remains correct — re-verified this sprint via the same grep checks used
  in PHX-PLATFORM-010.
- No backend source file was modified.
- No PBRS dimension, weight, or certification threshold was touched.
- No token is stored in `localStorage`/`sessionStorage`.
- No customer onboarding or public launch claim was added.

## Verification highlights

The most significant single verification this sprint: building
production-auth with `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and
`NEXT_PUBLIC_PHOENIX_BACKEND_URL` set but `CLERK_SECRET_KEY` **omitted**
produces an entirely **static** route table — proving `auth()` was never
invoked — versus the fully-configured build, which is entirely **dynamic**.
This is direct build-level evidence that the fix works, not just a code
read. See `PHX_PLATFORM_010_R1_AUTH_QA_REPORT.md` §8 for the full
before/after route tables.

## Limitations

- No real Clerk account was used; no live backend round-trip was
  exercised (same constraints as PHX-PLATFORM-010).
- Page-by-page migration off mock data remains out of scope — the banner
  is a transparency measure, not a fix for the underlying gap (tracked as
  PHX-PLATFORM-011).
- The Settings page's `config-missing`/`signed-out` display states are not
  reachable in a real browser session because `ProductionAuthGate`
  intercepts those states first with its own screen — verified via build
  shape and code review instead (see QA report).
- Public launch remains No-Go.

## Next sprint

Unchanged from PHX-PLATFORM-010's own "Next sprint" list — most notably
**PHX-PLATFORM-011: live read migration**, which this sprint's banner
explicitly references as the sprint that will retire the banner once
platform pages are wired to real backend reads instead of
`mock-api-client.ts`.
