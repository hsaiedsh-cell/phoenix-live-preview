# Phoenix Platform — Release Notes
## PHX-PLATFORM-008 — Session Hydration Stabilization

**Release label:** PHX-PLATFORM-008
**Base:** PHX-PLATFORM-007-PASSPORT-CERTIFICATION-ACTION-LAYER
**Type:** Stability fix (no new features, no UI redesign)

---

### What Changed

This release fixes a hydration/session-timing bug in the mock
authentication layer introduced in PHX-PLATFORM-006 and documented
during PHX-PLATFORM-007 QA: on a hard page reload, the app briefly (or
in some cases persistently, until a manual refresh) rendered
permission-gated UI for the wrong role — most visibly, Owner/Admin-only
governance buttons like *Revoke Passport* and *Revoke Certification*
could flash or linger for roles that shouldn't see them.

The fix introduces an explicit, neutral **`loading`** session state
that both the server render and the client's first paint share
identically. The real, localStorage-aware mock role is only resolved
in a client-side effect *after* hydration completes, so there is no
longer a moment where the server's guess (previously always
defaulting to Owner) and the client's real answer disagree.

Updated to support this:

- `mock-session.ts` — new `MOCK_LOADING_SESSION`,
  `getInitialMockSession()`, `getMockSessionForRole()`,
  `getDefaultMockUser()`, `getStoredMockRole()` helpers; `getMockSession()`
  is now client-aware.
- `SessionProvider.tsx` — starts in the loading state; resolves the
  real session post-mount via `useEffect`.
- `usePhoenixSession.ts` — now exposes `isLoading`.
- `AuthGate.tsx` — shows a "Preparing Phoenix Platform Alpha..." panel
  while loading, instead of momentarily treating "not yet known" as
  "not authenticated."
- `RoleGate.tsx` — new optional `loadingFallback` prop; loading,
  unauthenticated, and not-permitted are now three distinct branches.
- `GovernanceActionButton.tsx` — the previous `mounted`-flag workaround
  is removed and replaced with a direct `isLoading` check, now that the
  provider itself guarantees a safe initial state.
- `AlphaRoleSwitcher.tsx` — shows a compact disabled "Resolving role..."
  placeholder while loading.
- `LoginRoleSelector.tsx` — role `<select>` and "Continue to Workspace"
  are disabled while loading.

### What Was Preserved

- Every PHX-PLATFORM-006 role gate (New Assessment action, Audit Trail
  Preview on the assessment detail page and Settings, the workspace
  management read-only note) — retested against all affected roles.
- Every PHX-PLATFORM-007 governance action (Issue Passport, Revoke
  Passport, Grant Certification, Revoke Certification), including the
  reason-required flow for the two revoke actions.
- The Alpha Role Switcher itself — still fully functional, still
  clearly labeled as a QA-only preview control, not a real
  role-management feature.
- All existing routes, the mock API layer, and the `sample-data.ts`
  import boundary (only `api-client.ts` / `api-adapters.ts` may import
  it).
- PBRS scoring logic, dimensions, certification thresholds, and the
  PBRS Standard — none of these were touched.
- No real backend, database, or authentication provider was
  introduced. This remains a mock-only Alpha session layer.

### Alpha Limitations

- This is still not a security boundary. Every permission check in
  this release is UI-gating only, exactly as in PHX-PLATFORM-006/007 —
  a determined user could still bypass any of it via devtools. That
  will remain true until a real backend/authorization layer replaces
  `mock-session.ts` and `access-control.ts`'s consumers.
- The loading window is real, if brief (a single React effect firing
  once per page load) — any new component reading the session directly
  should handle `isLoading` the same way `RoleGate` does, to avoid
  reintroducing this class of bug.

### Next Recommended Sprint

Backend/auth integration and persistence (previously slated as
PHX-PLATFORM-006-and-beyond in the platform roadmap) — replacing the
mock session/API layers with real ones, using the `loading →
authenticated / unauthenticated` state machine this sprint established
as the target shape for a real session provider.
