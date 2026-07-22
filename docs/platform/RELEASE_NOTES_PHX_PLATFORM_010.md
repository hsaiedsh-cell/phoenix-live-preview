# Release Notes — PHX-PLATFORM-010: Clerk Platform Auth Integration

**Release label:** PHX-PLATFORM-010-CLERK-PLATFORM-AUTH-INTEGRATION
**Status:** Platform auth integration foundation. **Not a public launch.**

## What changed

- Added a new platform API/auth mode, `production-auth` (alias:
  `clerk-auth`), alongside the existing `mock`, `real-dev`, and
  `real-disabled` modes (`lib/api-config.ts`).
- Added `@clerk/nextjs` as a real dependency (`apps/platform/package.json`)
  and wired it in behind a mode check (`ClerkProviderShell.tsx`) — Clerk is
  never loaded or required outside `production-auth` mode.
- Added a Clerk-backed sign-in path to `/login` (`ClerkSignInPanel.tsx`),
  rendered only in `production-auth` mode; the existing mock/real-dev login
  form is unchanged.
- Added a platform auth boundary (`lib/auth/platform-auth.{client,server}.ts`)
  that resolves the current Clerk session and mints backend bearer tokens
  without any page importing the Clerk SDK directly.
- `real-api-client.ts` now attaches `Authorization: Bearer <token>` in
  `production-auth` mode and `X-Phoenix-User-Id` in `real-dev` mode — never
  both, never the wrong one for the active mode.
- Added `ProductionAuthGate.tsx`, used in place of `AuthGate.tsx` for every
  route under `(platform)` when `production-auth` is active — shows a
  config-missing or sign-in-required panel instead of platform/mock data.
- Settings page runtime indicator now reports API mode, backend URL, Clerk-
  configured status, and (in `production-auth`) the resolved sign-in state,
  with explicit warnings for misconfiguration.
- Documented the new env vars in `apps/platform/.env.example` and
  `.env.local.example` (new files) and the root `.env.example`.

## What was preserved

- `mock` remains the default mode and is byte-for-byte unchanged in
  behavior and build output.
- `real-dev` (PHX-LIVE-001: dev-header, `X-Phoenix-User-Id`, no auth) is
  preserved exactly, now merged into the canonical `api-config.ts` /
  `real-api-client.ts` file structure instead of living in a separate patch.
- `AuthGate.tsx`, `SessionProvider.tsx`, `mock-session.ts`, and the mock
  login form are **unmodified**.
- Governance actions (issue/revoke passport, grant/revoke certification)
  remain mock-only in every mode — `production-auth` and `real-dev` alike
  still receive the documented "not enabled" response for these, exactly as
  PHX-PLATFORM-009 left them.
- No PBRS dimension, weight, or certification threshold was touched. PBRS
  remains locked to the approved six-dimension model (Accuracy, Compliance,
  Brand Alignment, Structure, Consistency, Completeness).
- No token is stored in `localStorage`/`sessionStorage` anywhere in the app.
- No backend source file was modified — PHX-AUTH-002-R1's backend (`oidc-jwt`
  resolver, Clerk selected as provider) is the unmodified backend this
  sprint integrates against.

## Limitations

- This is an auth **boundary**, not a full data migration: platform pages
  still read through the existing mock-backed `api-client.ts` facade for
  display data; only the header-attachment/gating layer is production-auth-
  aware this sprint.
- No real Clerk account/dashboard was used — sign-in was verified only via
  static build QA (see `PHX_PLATFORM_010_AUTH_QA_REPORT.md`), not a live
  session round-trip.
- No live backend was started against real-dev or production-auth mode this
  sprint — no real HTTP round-trip to `apps/backend` was exercised.
- `middleware.ts` was not added; route protection is handled entirely by
  the shared gate component in the `(platform)` layout.
- **Public launch remains No-Go.** This sprint does not implement customer
  onboarding, auto-provisioning, or enterprise SSO, and does not claim
  production readiness for real traffic.

## Next sprint

Candidates for the next platform/auth sprint (none started this sprint):

1. **Real Clerk account verification** — connect an actual (free-tier)
   Clerk application, exercise a live sign-in → token → backend
   `oidc-jwt` round trip end-to-end, and capture real QA evidence (this
   sprint's QA was necessarily static/build-only, per its own "no paid/
   provider account required" constraint).
2. **Wire remaining platform pages to real reads** — migrate
   `/dashboard`, `/assessments`, `/passports`, etc. off `mock-api-client.ts`
   and onto the `real*` read functions this sprint added to
   `real-api-client.ts`, for both `real-dev` and `production-auth`.
3. **`auth_identities` linking UX** — a first-time-linking flow for a
   verified Clerk identity with no matching Phoenix user yet (today this
   fails closed per PHX-AUTH-002's "no auto-provisioning" rule; there is no
   platform-side UI for it).
