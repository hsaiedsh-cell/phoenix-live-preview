# Phoenix Platform — API Contract Mapping

**Task ID:** PHX-PLATFORM-009
**Purpose:** Maps every function currently exported by
`apps/platform/src/lib/mock-api-client.ts` (re-exported via
`api-client.ts`) to its future endpoint in
`API_CONTRACT_PHX_PLATFORM_002.md`, current status, and integration notes
for the sprint that eventually implements `real-api-client.ts`'s
`phoenixFetch()`.

All "current status" values are one of:

- **Mock (facade-wrapped)** — routes through `getPhoenixApiConfig()`; in
  `real-disabled` mode returns a disabled result instead of mutating.
  Applies only to the four governance actions this sprint.
- **Mock (always mock)** — re-exported directly from `mock-api-client.ts`
  via `api-client.ts`'s `export *`; always executes regardless of resolved
  mode. See PHX-PLATFORM-009 implementation report §14 for why this is a
  deliberate scope decision, not an oversight.

No entity requires new permissions beyond what
`PERMISSIONS_MODEL_PHX_PLATFORM_002.md` / `access-control.ts` already
describe — "Permissions required" below summarizes, it does not redefine.

---

## Workspace / User

| Mock function | Future endpoint | Status | Request shape | Response shape | Permissions |
|---|---|---|---|---|---|
| `getCurrentUser()` | `GET /api/users/me` | Mock (always mock) | none | `ApiResult<User>` (Alpha returns bare `User`, not `UserWorkspaceSummary`) | Any authenticated user |
| `getCurrentWorkspace()` | `GET /api/workspaces/:workspaceId` | Mock (always mock) | `workspaceId` (path) | `ApiResult<Workspace>` | Any active member |
| `getWorkspaceUsers()` | `GET /api/workspaces/:workspaceId/users` | Mock (always mock) | `cursor?`, `limit?`, `role?` | `PaginatedResult<User & { role }>` | Any active member |

## Dashboard

| Mock function | Future endpoint | Status | Request shape | Response shape | Permissions |
|---|---|---|---|---|---|
| `getDashboardSummary()` | No 1:1 endpoint yet — composed client-side from assets/passports/certifications reads. A future sprint should define `GET /api/workspaces/:workspaceId/dashboard-summary` to avoid N+1 calls (see `api-adapters.ts` design note). | Mock (always mock) | `workspaceId` (path, future) | `DashboardSummaryViewModel` | Any active member |
| `getReadinessTrend()` | Same as above — folds into the future dashboard-summary endpoint. | Mock (always mock) | — | `number[]` | Any active member |
| `getRecentAssessments(limit)` | `GET /api/workspaces/:workspaceId/assessments?limit=` | Mock (always mock) | `limit?` | `AssessmentListItemViewModel[]` | Any active member |

## Assets

| Mock function | Future endpoint | Status | Request shape | Response shape | Permissions |
|---|---|---|---|---|---|
| `getAssets()` | `GET /api/workspaces/:workspaceId/assets` | Mock (always mock) | `cursor?`, `limit?`, `status?`, `department?`, `ownerUserId?` | `PaginatedResult<Asset>` | Any active role, incl. Viewer |
| `getAssetById(assetId)` | `GET /api/assets/:assetId` | Mock (always mock) | `assetId` (path) | `ApiResult<Asset> \| null` | Any active role |
| `createAsset(input)` | `POST /api/workspaces/:workspaceId/assets` | Mock (always mock) | `CreateAssetInput` → `{ name, type, department, content?, contentUrl?, contentType }` | `ApiResult<Asset>` (Alpha omits the paired `AssetVersion` the real contract also returns) | Contributor+ |
| `updateAsset(assetId, input)` | `PATCH /api/assets/:assetId` | Mock (always mock) | `UpdateAssetInput` → `Partial<Pick<Asset, 'name'\|'department'\|'ownerUserId'\|'status'>>` | `ApiResult<Asset>` | Contributor (own) or Reviewer/Admin/Owner |

## Assessments

| Mock function | Future endpoint | Status | Request shape | Response shape | Permissions |
|---|---|---|---|---|---|
| `getAssessments(...)` | `GET /api/workspaces/:workspaceId/assessments` | Mock (always mock) | `cursor?`, `limit?`, `status?`, `assetId?`, `assignedReviewerUserId?` | `PaginatedResult<AssessmentListItemViewModel>`-shaped read model | Any active role |
| `getAssessmentListItems(...)` | Same as above (alt name, PHX-PLATFORM-004 convention) | Mock (always mock) | same | same | Any active role |
| `getAssessmentById(assessmentId)` | `GET /api/assessments/:assessmentId` | Mock (always mock) | `assessmentId` (path) | `ApiResult<Assessment> \| null` | Any active role |
| `getAssessmentDetail(assessmentId)` | `GET /api/assessments/:assessmentId` (`& { steps: AssessmentStep[] }` variant) | Mock (always mock) | `assessmentId` (path) | `AssessmentDetailViewModel` | Any active role |
| `createAssessment(input)` | `POST /api/workspaces/:workspaceId/assessments` | Mock (always mock) | `CreateAssessmentInput` → `{ assetId, assetVersionId }` | `ApiResult<Assessment>` (status `Draft`) | Contributor+ |
| `submitAssessment(assessmentId)` | `POST /api/assessments/:assessmentId/submit` | Mock (always mock) | `assessmentId` (path) | `ApiResult<Assessment>` | Asset owner or creating Contributor |
| `updateAssessmentStep(...)` | `POST /api/assessments/:assessmentId/review` | Mock (always mock) | `UpdateAssessmentStepInput` → `{ stepId, status, notes? }` | `ApiResult<AssessmentStep>` | Reviewer+ |
| `recordAssessmentDecision(...)` | `POST /api/assessments/:assessmentId/decision` | Mock (always mock) | `AssessmentDecisionInput` → `{ decision, decisionNotes }` | `ApiResult<Assessment>` | Reviewer+; writes one `AuditRecord` |

## Evidence

| Mock function | Future endpoint | Status | Request shape | Response shape | Permissions |
|---|---|---|---|---|---|
| `getEvidenceItems(assessmentId)` | `GET /api/assessments/:assessmentId/evidence` | Mock (always mock) | `assessmentId` (path) | `PaginatedResult<EvidenceItem>` | Any active role |
| `addEvidenceItem(assessmentId, input)` | `POST /api/assessments/:assessmentId/evidence` | Mock (always mock) | `AddEvidenceInput` → `{ type, title, note?, fileUrl?, externalUrl?, relatedDimension? }` | `ApiResult<EvidenceItem>` | Contributor+ |
| `updateEvidenceItem(evidenceId, input)` | `PATCH /api/evidence/:evidenceId` | Mock (always mock) | `UpdateEvidenceInput` | `ApiResult<EvidenceItem>` | Pre-submission only |
| `deleteEvidenceItem(evidenceId)` | `DELETE /api/evidence/:evidenceId` | Mock (always mock) | `evidenceId` (path) | `ApiResult<{ id, deleted: true }>` (real contract returns `204`) | Pre-submission only |

## PBRS Score

| Mock function | Future endpoint | Status | Request shape | Response shape | Permissions |
|---|---|---|---|---|---|
| `getAssessmentScore(assessmentId)` | `GET /api/assessments/:assessmentId/score` | Mock (always mock) | `assessmentId` (path) | `ApiResult<PBRSScoreRecord> \| null` | Any active role |
| `runAssessmentScore(assessmentId)` | `POST /api/assessments/:assessmentId/score/run` | Mock (always mock) | `assessmentId` (path) | `ApiResult<PBRSScoreRecord> \| null` (real contract responds `202` and is polled) | Contributor+ |
| `overrideDimensionScore(...)` | `PATCH /api/assessments/:assessmentId/score/override` | Mock (always mock) | `OverrideDimensionScoreInput` → `{ dimension, value, overrideReason, evidenceIds }` | `ApiResult<PBRSScoreRecord>` | Reviewer+; writes one `AuditRecord` per override. **No PBRS dimension/weight/threshold logic is duplicated here or changed by this sprint** — see `PBRS_DIMENSIONS` in `@phoenix/core`. |

## Passports

| Mock function | Future endpoint | Status | Request shape | Response shape | Permissions |
|---|---|---|---|---|---|
| `getPassports()` | `GET /api/workspaces/:workspaceId/passports` | Mock (always mock) | `cursor?`, `limit?`, `status?` | `PaginatedResult<PassportListItemViewModel>` | Any active role |
| `getPassportListItems()` | Same as above (alt name) | Mock (always mock) | same | same | Any active role |
| `getPassportById(passportId)` | `GET /api/passports/:passportId` | Mock (always mock) | `passportId` (path) | `ApiResult<PassportListItemViewModel> \| null` | Any active role |
| `issuePassport(input)` | `POST /api/assessments/:assessmentId/passport` | **Mock (facade-wrapped)** | `PassportActionInput` → `{ assessmentId?, passportId?, reason? }` | `PhoenixActionResult` (adapted from `ApiResult<PBRSPassport>` in the real contract) | Reviewer, Admin, Owner |
| `revokePassport(input)` | `PATCH /api/passports/:passportId` (`{ status: 'Revoked', revokedReason }`) | **Mock (facade-wrapped)** | `PassportActionInput` → `{ passportId?, assessmentId?, reason }` (reason required) | `PhoenixActionResult` | Admin, Owner |
| `verifyPassport(passportId)` | `POST /api/passports/:passportId/verify` | Mock (always mock) | `passportId` (path) | `ApiResult<{ passportId, verified, verifiedAt }>` | Any active member |

## Certifications

| Mock function | Future endpoint | Status | Request shape | Response shape | Permissions |
|---|---|---|---|---|---|
| `getCertifications()` | `GET /api/workspaces/:workspaceId/certifications` | Mock (always mock) | `cursor?`, `limit?`, `status?`, `tier?` | `CertificationsOverview` (composed read model: levels + certified/eligible/expiring rows) | Any active role |
| `getCertificationListItems()` | Same as above (alt name) | Mock (always mock) | same | `CertificationListItemViewModel[]` | Any active role |
| `getCertificationById(certificationId)` | `GET /api/certifications/:certificationId` | Mock (always mock) | `certificationId` (path) | `ApiResult<PBRSCertificationRecord> \| null` | Any active role |
| `grantCertification(input)` | `POST /api/passports/:passportId/certification` | **Mock (facade-wrapped)** | `CertificationActionInput` → `{ passportId, certificationId?, reason? }` | `PhoenixActionResult` (adapted from `ApiResult<PBRSCertificationRecord>`) | Admin, Owner. **No Certification Level / Internal Tier threshold logic changed** — see `certification-levels.ts`. |
| `revokeCertification(input)` | `POST /api/certifications/:certificationId/revoke` | **Mock (facade-wrapped)** | `CertificationActionInput` → `{ passportId, certificationId?, reason }` (reason required) | `PhoenixActionResult` | Owner only |

## Reports

| Mock function | Future endpoint | Status | Request shape | Response shape | Permissions |
|---|---|---|---|---|---|
| `getReports()` | `GET /api/workspaces/:workspaceId/reports` | Mock (always mock) | `cursor?`, `limit?`, `status?` | `ReportListItemViewModel[]` | Any active role |
| `getReportListItems()` | Same as above (alt name) | Mock (always mock) | same | same | Any active role |
| `getReportById(reportId)` | `GET /api/reports/:reportId` | Mock (always mock) | `reportId` (path) | `ApiResult<ReportListItemViewModel> \| null` | Any active role |
| `requestReport(input)` | `POST /api/workspaces/:workspaceId/reports` | Mock (always mock) | `RequestReportInput` → `{ templateId, assetId?, format? }` | `ApiResult<Report>` (status `Requested`) | Any active role (contract does not further restrict) |
| `generateReport(reportId)` | `POST /api/reports/:reportId/generate` | Mock (always mock) | `reportId` (path) | `ApiResult<Report>` (status `Generating`/`Available`) | Any active role |

## Activity / Audit

| Mock function | Future endpoint | Status | Request shape | Response shape | Permissions |
|---|---|---|---|---|---|
| `getActivityLog(limit)` | `GET /api/workspaces/:workspaceId/activity` | Mock (always mock) | `cursor?`, `limit?`, `type?`, `relatedEntityId?` | `PaginatedResult<ActivityLog>` | Any active role |
| `getAuditRecords(limit)` | `GET /api/workspaces/:workspaceId/audit-records` | Mock (always mock) | `cursor?`, `limit?`, `entityType?`, `entityId?`, `actorUserId?`, `from?`, `to?` | `PaginatedResult<AuditRecord>` | **Auditor, Admin, Owner only** — Reviewer/Contributor/Viewer get `403` per contract; UI enforces via `RoleGate permission="canViewAuditTrail"` |
| `getActivityForEntity(entityId, limit)` | `GET /api/workspaces/:workspaceId/activity?relatedEntityId=` | Mock (always mock) | `entityId`, `limit?` | `ActivityLog[]` | Any active role |
| `getAuditRecordsForEntity(entityId, limit)` | `GET /api/workspaces/:workspaceId/audit-records?entityId=` | Mock (always mock) | `entityId`, `limit?` | `AuditRecord[]` | Auditor, Admin, Owner only |

## Settings

| Mock function | Future endpoint | Status | Request shape | Response shape | Permissions |
|---|---|---|---|---|---|
| `getWorkspaceSettings()` | `GET /api/workspaces/:workspaceId` (settings subset) | Mock (always mock) | `workspaceId` (path) | `PlatformWorkspaceSettingsView` | Any active member |
| `updateWorkspaceSettings(input)` | `PATCH /api/workspaces/:workspaceId` | Mock (always mock) | `UpdateWorkspaceSettingsInput` → `Partial<Pick<Workspace, 'name'\|'settings'>>` | `ApiResult<WorkspaceSettings>` | Owner or Admin only |

---

## Not yet mapped

- `POST /api/workspaces/:workspaceId/users` (invite) and `PATCH
  /api/workspaces/:workspaceId/users/:userId` (change role/status) have no
  mock-api-client.ts equivalent yet — no Alpha UI calls them.
- `POST /api/assets/:assetId/versions` (new asset version) has no mock
  equivalent yet.

Both are natural candidates for a future sprint once user-management or
asset-versioning UI is scoped.
