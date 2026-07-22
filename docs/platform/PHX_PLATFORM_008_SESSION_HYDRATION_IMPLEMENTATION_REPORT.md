# PHX-PLATFORM-008 — Session Hydration Stabilization
## Implementation Report

**Sprint:** PHX-PLATFORM-008 — Session Hydration Stabilization
**Base:** PHX-PLATFORM-007-PASSPORT-CERTIFICATION-ACTION-LAYER.tar
**Scope:** Mock session hydration lifecycle only. No backend, no real
auth, no PBRS/scoring/threshold/Standard changes, no UI redesign.

---

## 1. Root Cause

`getMockSession()` (in `mock-session.ts`) always returned
`status: 'authenticated'`, resolving the active role from
`localStorage` when available and falling back to the default Owner
user otherwise. `SessionProvider` called this function directly inside
a lazy `useState` initializer:

```ts
const [session, setSession] = useState<PhoenixSession>(() => getMockSession());
```

Because `SessionProvider` is a client component rendered as part of
Next.js App Router's server-rendered HTML:

- **Server render:** `window` is undefined, so `getMockSession()`'s
  `localStorage` read silently fails and the function returns an
  **Owner** session (the hardcoded default role).
- **Client hydration (first pass):** the same lazy initializer runs
  again on the client, where `window` *is* defined. If a QA role
  switch had previously been persisted to `localStorage` (e.g.
  `Viewer`), the client resolves a **different** session than the one
  baked into the server HTML.

React detects this divergence during hydration. Depending on timing,
this produced any combination of:

- a hydration mismatch/console warning,
- a brief flash of Owner-permissioned UI (buttons like *Revoke
  Passport* or *Revoke Certification*) before React reconciled to the
  real role,
- inconsistent role-gated section visibility immediately after a hard
  reload.

`GovernanceActionButton.tsx` had already worked around the symptom
locally with a `mounted` flag (render nothing until a client-only
`useEffect` fires), but this didn't address the underlying provider
behavior, and `AuthGate`, `RoleGate`, and `AlphaRoleSwitcher` had no
equivalent protection.

---

## 2. Session Lifecycle — Before vs. After

### Before

```
Server render          → getMockSession() → status: 'authenticated', role: Owner (localStorage unavailable)
Client hydration pass 1 → getMockSession() → status: 'authenticated', role: <stored role, e.g. Viewer>
                          ^ mismatch between server HTML and first client render
```

`isAuthenticated` was `true` immediately on both server and client, so
`AuthGate` always rendered children right away, and `RoleGate` /
`GovernanceActionButton` had no way to distinguish "role not known
yet" from "role known, and it's Owner."

### After

```
Server render            → status: 'loading', user: null, activeWorkspace: null   (getInitialMockSession())
Client hydration pass 1  → status: 'loading', user: null, activeWorkspace: null   (identical — no mismatch)
Client effect (post-mount) → getMockSession() → status: 'authenticated', role: <real stored role, or Owner default>
                            ^ single, client-only transition, after hydration has already completed safely
```

The neutral `loading` session is now a first-class, explicit state
(`MOCK_LOADING_SESSION` / `getInitialMockSession()`) rather than an
accidental Owner default. Every gate in the tree (`AuthGate`,
`RoleGate`, `GovernanceActionButton`, `AlphaRoleSwitcher`) treats
`loading` as its own state, distinct from both "authenticated" and
"unauthenticated."

---

## 3. Files Changed

### `apps/platform/src/lib/auth-types.ts`
No changes. `PhoenixSessionStatus` already included `'loading'`, and
`PhoenixSession` already allowed `user: null` / `activeWorkspace:
null`. Verified only.

### `apps/platform/src/lib/mock-session.ts`
- Added `MOCK_LOADING_SESSION` — the canonical neutral session
  (`status: 'loading'`, `user: null`, `activeWorkspace: null`).
- Added `getDefaultMockUser()` — returns the Owner mock user (used only
  as a fallback once a session resolves, never during initial render).
- Added `getStoredMockRole()` — thin public wrapper over the existing
  (already-safe) `readStoredRole()` helper.
- Added `getMockSessionForRole(role)` — pure builder for an
  authenticated session for a specific role, with no `localStorage`
  access. Used by `switchRole()` for the immediate, synchronous UI
  update after a QA role switch, and by the loading-resolution effect.
- Added `getInitialMockSession()` — always returns
  `MOCK_LOADING_SESSION`. This is what `SessionProvider`'s initial
  `useState` now calls, on both server and client.
- Changed `getMockSession()` to be client-aware: returns
  `MOCK_LOADING_SESSION` when `typeof window === 'undefined'`,
  otherwise resolves the stored role (or Owner default) exactly as
  before. This function is now only ever invoked from a client-only
  effect (post-mount), never from an initializer that could run during
  SSR/first-hydration.
- `switchMockUser()` unchanged — still a browser-guarded localStorage
  write with no password/token/cookie involved.

### `apps/platform/src/components/SessionProvider.tsx`
- Initial `useState` no longer calls `getMockSession()` in a lazy
  initializer. It now always starts from `getInitialMockSession()`
  (the neutral loading session), identical on server and client.
- Added a `useEffect(() => { setSession(getMockSession()); }, [])` that
  runs once, client-only, after mount, and resolves the real
  localStorage-aware session.
- `switchRole()` now uses the new pure `getMockSessionForRole(role)`
  instead of re-reading `getMockSession()` (equivalent behavior, no
  behavior change, slightly more direct).
- Context value gained `isLoading: boolean` (`session.status ===
  'loading'`). `capabilities` and `role` remain `null` while loading,
  by construction (`session.user` is `null`).

### `apps/platform/src/hooks/usePhoenixSession.ts`
- Hook now also destructures and returns `isLoading` from the context.
  No other shape changes — fully backward compatible for existing
  callers that don't use it.

### `apps/platform/src/components/AuthGate.tsx`
- Added an explicit `isLoading` branch, rendered before the
  `isAuthenticated` check: a lightweight "Preparing Phoenix Platform
  Alpha... / Resolving mock workspace session." panel, visually
  consistent with the existing "Authentication required" panel but
  clearly distinct in wording (no lock-icon-as-error framing; muted,
  pulsing icon instead).
- The pre-existing "Authentication required" panel and its copy are
  unchanged.

### `apps/platform/src/components/RoleGate.tsx`
- Added a `loadingFallback` prop (default `null`), rendered when
  `isLoading` is true.
- Restructured the fallthrough logic so `loading` is checked first,
  then `!isAuthenticated`, then the permission check — each has its
  own explicit branch rather than collapsing "not authenticated" and
  "not loaded yet" into the same `!capabilities` check as before.
- Existing call sites (`fallback` only, no `loadingFallback`) continue
  to work unchanged — they'll render nothing during the (now very
  brief, single-effect) loading window instead of potentially flashing
  restricted or permitted content.

### `apps/platform/src/components/GovernanceActionButton.tsx`
- Removed the `mounted` state + `useEffect(() => setMounted(true),
  [])` workaround entirely, along with its explanatory comment (which
  described exactly the bug this sprint fixes).
- Replaced with a direct `isLoading` check from `usePhoenixSession()`:
  `if (isLoading) return null;` before the `capabilities` check.
- No change to the reason-required flow, `ActionConfirmDialog` wiring,
  or the restricted-note fallback — those were already correct once
  gated on a resolved session.

### `apps/platform/src/components/AlphaRoleSwitcher.tsx`
- Added an `isLoading` branch that renders a compact, visually muted,
  non-interactive placeholder ("Resolving role... / Alpha Role
  Preview") in the same footprint as the real control, so the topbar
  doesn't jump when the real switcher appears a moment later.
- Role-switching behavior (`switchRole`, click-outside handling,
  dropdown) is otherwise unchanged.

### `apps/platform/src/components/LoginRoleSelector.tsx`
- `<select>` and the "Continue to Workspace" button are now `disabled`
  while `isLoading`, with a "Resolving role..." placeholder `<option>`
  shown only in that state. The login page's existing "Mock
  Authentication / Platform Alpha / UI preview only / SSO not
  connected" framing (on the parent login page, not shown in this
  diff) is untouched.

---

## 4. Governance Action Impact

`GovernanceActionButton` is the single shared primitive behind every
PHX-PLATFORM-007 governance action (`Issue Passport`, `Revoke
Passport`, `Grant Certification`, `Revoke Certification`), used by
`PassportCard.tsx`, `CertificationGovernancePanel.tsx`, and
`AssessmentGovernanceActions.tsx`. Because the fix lives entirely
inside `GovernanceActionButton` + the session it reads from, **no
changes were required in any of those three consuming components** —
their `permission=`, `onRun=`, `reasonRequired`, etc. props are
untouched, and the reason-required flow (`revokePassport`,
`revokeCertification`) behaves exactly as it did in PHX-PLATFORM-007.

---

## 5. Limitations

- This is a mock-session lifecycle fix only. There is still no real
  backend, database, or authentication provider — `getMockSession()`
  ultimately still just reads a role string out of `localStorage`.
- The `loading` window is a single React commit (one effect firing
  once, on mount) — in practice this is imperceptible on a normal
  connection, but it is a real (if extremely brief) state, and any new
  component that reads `usePhoenixSession()` directly must handle
  `isLoading` the same way `RoleGate` / `GovernanceActionButton` do, or
  it risks reintroducing a version of this bug.
- `AlphaRoleSwitcher`'s loading placeholder and the real control are
  visually similar but not pixel-identical (the placeholder has no
  interactive affordance); this is intentional so the disabled state
  reads clearly as "not ready yet."

## 6. Future Real Auth Integration Path

When a real backend/auth provider is introduced:

- `mock-session.ts` is the only module that should need to be replaced
  wholesale (e.g. with a real `fetch`/subscription-based session
  loader) — `SessionProvider`'s `loading` → `authenticated` /
  `unauthenticated` state machine, and every consumer built against
  `usePhoenixSession()`, should not need to change shape.
- The real loader should still resolve `status: 'loading'` as its
  initial state (matching server output) and only transition to
  `'authenticated'` or `'unauthenticated'` once a real session check
  has completed — the same pattern this sprint establishes for the
  mock.
- `AuthGate`'s "Authentication required" copy will need updating to
  remove "mock-alpha session gate" language once real auth exists;
  `AlphaRoleSwitcher` and `LoginRoleSelector` should be removed
  entirely rather than adapted, since they are explicitly QA-only.
