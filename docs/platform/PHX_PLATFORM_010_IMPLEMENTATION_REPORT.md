# PHX-PLATFORM-010 — Implementation Report

**Task:** Clerk Platform Auth Integration
**Builds on:** PHX-AUTH-002-R1 (backend `oidc-jwt` resolver, Clerk selected as
MVP provider), PHX-AUTH-001 (production auth strategy), PHX-BACKEND-009-R1,
PHX-LIVE-001 (real-dev reads), PHX-PLATFORM-006/008/009 (mock session, auth
gating, mode boundary).
**Scope:** Platform auth integration foundation only. No public deployment, no
customer onboarding, no PBRS/scoring/certification-threshold changes, no
backend source changes.

## Sources read before implementation

Per standing project discipline, every listed source was read in full before
any code was written:

- `ADR_PHX_AUTH_001_PRODUCTION_AUTH_STRATEGY.md` — hosted-provider decision,
  provider-as-identity-source-only rule, non-goals.
- `ADR_PHX_AUTH_002_VENDOR_DECISION.md` — Clerk selected as MVP provider;
  standard JWT/JWKS, no lock-in at the authorization layer.
- `apps/backend/src/auth/actor-resolver.ts`, `token-verifier.ts`,
  `config/env.ts`, `routes/readiness.ts` (PHX-AUTH-002-R1) — the exact
  `PHOENIX_AUTH_MODE=oidc-jwt` contract, required env vars
  (`PHOENIX_AUTH_ISSUER` / `_AUDIENCE` / `_JWKS_URI` / `_PROVIDER`), and the
  fail-closed rule this sprint's platform-side config mirrors.
- `apps/backend/.env.example` (PHX-AUTH-002-R1) — provider-agnostic verifier,
  Clerk as the configured provider value.
- PHX-BACKEND-009-R1 doc-cleanup note — confirms current backend release
  history and the standing instruction not to reintroduce a "PBRS alignment
  sprint" as an active open item.
- PHX-LIVE-001's `apps/platform/src/lib/api-config.ts` and
  `real-api-client.ts` — the `real-dev` mode contract (X-Phoenix-User-Id,
  `NEXT_PUBLIC_PHOENIX_BACKEND_URL` / `_DEV_USER_ID`) this sprint had to
  preserve exactly.
- PHX-PLATFORM-009's full `apps/platform` tree — the actual current
  `api-config.ts` (mock / real-disabled only, `real-dev` not yet merged in),
  `real-api-client.ts` (disabled skeleton), `api-client.ts` (governance-action
  mode boundary), `AuthGate.tsx`, `SessionProvider.tsx`, `login/page.tsx`,
  `(platform)/settings/page.tsx`, `(platform)/layout.tsx`, `mock-session.ts`,
  `auth-types.ts`.

**Base-state note:** PHX-PLATFORM-009's delivered tree did not yet contain
PHX-LIVE-001's `real-dev` mode — PHX-LIVE-001 shipped as a small, explicitly
"merge this into the existing settings page" patch, not a fully merged tree.
This sprint's `api-config.ts` and `real-api-client.ts` merge PHX-LIVE-001's
`real-dev` behavior into PHX-PLATFORM-009's canonical file structure (the
`PhoenixApiResponse` / `PhoenixApiRequestOptions` envelope), rather than
carrying forward PHX-LIVE-001's separate, differently-shaped client as a
second file. This is a deliberate deviation, documented here per the "any
deliberate deviation from the task brief must be documented" rule: the
result is one coherent `real-api-client.ts` with three real behaviors (real-dev
reads, real-disabled, production-auth reads) instead of two competing client
files.

## Task 1 — Platform Auth Mode Design

`apps/platform/src/lib/api-config.ts` was rewritten (not patched) to add
`'production-auth'` (alias accepted: `'clerk-auth'`) to `PhoenixApiMode`,
alongside the existing `'mock'`, `'real-dev'`, `'real-disabled'`.

- `NEXT_PUBLIC_PHOENIX_API_MODE=production-auth` is the canonical value used
  throughout code/docs; `clerk-auth` is accepted as an equivalent alias at
  the `resolveApiMode()` boundary only, so either spelling resolves to the
  same `PhoenixApiMode` value (`'production-auth'`) everywhere downstream —
  there is exactly one mode value, not two.
- `mock` remains the default for any unset/unrecognized value.
- `real-dev` is unchanged in meaning from PHX-LIVE-001: dev-header, no auth,
  requires `NEXT_PUBLIC_PHOENIX_BACKEND_URL` + `NEXT_PUBLIC_PHOENIX_DEV_USER_ID`.
- `production-auth` requires `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`,
  `CLERK_SECRET_KEY`, and `NEXT_PUBLIC_PHOENIX_BACKEND_URL`. Missing any of
  these sets `isMisconfigured: true` and the mode stays `production-auth` —
  it never substitutes `mock` or `real-dev` (verified in Task 8/9 below).
- Updated: `apps/platform/.env.example` (new, full variable list + doc
  comments), `apps/platform/.env.local.example` (new, mirrors `.env.example`),
  root `.env.example` (updated to the new mode list; kept as a minimal
  pointer to the authoritative `apps/platform/.env.example`).

## Task 2 — Clerk Dependency and Provider

- Added `@clerk/nextjs@^6.12.0` to `apps/platform/package.json` dependencies
  (real dependency — actually installed and built against, not a stub).
- `apps/platform/src/components/ClerkProviderShell.tsx` (new) wraps children
  in `@clerk/nextjs`'s `ClerkProvider` only when
  `getPhoenixApiConfig().mode === 'production-auth'`. In every other mode it
  is a plain passthrough — `@clerk/nextjs` is still imported at the top of
  this one file (a static import, not dynamic — see note below), but the
  component itself never renders `<ClerkProvider>` outside production-auth,
  so no Clerk env var is ever required for mock/real-dev/real-disabled
  builds, and Clerk's client script is never mounted for those modes.
- If `production-auth` is selected but `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` is
  missing, `ClerkProviderShell` renders a controlled inline error instead of
  letting `ClerkProvider` throw — verified in Task 9's "missing config"
  build (see QA report).
- `apps/platform/src/app/layout.tsx` now wraps `<SessionProvider>` (the
  existing PHX-PLATFORM-006/008 mock-session context, unchanged) inside
  `<ClerkProviderShell>`. `SessionProvider` still runs unconditionally in
  every mode — mock/real-dev pages calling `usePhoenixSession()` are
  unaffected by Clerk being mounted or not.
- **Static vs. dynamic Clerk import trade-off:** `ClerkProviderShell.tsx`
  imports `{ ClerkProvider }` from `@clerk/nextjs` at module top level
  (static import), not via `await import(...)`. This is safe because
  `@clerk/nextjs`'s `ClerkProvider` does not throw at *module-evaluation*
  time when unconfigured — only if actually *rendered* without a
  `publishableKey` — and `ClerkProviderShell` guards that render behind the
  `mode === 'production-auth'` check first. `platform-auth.server.ts`, by
  contrast, DOES use a dynamic `await import('@clerk/nextjs/server')` inside
  its `production-auth`-only branches, because `@clerk/nextjs/server`'s
  `auth()`/`currentUser()` do real request-time work that should never run
  outside that mode.

## Task 3 — Login Page

`apps/platform/src/app/login/page.tsx`:

- Added an early-return branch: if `getPhoenixApiConfig().mode ===
  'production-auth'`, render `<ClerkSignInPanel apiConfig={apiConfig} />`
  (new Client Component) instead of the mock form.
- mock/real-dev: the entire rest of the function — mock email/password
  fields (still disabled/unvalidated exactly as before), `LoginRoleSelector`,
  the disabled "Enterprise SSO (not connected)" button, and the Alpha notice
  — is byte-for-byte unchanged from PHX-PLATFORM-006/008.
- `apps/platform/src/components/ClerkSignInPanel.tsx` (new, `'use client'`):
  renders `@clerk/nextjs`'s `<SignIn routing="hash" signUpUrl="/login" ... />`
  when Clerk is configured; a controlled "sign-in is not configured" panel
  otherwise. `signUpUrl="/login"` and no separate sign-up CTA are surfaced —
  sign-up is not enabled as a distinct flow this sprint (Task 3's "sign-up
  disabled or documented as not configured" instruction); an inline
  `AlphaNotice` explicitly states this.
- No password fields, no custom credential handling, no localStorage token
  storage anywhere in this branch — Clerk's own `<SignIn>` component owns
  the entire credential UI.

## Task 4 — Auth State Boundary

New `apps/platform/src/lib/auth/` directory, split per Next.js server/client
boundary as the task brief's "preferred if required" option:

- `platform-auth.client.ts` — `getBackendAuthHeaders()`. Returns
  `{ ok: false }` immediately for any mode other than `production-auth` or
  when called outside the browser (`typeof window === 'undefined'`); in
  `production-auth` it reads `window.Clerk.session.getToken()` (the client
  session object Clerk's `ClerkProvider` exposes once loaded) and returns
  `{ ok: true, token }` or a typed `{ ok: false, reason }`. Never throws;
  never touches `localStorage`/`sessionStorage`.
- `platform-auth.server.ts` — `resolveProductionAuthState()` (used by
  `ProductionAuthGate`) and `getServerBackendToken()` (a same-shaped
  seam for a future server-side fetch; not called from any code path this
  sprint since `real-api-client.ts`'s `realFetch()` runs client-side).
  Dynamically imports `@clerk/nextjs/server` only inside the
  `production-auth`-and-configured branch.
- `platform-auth.ts` — isomorphic re-export surface (`getPlatformAuthMode()`,
  `isProductionAuthMode()`, plus the two files' result types) safe to import
  from either a Server or Client Component. `(platform)/layout.tsx` imports
  from this file, not from the `.server`/`.client` files directly.

No auth logic was inlined into any page — every page/component that needs to
know the mode or get a token goes through one of these three files.

## Task 5 — Backend Token Attachment

`apps/platform/src/lib/real-api-client.ts` was rewritten:

- `mock`: still makes zero network calls (unchanged).
- `real-dev`: `resolveAuthHeaders()` returns `{ 'X-Phoenix-User-Id':
  config.devUserId }` — exactly PHX-LIVE-001's documented behavior,
  preserved verbatim in the merged file.
- `production-auth`: `resolveAuthHeaders()` calls
  `getBackendAuthHeaders()` (the client boundary from Task 4). If it
  returns `{ ok: false }`, `resolveAuthHeaders()` throws
  `RealApiAuthRequiredError` — callers (the `real*` read functions) do not
  catch this and silently continue; it propagates as a rejected promise, so
  any call site must explicitly handle "sign-in required" rather than
  falling through to mock data. `X-Phoenix-User-Id` is never sent in this
  branch.
- Both `real-dev` and `production-auth` share one `realFetch<T>()` GET
  helper and one HTTP-status-to-typed-error mapping (`RealApiError`), so the
  status-code handling logic PHX-LIVE-001 wrote for `real-dev` is reused
  as-is for `production-auth` rather than duplicated.
- Governance actions (`issuePassport`/`revokePassport`/`grantCertification`/
  `revokeCertification`) in `api-client.ts` are **unchanged**: they still
  only special-case `mode === 'mock'`; every other mode (including the two
  new ones) falls through to `disabledRealApiCall()`, i.e. still returns the
  documented "not enabled" `PhoenixActionResult`. This satisfies "do not
  connect unsupported passport/certification actions" without needing any
  edit to `api-client.ts` itself.
- SSR vs. browser fetch: `realFetch()` itself is environment-agnostic (plain
  `fetch()`); the only environment-sensitive piece is
  `getBackendAuthHeaders()` (client-only, guarded by the `typeof window`
  check) versus `getServerBackendToken()` (server-only, in
  `platform-auth.server.ts`). No call site this sprint calls `realFetch()`
  from a Server Component, so `getServerBackendToken()` remains an unused-
  but-ready seam, documented as such in its own file header — not claimed as
  tested end-to-end.

## Task 6 — Protected Route Handling

- New `apps/platform/src/components/ProductionAuthGate.tsx` (Server
  Component): calls `resolveProductionAuthState()` and renders one of three
  states — `config-missing` (explicit error, no data shown), `signed-out`
  (sign-in-required panel + link to `/login`), or renders `children` when
  `signed-in`. It never renders mock data and never checks for a dev header.
- `apps/platform/src/app/(platform)/layout.tsx` now picks the gate based on
  mode: `getPlatformAuthMode() === 'production-auth' ? ProductionAuthGate :
  AuthGate`. `AuthGate.tsx` itself is **completely unmodified** — mock/
  real-dev behavior is identical to PHX-PLATFORM-006/008.
- This one layout swap covers every route under the `(platform)` route
  group — `/dashboard`, `/assessments`, `/assessments/[id]`,
  `/assessments/new`, `/passports`, `/certifications`, `/reports`,
  `/settings` — without editing each page individually, per the "a shared
  guard/component is preferred" instruction.
- Settings page (below) additionally shows the resolved auth state
  explicitly, on top of the shared gate.

## Task 7 — Settings Runtime Indicator

`apps/platform/src/app/(platform)/settings/page.tsx` was extended (not
replaced): the existing four settings panels, audit preview, and Alpha
notice are all unchanged. The runtime indicator block was expanded from a
single mock/non-mock line to show, for every mode: API mode label, backend
URL (when set), Clerk-configured yes/no (production-auth only), auth state
("not available in {mode} mode" for mock/real-dev/real-disabled, or the
resolved Clerk session state for production-auth via
`resolveProductionAuthState()`), the mode's status description, and an
explicit warning line for `production-auth` misconfiguration or for
`real-dev` (reminding it must never be used in production). No secret value
(`CLERK_SECRET_KEY`, any token) is ever read or rendered here.

## Task 8 — Local Verification Without a Real Clerk Account

Followed **Option A** from the task brief (static/build verification), plus
a grep-based inspection pass (also permitted by Option A):

- Verified via `grep` that `X-Phoenix-User-Id` is only ever set inside the
  `config.mode === 'real-dev'` branch of `resolveAuthHeaders()`, and
  `Authorization: Bearer` only inside the `config.mode === 'production-auth'`
  branch — see QA report for the exact grep output.
- Verified via three separate `next build` runs (mock / real-dev /
  production-auth with a fake-format Clerk key) that `production-auth` does
  not fall back to mock or real-dev, and that a fourth build with
  `production-auth` selected but **no** Clerk key at all resolves to the
  `ClerkProviderShell` "config error" panel at every route (no dynamic
  `headers()` call is even reached in that case, since
  `ClerkProviderShell` short-circuits before `@clerk/nextjs/server` is ever
  imported).
- No real or fake Clerk account/dashboard was used — the "fake-format" key
  in the third build is a syntactically valid `pk_test_...` / `sk_test_...`
  string used only to get past Clerk's own key-format validation during
  static generation; it is not a working credential and no live Clerk
  network call was made or attempted during any build.

## Task 9 — Platform Build QA

See `PHX_PLATFORM_010_AUTH_QA_REPORT.md` for full commands/output. Summary:
`pnpm install` (root, includes `@clerk/nextjs` resolving cleanly),
`type-check`, `lint`, and four `next build` runs (mock, real-dev,
production-auth-with-fake-key, production-auth-with-no-key) all passed
(exit 0). No backend source exists in this deliverable to type-check/build
(see Limitations) — backend compatibility was checked by reading
PHX-AUTH-002-R1's resolver/env/readiness source directly rather than by
running it.

## Task 10 — Documentation

This file, plus `PHX_PLATFORM_010_AUTH_QA_REPORT.md`,
`RELEASE_NOTES_PHX_PLATFORM_010.md`, and `BUILD_REPORT_PHX_PLATFORM_010.md`
(repo root).

## What was tested

- `pnpm install`, `type-check`, `lint`, and `next build` in all four
  documented configurations (see QA report).
- Grep-based confirmation of the X-Phoenix-User-Id / Authorization header
  mode boundary and of zero `localStorage` token usage.
- Manual code review against every "Do not" instruction in the task brief.

## What needs a real Clerk account later

- An actual `<SignIn>` render / redirect flow, a real webhook-free session
  round-trip (`window.Clerk.session.getToken()` returning a real JWT), and
  a real backend verifying that token end-to-end against `PHOENIX_AUTH_MODE=
  oidc-jwt` were not exercised — this requires a real (even free-tier)
  Clerk application and was explicitly out of scope ("no paid/provider
  account should be required").
- `getServerBackendToken()` (the server-side token seam) has no caller yet
  and is therefore unverified beyond type-checking against
  `@clerk/nextjs/server`'s published types.
- Only the four documented read endpoints from PHX-BACKEND-008-R1 are
  exposed via `real-api-client.ts`; no platform page was migrated off mock
  data in this sprint (see Limitations).

## Limitations

- Not every platform page was rewired to call the new `real*` read
  functions — this sprint delivers the auth **boundary** (mode resolution,
  header attachment, gating), not a full migration of every page off mock
  data. Pages still call `api-client.ts`, which itself still re-exports the
  mock implementation for all reads (unchanged from PHX-PLATFORM-009).
- `apps/backend` is not included in this deliverable tar — no backend file
  was modified, so per this sprint's own "changed source likely" list
  there is nothing to re-package; PHX-AUTH-002-R1's backend remains the
  authoritative, unmodified backend state.
- Real end-to-end Clerk sign-in was not exercised (see above).
- `middleware.ts` (listed as optional in the task brief) was not added —
  route protection this sprint is handled entirely by
  `ProductionAuthGate`/`AuthGate` inside the `(platform)` layout, which
  covers every route under that group without a separate middleware file.
  A future sprint may add `middleware.ts` if edge-level redirect (rather
  than a rendered "sign in required" panel) becomes a requirement.
- No public launch, customer onboarding, or auto-provisioning exists or is
  claimed anywhere in this deliverable.
