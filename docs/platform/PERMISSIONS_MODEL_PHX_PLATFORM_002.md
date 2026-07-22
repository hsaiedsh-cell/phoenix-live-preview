# Phoenix Platform — Permissions Model

**Task ID:** PHX-PLATFORM-002
**Status:** Draft contract only. **No authentication is implemented.** This
document defines the intended `WorkspaceRole` permission matrix that a future
auth/authorization layer will enforce.

---

## Roles

| Role | Summary |
|---|---|
| **Owner** | Full control of the workspace, including irreversible actions (certification revocation, workspace settings). Exactly one per workspace in this Alpha contract (multi-owner is a future consideration). |
| **Admin** | Day-to-day administration — user management, passport/certification issuance, integrations — short of the most irreversible actions. |
| **Reviewer** | Scores, reviews, and decides assessments. Can override dimension scores with justification. |
| **Contributor** | Creates and submits assets and assessments; attaches evidence. Cannot review or decide. |
| **Viewer** | Read-only access to assets, assessments, passports, certifications, reports. |
| **Auditor** | Read-only access plus the audit trail (`audit_records`), for compliance personnel who may not need day-to-day workspace access otherwise. |

---

## Permission Matrix

Legend: **C** = Create, **R** = Read, **U** = Update, **D** = Delete/Revoke, **—** = No access.

### Assets

| Action | Owner | Admin | Reviewer | Contributor | Viewer | Auditor |
|---|---|---|---|---|---|---|
| Read | R | R | R | R | R | R |
| Create | C | C | — | C | — | — |
| Update (own) | U | U | — | U | — | — |
| Update (any) | U | U | U (status only) | — | — | — |
| Archive | D | D | — | — | — | — |

### Assessments

| Action | Owner | Admin | Reviewer | Contributor | Viewer | Auditor |
|---|---|---|---|---|---|---|
| Read | R | R | R | R | R | R |
| Create | C | C | — | C | — | — |
| Submit | U | U | — | U (own) | — | — |
| Assign reviewer | U | U | U | — | — | — |
| Progress steps | U | U | U | — | — | — |
| Record decision | U | U | U | — | — | — |
| Close | U | U | U | — | — | — |

### Evidence

| Action | Owner | Admin | Reviewer | Contributor | Viewer | Auditor |
|---|---|---|---|---|---|---|
| Read | R | R | R | R | R | R |
| Add | C | C | C | C | — | — |
| Edit (pre-submit) | U | U | U | U (own) | — | — |
| Delete (pre-submit) | D | D | D | D (own) | — | — |

### Scoring

| Action | Owner | Admin | Reviewer | Contributor | Viewer | Auditor |
|---|---|---|---|---|---|---|
| Read score | R | R | R | R | R | R |
| Trigger automated run | C | C | C | C | — | — |
| Override dimension | U | U | U | — | — | — |

### Passports

| Action | Owner | Admin | Reviewer | Contributor | Viewer | Auditor |
|---|---|---|---|---|---|---|
| Read | R | R | R | R | R | R |
| Issue | C | C | C | — | — | — |
| Verify | U | U | U | U | R (trigger allowed) | R (trigger allowed) |
| Revoke | D | D | — | — | — | — |

### Certifications

| Action | Owner | Admin | Reviewer | Contributor | Viewer | Auditor |
|---|---|---|---|---|---|---|
| Read | R | R | R | R | R | R |
| Grant | C | C | — | — | — | — |
| Update expiry / renew | U | U | — | — | — | — |
| Revoke | D | — | — | — | — | — |

*Note: Revocation is intentionally restricted to **Owner only** given its external/legal weight — stricter than the Passport revoke permission, which allows Admin.*

### Reports

| Action | Owner | Admin | Reviewer | Contributor | Viewer | Auditor |
|---|---|---|---|---|---|---|
| Read | R | R | R | R | R | R |
| Request | C | C | C | C | — | — |
| Regenerate/retry | U | U | U | U (own) | — | — |
| Download | R | R | R | R | R | R |

### Settings

| Action | Owner | Admin | Reviewer | Contributor | Viewer | Auditor |
|---|---|---|---|---|---|---|
| Read workspace settings | R | R | R | R | R | R |
| Update workspace settings | U | U | — | — | — | — |
| Manage integrations | U | U | — | — | — | — |

### Audit Logs

| Action | Owner | Admin | Reviewer | Contributor | Viewer | Auditor |
|---|---|---|---|---|---|---|
| Read `activity_logs` (feed) | R | R | R | R | R | R |
| Read `audit_records` (compliance trail) | R | R | — | — | — | R |

### Users

| Action | Owner | Admin | Reviewer | Contributor | Viewer | Auditor |
|---|---|---|---|---|---|---|
| Read member list | R | R | R | R | R | R |
| Invite member | C | C | — | — | — | — |
| Change role (non-Owner) | U | U | — | — | — | — |
| Change Owner / transfer ownership | U | — | — | — | — | — |
| Suspend/remove member | D | D | — | — | — | — |

---

## Notes on Enforcement Boundary

- This matrix describes **intended authorization logic** the API layer will
  enforce once real authentication exists. No session, token, or identity
  provider is implemented as part of this task.
- `UserRole` (platform-wide: `SuperAdmin`, `StandardUser`, `ServiceAccount`)
  is orthogonal to `WorkspaceRole` and is reserved for platform-operations
  concerns (e.g. impersonation for support) — it is out of scope for this
  matrix and will get its own contract when platform-admin tooling is
  scoped.
- Every `U`/`D` action in this matrix corresponds to an `AuditRecord` write
  per `DATA_LIFECYCLE_PHX_PLATFORM_002.md`.
