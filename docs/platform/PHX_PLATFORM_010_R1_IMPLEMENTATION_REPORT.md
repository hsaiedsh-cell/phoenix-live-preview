# PHX-PLATFORM-010-R1 — Implementation Report

**Task:** Clerk Config Gate & Mock Data Transparency Fix
**Type:** Targeted safety/transparency fix on top of the completed
PHX-PLATFORM-010 deliverable. No new features. No mode was removed. No
backend auth logic, PBRS, scoring, or certification threshold was touched.

## Issue 1 — CLERK_SECRET_KEY fail-closed gate

### Problem confirmed

`api-config.ts`'s `getPhoenixApiConfig().isMisconfigured` (the only gate
PHX-PLATFORM-010's `resolveProductionAuthState()` originally checked) is
computed entirely from `NEXT_PUBLIC_*` vars — it never reads
`CLERK_SECRET_KEY`, deliberately, since `api-config.ts` is imported from
both Server and Client Components and must never risk a secret ending up in
a client bundle. The practical consequence: a deployment with
`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `NEXT_PUBLIC_PHOENIX_BACKEND_URL`
set but `CLERK_SECRET_KEY` missing was reported as fully configured by
`isMisconfigured`, so `resolveProductionAuthState()` proceeded straight to
`@clerk/nextjs/server`'s `auth()` — which, lacking a secret key, throws —
and the surrounding `try/catch` mapped that into `{ mode: 'signed-out' }`,
identical to an ordinary "no session yet" case. A broken deployment was
silently indistinguishable from a normal logged-out user.

### Fix

`apps/platform/src/lib/auth/platform-auth.server.ts` (server-only module —
never imported from a `'use client'` file) gained:

- `isServerClerkSecretConfigured()` — a private function that reads
  `process.env.CLERK_SECRET_KEY` directly and returns **only a boolean**
  (non-empty string → `true`). The value itself is read into a local
  `const value` that is never returned, logged, assigned to any exported
  object, or passed as a prop — it exists only inside this one function's
  scope for the length of one `typeof`/`.trim().length` check.
- `getServerAuthConfigStatus()` — combines this new boolean with
  `api-config.ts`'s client-safe `clerkPublishableKey` and `baseUrl` presence
  into one `ServerAuthConfigStatus` object:
  `{ publishableKeyConfigured, secretKeyConfigured, backendUrlConfigured,
  fullyConfigured, missing: string[] }`. `missing` contains only variable
  *names*, never values.
- `resolveProductionAuthState()` now calls
  `getServerAuthConfigStatus().fullyConfigured` **before** ever importing
  `@clerk/nextjs/server`. If any of the three required vars is missing —
  including `CLERK_SECRET_KEY` alone, with the other two present — it
  returns `{ mode: 'config-missing', missing }` immediately.
  `auth()`/`currentUser()` are only reached once all three are confirmed
  present. This means a missing `CLERK_SECRET_KEY` can no longer produce
  `'signed-out'` — it is unambiguously `'config-missing'`.
- `getServerBackendToken()` (the server-side bearer-token seam, unused by
  any call site so far — see PHX-PLATFORM-010's implementation report) got
  the identical gate for consistency, so a future caller gets the same
  fail-closed guarantee.
- Exactly three required vars are checked, matching the task's exact list:
  `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `NEXT_PUBLIC_PHOENIX_BACKEND_URL`,
  `CLERK_SECRET_KEY`.

### Settings runtime indicator

`apps/platform/src/app/(platform)/settings/page.tsx` now calls
`getServerAuthConfigStatus()` (production-auth mode only) and displays,
exactly per the task's required list:

- **Clerk publishable key configured: yes/no**
- **Clerk server key configured: yes/no** (boolean only — never the value)
- **Backend URL configured: yes/no**
- **Auth state:** one of `config missing` / `signed out` / `signed in` (or
  `not available in {mode} mode` for mock/real-dev/real-disabled, which is
  an explicit, unambiguous fourth state distinct from the three required
  production-auth values).

**Reachability note:** because `ProductionAuthGate` wraps the entire
`(platform)` route group (including `/settings` itself), a user can only
ever *see* the Settings page's "signed in" auth-state line in practice —
the `config-missing` and `signed-out` states are intercepted earlier by
`ProductionAuthGate`'s own gate screens (which already state the missing
vars / sign-in requirement clearly to the user). The Settings page's
indicator logic for all three states was still implemented, exercised via
`getServerAuthConfigStatus()` directly, and confirmed correct via the build
matrix below (a config-missing build never reaches the dynamic `auth()`
call, which is only observable through the static/dynamic route table, not
through a rendered Settings screenshot). This is documented rather than
silently left as an untestable code path.

## Issue 2 — Mock data transparency (Option A, preferred)

`apps/platform/src/components/MockDataTransparencyBanner.tsx` (new): a
sticky, high-visibility banner with the exact required copy:

> "Production-auth is active. Some platform data is still mock-backed
> until live read migration is completed in PHX-PLATFORM-011."

`ProductionAuthGate.tsx`'s `signed-in` branch now renders this banner
immediately above `children`:

```tsx
return (
  <>
    <MockDataTransparencyBanner />
    {children}
  </>
);
```

- Shown on every signed-in production-auth route, since `ProductionAuthGate`
  wraps the whole `(platform)` route group (`/dashboard`, `/assessments`,
  `/assessments/[id]`, `/assessments/new`, `/passports`, `/certifications`,
  `/reports`, `/settings`).
- Never shown in `config-missing` or `signed-out` states (those return
  early with a different screen — no platform data is shown there to be
  transparent about).
- Never shown in `mock` or `real-dev` mode: `AuthGate.tsx` (used in those
  modes) does not import `MockDataTransparencyBanner` at all — there is no
  code path by which it could render outside `ProductionAuthGate`.
- Settings page also gained one additional note line, shown only when
  `authState.mode === 'signed-in'`, cross-referencing the banner — this is
  additive to the banner, not a replacement for it.

## Files changed

- `apps/platform/src/lib/auth/platform-auth.server.ts` — rewritten:
  `getServerAuthConfigStatus()` (new), `isServerClerkSecretConfigured()`
  (new, private), `resolveProductionAuthState()` and
  `getServerBackendToken()` updated to gate on the new status.
- `apps/platform/src/lib/auth/platform-auth.ts` — re-exports
  `ServerAuthConfigStatus`.
- `apps/platform/src/components/ProductionAuthGate.tsx` — richer
  config-missing description (unchanged shape, still lists `missing`);
  signed-in branch now renders the new banner.
- `apps/platform/src/components/MockDataTransparencyBanner.tsx` — new.
- `apps/platform/src/app/(platform)/settings/page.tsx` — runtime indicator
  extended with the three-part config status and explicit auth-state line.

## Files NOT changed

- `apps/platform/src/lib/api-config.ts` — untouched. It remains
  client-safe (no `CLERK_SECRET_KEY` read) by design; the fix lives
  entirely in the server-only `platform-auth.server.ts`, which is the
  correct place for a server-secret-dependent check.
- `apps/platform/src/lib/real-api-client.ts` — untouched. Its
  `production-auth` branch depends only on the Clerk **client** SDK
  (`window.Clerk.session.getToken()`), which does not use
  `CLERK_SECRET_KEY` at all (that var is used only by `@clerk/nextjs/server`
  for backend-side session verification) — there was nothing to fix there.
- `AuthGate.tsx`, `SessionProvider.tsx`, mock login form, mock/real-dev
  behavior generally — unchanged.
- No backend file, no PBRS/scoring/certification-threshold file.

## What was tested

See `PHX_PLATFORM_010_R1_AUTH_QA_REPORT.md` for full commands and output:
`type-check`, `lint`, and six `next build` runs (mock, real-dev,
production-auth × four configurations: all-present, missing publishable
key, missing backend URL, missing `CLERK_SECRET_KEY` only). The
missing-`CLERK_SECRET_KEY`-only build is the key proof point: its route
table is entirely static, confirming `auth()` was never invoked (a real
`auth()` call forces every route touching it to dynamic rendering, as seen
in the "all fake config present" build).

## Limitations

- No real Clerk account was used (unchanged from PHX-PLATFORM-010).
- No live backend round-trip was exercised (unchanged from
  PHX-PLATFORM-010).
- Page-by-page migration off mock data remains out of scope — the banner
  is the transparency mechanism for this gap, not a fix for the gap itself
  (that is PHX-PLATFORM-011's stated scope, per the banner's own copy).
- Public launch remains No-Go; nothing in this fix claims otherwise.
