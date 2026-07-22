# Phoenix Platform — Data Lifecycle

**Task ID:** PHX-PLATFORM-002
**Status:** Draft — describes intended state machines for the future backend. No implementation exists yet.

Every transition below is expected to write exactly one `AuditRecord` (see `audit.ts` / `audit_records` table) capturing the before/after `status` value, and — where noted — one `ActivityLog` entry for the workspace feed.

---

## 1. Asset Lifecycle

| State | Meaning | Allowed next states | Who can trigger | System event | Audit requirement |
|---|---|---|---|---|---|
| **Draft** | Asset created, not yet submitted for assessment. | Submitted, Archived | Owner, Contributor | `AssetCreated` | Yes — on creation |
| **Submitted** | Owner has requested an assessment; awaiting an assessment to start. | In Review, Archived | Owner, Contributor (via `POST /assessments`) | `AssessmentCreated` | Yes |
| **In Review** | An active assessment is in progress against this asset. | Assessed, Archived | System (assessment reaches `Decision Pending`/decided) | — | Yes |
| **Assessed** | Most recent assessment reached a decision (`Approved`, `Needs Improvement`, or `Rejected`). | Business Ready (if Approved), Draft (if Needs Improvement/Rejected — owner revises), Archived | System, on assessment decision | `AssetStatusChanged` | Yes |
| **Business Ready** | Approved and scored; eligible for passport issuance. | Certified (on certification grant), Expired, Archived | System, on passport/certification issuance | `AssetStatusChanged` | Yes |
| **Certified** | An active `PBRSCertificationRecord` exists for this asset's passport. | Expired (certification expiry), Archived | System (expiry sweep), Admin/Owner (revoke) | `CertificationGranted` / `CertificationRevoked` | Yes |
| **Expired** | Certification or passport validity window has lapsed. | Archived, Draft (re-submission for re-assessment) | System (expiry sweep) | — | Yes |
| **Archived** | Terminal state — asset retained for record but no longer active. | *(none — terminal)* | Admin, Owner | `AssetStatusChanged` | Yes |

**Notes:**
- `Needs Improvement` and `Rejected` assessment decisions return the asset to `Draft` so the owner can create a new `AssetVersion` and re-submit; the prior `Assessment` record is retained (not deleted) for history.
- `Archived` is reachable from any non-terminal state, restricted to `Admin`/`Owner`, and always soft-deletes via `deleted_at` rather than a hard delete.

---

## 2. Assessment Lifecycle

| State | Meaning | Allowed next states | Who can trigger | System event | Audit requirement |
|---|---|---|---|---|---|
| **Draft** | Assessment created; evidence collection has not started. | Evidence Pending, Closed | Requester | `AssessmentCreated` | Yes |
| **Evidence Pending** | At least one `EvidenceItem` required before scoring; contributor is gathering it. | Scoring Pending, Closed | Contributor | `EvidenceAdded` | Yes (per evidence item) |
| **Scoring Pending** | Evidence sufficient; awaiting a scoring run. | Under Review, Closed | Contributor (`POST /score/run`) | `ScoreCalculated` | Yes |
| **Under Review** | `PBRSScoreRecord` exists; reviewer is progressing through `AssessmentStep`s. | Decision Pending, Closed | Reviewer | `AssessmentReviewed` | Yes |
| **Decision Pending** | All steps complete; reviewer must record a final decision. | Approved, Needs Improvement, Rejected | Reviewer | — | — |
| **Approved** | Reviewer approved the assessment. | Closed | System, on passport issuance or manual close | `AssessmentDecided` | Yes |
| **Needs Improvement** | Reviewer requests changes; asset returns to Draft. | Closed | System | `AssessmentDecided` | Yes |
| **Rejected** | Reviewer rejects the asset outright. | Closed | System | `AssessmentDecided` | Yes |
| **Closed** | Terminal — assessment fully resolved and archived from active worklists. | *(none — terminal)* | System (auto-close on passport issuance) or Admin | — | Yes |

**Notes:**
- Only one assessment per asset may be in a non-`Closed` state at a time; a new assessment cannot be created via `POST /assessments` while another is active for the same `assetId` (`409`).
- The `PATCH /assessments/:id/decision` endpoint is the sole writer of the `Approved` / `Needs Improvement` / `Rejected` transition and requires `decisionNotes`.

---

## 3. Passport Lifecycle

| State | Meaning | Allowed next states | Who can trigger | System event | Audit requirement |
|---|---|---|---|---|---|
| **Not Issued** | Conceptual pre-state — no `PBRSPassport` row exists yet. | Issued | System, Reviewer/Admin/Owner (`POST /assessments/:id/passport`) | `PassportIssued` | Yes (on row creation) |
| **Issued** | Passport created; `issuedAt` set but not yet within its `validFrom`/`validUntil` window (typically instantaneous in practice). | Active | System | — | — |
| **Active** | Passport is within its valid window and can back a certification. | Expired, Revoked, Archived | System (expiry sweep), Admin/Owner (revoke) | — | — |
| **Expired** | `validUntil` has passed without renewal. | Archived | System (expiry sweep) | — | Yes |
| **Revoked** | Manually invalidated ahead of expiry (e.g. underlying asset found non-compliant). | Archived | Admin, Owner | `PassportIssued` reversal — logged as `AuditRecord` action `passport.revoked` | Yes — `revokedReason` required |
| **Archived** | Terminal — retained for audit, no longer active. | *(none — terminal)* | System, Admin | — | Yes |

**Notes:**
- `POST /passports/:id/verify` does not change lifecycle state; it only updates `lastVerifiedAt` and is itself audit-logged as a read/verify action.
- Revoking a passport does not retroactively revoke a `PBRSCertificationRecord` already granted from it — certifications have their own independent revoke path (§4) so revocation reasoning stays specific to the record being revoked.

---

## 4. Certification Lifecycle

| State | Meaning | Allowed next states | Who can trigger | System event | Audit requirement |
|---|---|---|---|---|---|
| **Not Eligible** | Conceptual pre-state — passport's score does not clear any certification tier threshold. | Eligible | System (score recalculation crosses threshold) | — | — |
| **Eligible** | Passport score clears at least one tier threshold; no certification granted yet. | Certified | Admin, Owner (`POST /passports/:id/certification`) | `CertificationGranted` | Yes |
| **Certified** | Active certification record exists. | Expiring Soon, Revoked | System (time-based transition ~30 days pre-expiry) | — | — |
| **Expiring Soon** | Within the configurable pre-expiry window (default 30 days). | Expired, Certified (on renewal via `PATCH .../expiryDate`) | System | `Notification` sent to workspace Admins | Yes |
| **Expired** | `expiryDate` has passed without renewal. | *(terminal unless renewed → Eligible)* | System (expiry sweep) | — | Yes |
| **Revoked** | Manually invalidated ahead of expiry. | *(none — terminal)* | Owner only (`POST /certifications/:id/revoke`) | `CertificationRevoked` | Yes — `revokedReason` required |

**Notes:**
- Certification tier (`Platinum`/`Gold`/`Silver`/`Bronze`) is fixed at grant time from the passport's `scoreSnapshot`; a later re-score of the underlying assessment does **not** retroactively change an already-granted certification's tier — a new assessment cycle is required to change tier.
- Only `Owner` may revoke a certification (stricter than passport revocation, which allows `Admin` too) given its higher external/legal weight.

---

## 5. Report Lifecycle

| State | Meaning | Allowed next states | Who can trigger | System event | Audit requirement |
|---|---|---|---|---|---|
| **Requested** | Report row created; generation not yet started. | Generating | System (immediately enqueues), User (`POST /reports`) | `ReportRequested` | Yes |
| **Generating** | Generation job running. | Available, Failed | System | — | — |
| **Available** | `fileUrl` populated; downloadable until `expiresAt`. | Expired | System | `ReportGenerated` | Yes |
| **Expired** | Retention window passed; `fileUrl` no longer served. | Requested (via `POST /reports/:id/generate` to regenerate) | System (expiry sweep) | — | Yes |
| **Failed** | Generation job errored; `failureReason` populated. | Generating (via `POST /reports/:id/generate` retry) | System, User (manual retry) | — | Yes |

**Notes:**
- Reports are never edited in place — a retry after `Failed` or a regenerate after `Expired` transitions the *same* row back to `Generating` rather than creating a new `Report`, so the report's identity and audit trail stay continuous.
