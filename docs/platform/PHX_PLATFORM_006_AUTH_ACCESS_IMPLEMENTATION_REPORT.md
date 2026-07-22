# Phoenix Platform — Auth & Access Foundation Implementation Report

**Task ID:** PHX-PLATFORM-006
**Title:** Authentication & Workspace Access Foundation
**Status:** Complete (mock-first Alpha foundation)

---

## 1. Summary

This sprint adds the foundational access-control layer to Phoenix Platform
Alpha: a typed session/role model, a mock session (no real credentials, no
backend), a pure access-control rule set derived directly from
`PERMISSIONS_MODEL_PHX_PLATFORM_002.md`, a React session provider/hook, an
Alpha-only role switcher for QA, and light role-aware gating of existing UI
affordances. No new backend, database, or third-party auth dependency was
introduced. No PBRS scoring logic, PBRS dimensions, or certification
thresholds were touched.

---

## 2. Files Added

| File | Purpose |
|---|---|
| `apps/platform/src/lib/auth-types.ts` | `PhoenixUserRole`, `PhoenixSessionStatus`, `PhoenixUser`, `PhoenixWorkspaceContext`, `PhoenixSession` types. Backend-ready, no mock data. |
| `apps/platform/src/lib/mock-session.ts` | Six mock users (one per role), `getMockSession()`, `getMockUserByRole()`, `getAvailableMockUsers()`, `switchMockUser()`. localStorage-backed, browser-guarded. |
| `apps/platform/src/lib/access-control.ts` | Pure `PhoenixUserRole -> boolean` permission rules; `hasPermission()`, `getRoleCapabilities()`, `getRestrictedMessage()`, and the 17 named permission helpers from the task spec. |
| `apps/platform/src/components/SessionProvider.tsx` | Client React context wrapping the mock session; exposes `switchRole()`. |
| `apps/platform/src/hooks/usePhoenixSession.ts` | `usePhoenixSession()` hook — `session`, `user`, `activeWorkspace`, `role`, `isAuthenticated`, `switchRole`, `capabilities`. |
| `apps/platform/src/components/AuthGate.tsx` | UI-only auth gate. Shows children when the mock session is authenticated (Alpha default), otherwise an "Authentication required" panel linking to `/login`. |
| `apps/platform/src/components/RoleGate.tsx` | Reusable `<RoleGate permission="..." fallback={...}>` wrapper for gating existing actions/sections by permission. |
| `apps/platform/src/components/RestrictedNote.tsx` | Muted "not available for your role" note, used as a `RoleGate` fallback. |
| `apps/platform/src/components/AlphaRoleSwitcher.tsx` | Alpha-only QA role switcher, shown in `PlatformTopbar`. Clearly labeled "Alpha Role Preview". |
| `apps/platform/src/components/LoginRoleSelector.tsx` | Optional mock role selector on `/login`. |
| `apps/platform/src/components/NewAssessmentAction.tsx` | Role-aware wrapper around the pre-existing "New Assessment" button (was inlined in `assessments/page.tsx`). |
| `apps/platform/src/components/WorkspaceManagementNote.tsx` | Read-only clarifier shown to non-Owner/Admin roles on `/settings`. |

## 3. Files Modified

| File | Change |
|---|---|
| `apps/platform/src/app/layout.tsx` | Wrapped the whole app in `<SessionProvider>`. |
| `apps/platform/src/app/(platform)/layout.tsx` | Wrapped `PlatformShell` in `<AuthGate>`. |
| `apps/platform/src/app/login/page.tsx` | Clear "Platform Alpha · Mock Authentication" messaging, disabled/labeled SSO button, added `LoginRoleSelector`, form fields marked "UI preview only". |
| `apps/platform/src/app/(platform)/assessments/page.tsx` | "New Assessment" action replaced with `<NewAssessmentAction />` (role-aware). |
| `apps/platform/src/app/(platform)/assessments/new/page.tsx` | Wizard body wrapped in `<RoleGate permission="canCreateAssessment">`. |
| `apps/platform/src/app/(platform)/assessments/[assessmentId]/page.tsx` | "Audit Trail Preview" column wrapped in `<RoleGate permission="canViewAuditTrail">`; Activity Timeline left visible to all roles. |
| `apps/platform/src/app/(platform)/settings/page.tsx` | "Audit Preview" panel gated the same way; `WorkspaceManagementNote` added to the Workspace panel. |
| `apps/platform/src/components/PlatformTopbar.tsx` | Static user block replaced with `<AlphaRoleSwitcher />`. `userName` prop retained for compatibility but no longer rendered directly. |
| `apps/platform/src/lib/api-client.ts` | Header comment only — documents that this Alpha layer is not session/role-aware and is not a security boundary. No function signatures changed. |

No other files were modified. `apps/website` and `apps/dashboard` are untouched (confirmed via full-tree diff against the PHX-CERT-003 source).

---

## 4. Mock Auth Model

Six roles, matching `WorkspaceRole` in `PERMISSIONS_MODEL_PHX_PLATFORM_002.md`
exactly: `Owner`, `Admin`, `Reviewer`, `Contributor`, `Viewer`, `Auditor`. Each
has a mock user (illustrative name/email, no real credentials) in
`mock-session.ts`. The Alpha session is authenticated by default as **Owner**
(Hossam M.), matching the previous static `MOCK_USER` in `api-client.ts`, so
existing dashboard behavior is unchanged unless a role switch happens.

Role selection persists per-browser in `localStorage`
(`phx.mockSession.activeRole`), guarded behind `typeof window !== 'undefined'`
checks so the module is safe to import anywhere, including from server
code, without breaking SSR or static export.

No passwords are stored. No login form field is validated. The `/login`
password/email inputs are explicitly labeled "UI preview only" and the
Enterprise SSO button is disabled and labeled "not connected".

---

## 5. Session Provider / Hook

`SessionProvider` (client component, mounted once in the root layout) holds
the mock session in React state and exposes `switchRole()`. `usePhoenixSession()`
is the single import platform components need:

```ts
const { role, capabilities, isAuthenticated, switchRole, user, activeWorkspace } = usePhoenixSession();
```

`capabilities` is the full `Record<PhoenixPermission, boolean>` for the
current role (from `getRoleCapabilities()`), so most call sites don't need to
import `access-control.ts` directly.

---

## 6. Role Switcher

`AlphaRoleSwitcher` sits in `PlatformTopbar`, labeled "Alpha Role Preview" in
both the collapsed and expanded states, with a QA-only explanation in the
dropdown header. It is visually a small compact control (avatar initials +
name/role), not a prominent admin feature. A second, optional instance
(`LoginRoleSelector`) lives on `/login` for convenience before entering the
workspace.

---

## 7. Access Control Rules

See `access-control.ts` and `PHX_PLATFORM_006_ACCESS_CONTROL_MATRIX.md` for
the full mapping. Rules are derived directly from the PHX-PLATFORM-002
permission matrix; the one documented deviation is that this Alpha layer
gates by **role only**, not by resource ownership (e.g. the matrix's "own
only" nuances for Contributor editing their own evidence/assessments are not
modeled, since there is no real session/backend to determine ownership
against yet).

---

## 8. Route Gating

`(platform)/layout.tsx` wraps `PlatformShell` in `<AuthGate>`. Since Alpha
defaults to an authenticated mock session, in practice every platform route
renders normally out of the box; `AuthGate` exists so the shape is correct
for a future real session and so `unauthenticated` state (reachable only by
directly manipulating the mock session, not through any current UI path) has
a sane fallback rather than a broken page.

`AuthGate` is a client component; the surrounding `(platform)/layout.tsx`
stays an async server component (unchanged data-fetching for
workspace/user), keeping the platform shell server-safe per the task's
guidance to avoid browser-only APIs in server components.

---

## 9. Role-Aware UI States Implemented

| Location | Gated element | Permission | Visible to |
|---|---|---|---|
| `/assessments` | "New Assessment" button | `canCreateAssessment` | Owner, Admin, Contributor |
| `/assessments/new` | Assessment wizard | `canCreateAssessment` | Owner, Admin, Contributor |
| `/assessments/[id]` | Audit Trail Preview | `canViewAuditTrail` | Owner, Admin, Auditor |
| `/assessments/[id]` | Activity Timeline | `canViewActivityLog` | All roles (unchanged) |
| `/settings` | Audit Preview panel | `canViewAuditTrail` | Owner, Admin, Auditor |
| `/settings` | Workspace management note | `canManageWorkspace` | Note shown to non-Owner/Admin only |

**Not gated — no existing action to gate (see acceptance note under "Do not
overbuild"):**
- `/passports` — `PassportCard` has no Issue/Revoke button in the current
  Alpha UI (only a non-functional "View Passport →" label and a
  "Verification portal coming soon" note). Nothing to hide.
- `/certifications` — `CertificationCard` and the certifications page have
  no Grant/Revoke button in the current Alpha UI. Nothing to hide.
- `/reports` — no Request/Regenerate button exists yet.

If/when those actions are built (a likely PHX-PLATFORM-007+ scope), they
should be wrapped in `<RoleGate permission="canIssuePassport">`,
`<RoleGate permission="canRevokePassport">`, `<RoleGate permission="canGrantCertification">`,
and `<RoleGate permission="canRevokeCertification">` respectively — the
permission helpers already exist and are ready to use.

---

## 10. Audit / Activity Visibility

Per `PERMISSIONS_MODEL_PHX_PLATFORM_002.md` §"Audit Logs":
- `activity_logs` (feed) — Read is granted to all roles. `ActivityTimeline`
  is left unchanged and visible everywhere it currently appears.
- `audit_records` (compliance trail) — Read is Owner/Admin/Auditor only.
  Both places `AuditTrailPreview` appears (`/assessments/[id]` and
  `/settings`) are now wrapped in `<RoleGate permission="canViewAuditTrail">`,
  with `<RestrictedNote>` as the fallback for other roles. No data was
  removed — this is UI visibility only.

---

## 11. Mock API Client

`api-client.ts` was not given new parameters or headers. A comment block was
added documenting that this Alpha layer does not enforce sessions/roles and
is not a security boundary — enforcement of `PERMISSIONS_MODEL_PHX_PLATFORM_002.md`
belongs in a real backend, which should accept session/role as request
context. No breaking changes to any existing function signature.

---

## 12. Limitations (Alpha)

- This is UI gating only. Anyone with access to browser dev tools can still
  call any mock API function directly; there is no server-side enforcement
  because there is no server.
- Role gating is by role only, not resource ownership ("own" nuances in the
  permission matrix are not modeled).
- The role switcher changes only the local mock session in this browser —
  it does not simulate multi-user collaboration or a real invite/assignment
  flow.
- `getMockSession()` reads `localStorage` only on the client; a fresh
  server-rendered page always computes from the same defaulted state before
  hydration reconciles with any stored role. This can cause a very brief
  flash on hard reload before the switched role is reflected — acceptable
  for an Alpha QA tool.
- No password, token, or session cookie exists anywhere in this build.

---

## 13. Future Backend Integration Path

1. Replace `getMockSession()`/`switchMockUser()` in `mock-session.ts` with
   real calls to an identity provider / session endpoint. `usePhoenixSession()`
   and every `RoleGate`/`AuthGate` call site should require no changes, since
   they depend only on `auth-types.ts` shapes.
2. Move `access-control.ts` rule evaluation server-side (e.g. into API route
   handlers or a real backend) so it becomes an actual security boundary,
   not just UI gating. The same `PhoenixPermission` matrix can be reused.
3. Introduce real route protection (middleware or server-side session
   check) in `(platform)/layout.tsx` in place of `AuthGate`'s always-on mock
   default.
4. Extend `api-client.ts` functions to accept/require session context per
   the note left in its header comment, and have a real backend reject
   unauthorized calls per `PERMISSIONS_MODEL_PHX_PLATFORM_002.md`.
