# Release Notes — PHX-PLATFORM-006

**Release label:** Authentication & Workspace Access Foundation
**Scope:** `apps/platform` only

---

## What Changed

- Added a mock authentication/session model (`auth-types.ts`, `mock-session.ts`)
  covering all six `WorkspaceRole` values from
  `PERMISSIONS_MODEL_PHX_PLATFORM_002.md`: Owner, Admin, Reviewer,
  Contributor, Viewer, Auditor.
- Added a pure, reusable access-control rule set (`access-control.ts`) mapping
  each role to 17 named permissions (e.g. `canCreateAssessment`,
  `canViewAuditTrail`), directly derived from the approved permissions model.
- Added a client-side `SessionProvider` + `usePhoenixSession()` hook, now
  wrapping the whole platform app.
- Added `AuthGate` — UI-only route gating around the platform shell. Alpha
  defaults to an authenticated mock session, so this does not change any
  current user-facing flow.
- Added an **Alpha Role Preview** switcher in the platform header and on the
  login screen, so QA can preview the UI as any of the six roles without a
  real login flow.
- Applied light role-aware gating to a handful of existing UI elements:
  - "New Assessment" action (Owner/Admin/Contributor only)
  - New Assessment wizard route (same)
  - Audit Trail Preview (Owner/Admin/Auditor only, on both the assessment
    detail page and Settings) — Activity Timeline remains visible to all
    roles, per the approved model's `activity_logs` vs `audit_records`
    distinction.
  - A read-only clarifying note on Settings for roles that cannot manage
    workspace settings.
- Updated `/login` to clearly state this is mock-alpha authentication, with
  form fields marked "UI preview only" and the SSO button disabled and
  labeled "not connected."
- Added a documentation-only note to `api-client.ts` clarifying that the mock
  API layer is not session/role-aware and is not a security boundary — no
  function signatures were changed.

## What Was Preserved

- All PBRS scoring logic, dimensions, and weights (`@phoenix/core`,
  `@phoenix/pbrs`) — untouched, verified byte-identical to source.
- All certification level/tier thresholds (`certification-levels.ts`) —
  untouched, verified byte-identical to source.
- The PBRS Standard — untouched.
- The `sample-data.ts` import boundary (`api-client.ts`/`api-adapters.ts`
  only) — no new violations introduced.
- Every existing platform route continues to render and build.
- `apps/website` and `apps/dashboard` — untouched.
- Mock mode — no real backend, database, or third-party auth dependency was
  introduced anywhere in this sprint.

## Alpha Limitations

- This is a UI-gating foundation, not real security. Any permission check
  here can be bypassed by directly calling a mock API function; there is no
  server to enforce anything.
- Role gating is by role only; ownership ("own asset/assessment") nuances
  from the permissions model are not modeled yet (documented in the Access
  Control Matrix).
- Passport issue/revoke and certification grant/revoke actions have no UI
  in this Alpha yet, so nothing was gated there — the permission helpers
  (`canIssuePassport`, `canRevokePassport`, `canGrantCertification`,
  `canRevokeCertification`) already exist and are ready to wrap those
  controls once built.
- Role selection persists per-browser via `localStorage` for QA
  convenience only — it is not a real session and is reset by clearing
  site data.

## Next Recommended Sprint

A natural PHX-PLATFORM-007 would introduce the passport issue/revoke and
certification grant/revoke UI controls themselves (currently absent), then
wrap them in the `RoleGate` permissions already defined here. A separate,
larger effort — outside this sprint's scope — would connect a real identity
provider and move `access-control.ts` enforcement server-side.
