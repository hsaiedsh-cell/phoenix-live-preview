# Phoenix Platform — Access Control Matrix

**Task ID:** PHX-PLATFORM-006
**Source of truth:** `apps/platform/src/lib/access-control.ts`
**Derived from:** `docs/platform/PERMISSIONS_MODEL_PHX_PLATFORM_002.md`

---

## 1. Roles

Owner, Admin, Reviewer, Contributor, Viewer, Auditor — unchanged from
PHX-PLATFORM-002. No new roles are introduced.

---

## 2. Permission Matrix

Legend: ✅ = permitted, — = not permitted.

| Permission | Owner | Admin | Reviewer | Contributor | Viewer | Auditor | PHX-PLATFORM-002 source row |
|---|:---:|:---:|:---:|:---:|:---:|:---:|---|
| `canViewDashboard` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Assets/Assessments — Read |
| `canViewAssessments` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Assessments — Read |
| `canCreateAssessment` | ✅ | ✅ | — | ✅ | — | — | Assessments — Create |
| `canEditEvidence` | ✅ | ✅ | ✅ | ✅ | — | — | Evidence — Add |
| `canRunScoring` | ✅ | ✅ | ✅ | ✅ | — | — | Scoring — Trigger automated run |
| `canOverrideDimensionScore` | ✅ | ✅ | ✅ | — | — | — | Scoring — Override dimension |
| `canApproveAssessment` | ✅ | ✅ | ✅ | — | — | — | Assessments — Record decision |
| `canIssuePassport` | ✅ | ✅ | ✅ | — | — | — | Passports — Issue |
| `canRevokePassport` | ✅ | ✅ | — | — | — | — | Passports — Revoke |
| `canGrantCertification` | ✅ | ✅ | — | — | — | — | Certifications — Grant |
| `canRevokeCertification` | ✅ | — | — | — | — | — | Certifications — Revoke (**Owner only**) |
| `canViewReports` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Reports — Read |
| `canExportReports` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Reports — Download |
| `canViewSettings` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Settings — Read workspace settings |
| `canManageWorkspace` | ✅ | ✅ | — | — | — | — | Settings — Update workspace settings / manage integrations |
| `canViewAuditTrail` | ✅ | ✅ | — | — | — | ✅ | Audit Logs — Read `audit_records` |
| `canViewActivityLog` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Audit Logs — Read `activity_logs` |

---

## 3. Alignment Notes

- **Direct 1:1 mapping.** Every permission above maps to exactly one row of
  the PHX-PLATFORM-002 matrix; no interpretation was needed for most rows.
- **Certification revocation — Owner only.** Matches the explicit note in
  PHX-PLATFORM-002: *"Revocation is intentionally restricted to Owner only
  given its external/legal weight — stricter than the Passport revoke
  permission, which allows Admin."* `canRevokeCertification` is the only
  permission in this Alpha restricted to a single role.
- **Ownership ("own") nuances not modeled.** PHX-PLATFORM-002 has several
  "own only" carve-outs, e.g.:
  - Assets — "Update (own)" for Contributor
  - Assessments — "Submit — U (own)" for Contributor
  - Evidence — "Edit/Delete (pre-submit) — U/D (own)" for Contributor
  - Reports — "Regenerate/retry — U (own)" for Contributor

  This Alpha access-control layer gates by **role only**. There is no real
  session or backend yet to determine whether a given asset/assessment/report
  is "owned" by the current mock user, so these nuances are deliberately
  **not** encoded as separate permissions in this sprint. This is a
  documented Alpha limitation, not an oversight — see the Implementation
  Report §12 and §13 for the intended follow-up.
- **`canEditEvidence` covers "Add" only**, matching the task's requested
  helper name. PHX-PLATFORM-002 also has separate "Edit (pre-submit)" and
  "Delete (pre-submit)" rows with identical role sets (Owner/Admin/Reviewer/
  Contributor), so no information is lost by collapsing them into one
  permission for this Alpha.
- **`canRunScoring` maps to "Trigger automated run"** only, not "Read score"
  (which is `R` for everyone and isn't gated — reading a score is not an
  action any role is denied).
- **No permission exists yet for user/member management** (invite, change
  role, suspend/remove) or for passport "Verify" — these aren't part of the
  Task 3 permission list and no current UI affordance calls for them. They
  are absent from this Alpha's `access-control.ts` by design; add them in a
  future sprint if/when member-management or passport-verification UI is
  built.

---

## 4. Deviations Summary

| Deviation | Reason | Where documented |
|---|---|---|
| Role-only gating, no ownership check | No real session/backend to resolve "own" against | This doc §3; Implementation Report §7, §12 |
| `canEditEvidence` collapses Add/Edit/Delete | Identical role sets in PHX-PLATFORM-002 for this Alpha's purposes | This doc §3 |
| No member-management or passport-verify permissions | Out of Task 3 scope; no UI to gate | This doc §3 |
