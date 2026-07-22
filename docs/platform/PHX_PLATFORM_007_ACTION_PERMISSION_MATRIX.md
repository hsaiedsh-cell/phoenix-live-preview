# PHX-PLATFORM-007 — Action Permission Matrix

All permissions below are defined, unmodified, in `apps/platform/src/lib/access-control.ts` (PHX-PLATFORM-006). This sprint adds no new permission and changes no existing permission's allowed-roles list — it only adds UI actions that read these permissions.

## Actions vs. Roles

| Action | Permission | Owner | Admin | Reviewer | Contributor | Viewer | Auditor |
|---|---|:---:|:---:|:---:|:---:|:---:|:---:|
| Issue Passport | `canIssuePassport` | ✅ | ✅ | ✅ | 🚫 | 🚫 | 🚫 |
| Revoke Passport | `canRevokePassport` | ✅ | ✅ | 🚫 | 🚫 | 🚫 | 🚫 |
| Grant Certification | `canGrantCertification` | ✅ | ✅ | 🚫 | 🚫 | 🚫 | 🚫 |
| Revoke Certification | `canRevokeCertification` | ✅ | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 |
| View Audit Trail | `canViewAuditTrail` | ✅ | ✅ | 🚫 | 🚫 | 🚫 | ✅ |
| View Activity Timeline | `canViewActivityLog` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

✅ = action/section visible and usable · 🚫 = `RestrictedNote` shown instead (Issue/Revoke Passport, Grant/Revoke Certification) or content hidden (Audit Trail)

## Expected UI Behavior

- **Issue Passport** — `AssessmentGovernanceActions` on the assessment detail page. Visible for Owner/Admin/Reviewer when the assessment is eligible (score clears the Foundation threshold) and not yet Certified. Contributor/Viewer/Auditor see a `RestrictedNote` reading "Your role cannot issue a PBRS Passport."
- **Revoke Passport** — `GovernanceActionButton` on each `PassportCard` in `/passports`. Visible for Owner/Admin. Requires a documented reason (Confirm is disabled until one is entered); all other roles see "Your role cannot revoke a PBRS Passport."
- **Grant Certification** — appears in two places: `CertificationGovernancePanel`'s "Eligible for Certification" section on `/certifications`, and `AssessmentGovernanceActions` on the assessment detail page. Visible for Owner/Admin only; requires a resolved `passportId`. All other roles see "Your role cannot grant a certification."
- **Revoke Certification** — `CertificationGovernancePanel`'s "Certification Governance" section on `/certifications`. Visible for **Owner only** (not Admin, matching PHX-PLATFORM-002's "irreversible/legal-weight action" note). Requires a documented reason. All other roles see "Certification revocation is restricted to the workspace Owner."
- **Audit Trail** — unchanged from PHX-PLATFORM-006: `RoleGate` around `AuditTrailPreview` on the assessment detail page. Owner/Admin/Auditor see the real preview; Reviewer/Contributor/Viewer see a `RestrictedNote`.
- **Activity Timeline** — unchanged, visible to all roles (no gating in this Alpha).

## Notes on Mock-Only Limitations

- None of the four action permissions above are enforced by the mock API layer itself (`issuePassport`, `revokePassport`, `grantCertification`, `revokeCertification` in `api-client.ts`) — only by the UI (`GovernanceActionButton` reading `usePhoenixSession().capabilities`). This mirrors the existing PHX-PLATFORM-006 note that the mock layer is not a security boundary.
- `revokePassport` and `revokeCertification` both validate their `reason` argument at the mock-function level (not just in the dialog), so even a UI-bypassing caller gets a clear `ok: false` result rather than silent success.
- Role verification in this sprint's QA was performed via the in-app **Alpha Role Switcher** (a client-side state change). Setting the mock role directly in `localStorage` and then hard-reloading the page can trigger a pre-existing PHX-PLATFORM-006 SSR/hydration mismatch (the server always defaults to Owner) — see the Implementation Report §7 and the QA Report's Known Limitations for detail. This does not affect normal in-app usage.
