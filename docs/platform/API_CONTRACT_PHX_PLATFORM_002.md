# Phoenix Platform — API Contract

**Task ID:** PHX-PLATFORM-002
**Status:** Draft contract — no backend implementation exists yet
**Scope:** REST-style API surface for Phoenix Platform (`apps/platform`)

---

## 0. Conventions

- **Base path:** `/api`
- **Format:** JSON request/response bodies only.
- **IDs:** UUID v4 strings, except `passportId` and `certificationId`, which use the human-readable `PBRS-[ORG]-[YEAR]-[SEQ]-[LEVEL]` format.
- **Dates:** ISO 8601 UTC (`2026-07-07T12:00:00Z`) unless noted as date-only.
- **Auth:** Every request requires a bearer session token resolved to a `User` and, for workspace-scoped endpoints, an active `WorkspaceMembership`. **Authentication implementation is out of scope for this contract** — see `PERMISSIONS_MODEL_PHX_PLATFORM_002.md` for the role model that will sit behind it.
- **Pagination:** List endpoints accept `?cursor=` and `?limit=` (default 25, max 100) and return `PaginatedResult<T>` (see `common.ts`).
- **Errors:** Non-2xx responses return `ApiError` (see `common.ts`) with a stable `code`, human `message`, optional field-level `details`, and a `requestId` for support/audit correlation.
- **Success:** Single-resource responses are wrapped in `ApiResult<T>` (`{ "data": {...} }`); list responses return `PaginatedResult<T>` directly.
- **Permission notes** below reference the `WorkspaceRole` matrix in `PERMISSIONS_MODEL_PHX_PLATFORM_002.md`; they are summarized, not exhaustive.

---

## 1. Workspaces

### `GET /api/workspaces`
- **Purpose:** List workspaces the current user belongs to.
- **Request params:** `cursor`, `limit`.
- **Request body:** none.
- **Response:** `PaginatedResult<Workspace>`.
- **Status codes:** `200`.
- **Permission notes:** Returns only workspaces with an active `WorkspaceMembership` for the caller.
- **Sample response:**
```json
{
  "items": [
    { "id": "3f2c...", "organizationId": "9a1b...", "name": "Acme Enterprise Workspace", "slug": "acme-enterprise",
      "settings": { "scoreThresholdOverride": null, "autoIssuePassports": false, "timezone": "Asia/Dubai" },
      "createdAt": "2026-01-10T09:00:00Z", "updatedAt": "2026-06-01T09:00:00Z", "deletedAt": null }
  ],
  "nextCursor": null,
  "totalCount": 1
}
```

### `GET /api/workspaces/:workspaceId`
- **Purpose:** Fetch a single workspace.
- **Request params:** `workspaceId` (path).
- **Response:** `ApiResult<Workspace>`.
- **Status codes:** `200`, `403` (not a member), `404`.
- **Permission notes:** Any active member role.

### `PATCH /api/workspaces/:workspaceId`
- **Purpose:** Update workspace name or settings.
- **Request body:** `Partial<Pick<Workspace, 'name' | 'settings'>>`.
- **Response:** `ApiResult<Workspace>`.
- **Status codes:** `200`, `400` (validation), `403`, `404`.
- **Permission notes:** `Owner` or `Admin` only.
- **Validation notes:** `settings.scoreThresholdOverride`, when provided, must satisfy `aMin > bMin > cMin`.

---

## 2. Users

### `GET /api/users/me`
- **Purpose:** Return the caller's profile plus workspace memberships.
- **Response:** `ApiResult<UserWorkspaceSummary>`.
- **Status codes:** `200`, `401`.

### `GET /api/workspaces/:workspaceId/users`
- **Purpose:** List members of a workspace.
- **Request params:** `cursor`, `limit`, optional `?role=` filter.
- **Response:** `PaginatedResult<User & { role: WorkspaceRole; membershipStatus: WorkspaceMembership['status'] }>`.
- **Status codes:** `200`, `403`, `404`.
- **Permission notes:** Any active member can list; `Viewer` sees the list but not audit-sensitive fields (`lastLoginAt`).

### `POST /api/workspaces/:workspaceId/users`
- **Purpose:** Invite a user to the workspace.
- **Request body:** `{ email: string; role: WorkspaceRole }`.
- **Response:** `ApiResult<WorkspaceMembership>`.
- **Status codes:** `201`, `400`, `403`, `409` (already a member).
- **Permission notes:** `Owner` or `Admin` only.
- **Validation notes:** `role` cannot be `Owner` via this endpoint — ownership transfer is a separate, more restricted flow (not covered in this Alpha contract).

### `PATCH /api/workspaces/:workspaceId/users/:userId`
- **Purpose:** Change a member's role or status.
- **Request body:** `Partial<Pick<WorkspaceMembership, 'role' | 'status'>>`.
- **Response:** `ApiResult<WorkspaceMembership>`.
- **Status codes:** `200`, `400`, `403`, `404`.
- **Permission notes:** `Owner` or `Admin`. Admins cannot promote a user to `Owner` or demote the `Owner`.

---

## 3. Assets

### `GET /api/workspaces/:workspaceId/assets`
- **Purpose:** List assets in a workspace.
- **Request params:** `cursor`, `limit`, optional `?status=`, `?department=`, `?ownerUserId=`.
- **Response:** `PaginatedResult<Asset>`.
- **Status codes:** `200`, `403`, `404`.
- **Permission notes:** Any active role, including `Viewer`.

### `POST /api/workspaces/:workspaceId/assets`
- **Purpose:** Create a new asset (implicitly creates AssetVersion 1).
- **Request body:** `{ name: string; type: AssetType; department: string; content?: string; contentUrl?: string; contentType: string }`.
- **Response:** `ApiResult<{ asset: Asset; version: AssetVersion }>`.
- **Status codes:** `201`, `400`, `403`.
- **Permission notes:** `Contributor` and above.
- **Validation notes:** Exactly one of `content` / `contentUrl` must be provided.

### `GET /api/assets/:assetId`
- **Purpose:** Fetch a single asset.
- **Response:** `ApiResult<Asset>`.
- **Status codes:** `200`, `403`, `404`.

### `PATCH /api/assets/:assetId`
- **Purpose:** Update asset metadata (name, department, owner) or transition `status`.
- **Request body:** `Partial<Pick<Asset, 'name' | 'department' | 'ownerUserId' | 'status'>>`.
- **Response:** `ApiResult<Asset>`.
- **Status codes:** `200`, `400`, `403`, `409` (invalid status transition — see `DATA_LIFECYCLE_PHX_PLATFORM_002.md`).
- **Permission notes:** `Contributor` (own assets) or `Reviewer`/`Admin`/`Owner` (any asset).

### `POST /api/assets/:assetId/versions`
- **Purpose:** Add a new immutable version of an asset's content.
- **Request body:** `{ content?: string; contentUrl?: string; contentType: string; changeNote?: string }`.
- **Response:** `ApiResult<AssetVersion>`.
- **Status codes:** `201`, `400`, `403`, `404`.
- **Permission notes:** `Contributor` and above. Creating a new version does not change `Asset.status` automatically.

---

## 4. Assessments

### `GET /api/workspaces/:workspaceId/assessments`
- **Purpose:** List assessments in a workspace.
- **Request params:** `cursor`, `limit`, optional `?status=`, `?assetId=`, `?assignedReviewerUserId=`.
- **Response:** `PaginatedResult<Assessment>`.
- **Status codes:** `200`, `403`.

### `POST /api/workspaces/:workspaceId/assessments`
- **Purpose:** Start a new assessment against an asset version.
- **Request body:** `{ assetId: string; assetVersionId: string }`.
- **Response:** `ApiResult<Assessment>` (status `Draft`).
- **Status codes:** `201`, `400`, `403`, `404`.
- **Permission notes:** `Contributor` and above.
- **Validation notes:** `assetVersionId` must belong to `assetId`.

### `GET /api/assessments/:assessmentId`
- **Purpose:** Fetch a single assessment, including its `AssessmentStep[]`.
- **Response:** `ApiResult<Assessment & { steps: AssessmentStep[] }>`.
- **Status codes:** `200`, `403`, `404`.

### `PATCH /api/assessments/:assessmentId`
- **Purpose:** Update assignment (`assignedReviewerUserId`) or step-level progress.
- **Request body:** `Partial<Pick<Assessment, 'assignedReviewerUserId'>>`.
- **Response:** `ApiResult<Assessment>`.
- **Status codes:** `200`, `400`, `403`.
- **Permission notes:** `Reviewer`, `Admin`, `Owner` may (re)assign a reviewer.

### `POST /api/assessments/:assessmentId/submit`
- **Purpose:** Transition `Draft`/`Evidence Pending` → `Under Review` once evidence is attached.
- **Request body:** none.
- **Response:** `ApiResult<Assessment>`.
- **Status codes:** `200`, `409` (missing required evidence or asset not in a submittable state).
- **Permission notes:** Asset owner or `Contributor` who created the assessment.

### `POST /api/assessments/:assessmentId/review`
- **Purpose:** Record reviewer progress without finalizing a decision (e.g. mark steps complete, request more evidence).
- **Request body:** `{ stepId: string; status: AssessmentStepStatus; notes?: string }`.
- **Response:** `ApiResult<AssessmentStep>`.
- **Status codes:** `200`, `400`, `403`.
- **Permission notes:** `Reviewer` and above.

### `POST /api/assessments/:assessmentId/decision`
- **Purpose:** Record the final reviewer decision: `Approved`, `Needs Improvement`, or `Rejected`.
- **Request body:** `{ decision: 'Approved' | 'Needs Improvement' | 'Rejected'; decisionNotes: string }`.
- **Response:** `ApiResult<Assessment>`.
- **Status codes:** `200`, `400` (missing `decisionNotes`), `403`, `409` (assessment not in `Decision Pending`).
- **Permission notes:** `Reviewer` and above. Writes one `AuditRecord`.
- **Validation notes:** `Approved` requires a completed `PBRSScoreRecord` (`scoreId` set) with no unresolved dimension below the workspace's `Hold` threshold unless explicitly overridden with justification.

---

## 5. Evidence

### `GET /api/assessments/:assessmentId/evidence`
- **Purpose:** List evidence attached to an assessment.
- **Response:** `PaginatedResult<EvidenceItem>`.
- **Status codes:** `200`, `403`.

### `POST /api/assessments/:assessmentId/evidence`
- **Purpose:** Attach a new evidence item.
- **Request body:** `{ type: EvidenceType; title: string; note?: string; fileUrl?: string; externalUrl?: string; relatedDimension?: PBRSDimensionKey }`.
- **Response:** `ApiResult<EvidenceItem>`.
- **Status codes:** `201`, `400`, `403`.
- **Permission notes:** `Contributor` and above.
- **Validation notes:** Exactly one of `note` / `fileUrl` / `externalUrl` required depending on `type`.

### `PATCH /api/evidence/:evidenceId`
- **Purpose:** Edit an evidence item's title/note prior to assessment submission.
- **Response:** `ApiResult<EvidenceItem>`.
- **Status codes:** `200`, `403` (assessment already submitted — evidence becomes immutable), `404`.

### `DELETE /api/evidence/:evidenceId`
- **Purpose:** Remove an evidence item prior to submission.
- **Status codes:** `204`, `403`, `404`, `409` (assessment already submitted).

---

## 6. PBRS Score

### `GET /api/assessments/:assessmentId/score`
- **Purpose:** Fetch the current `PBRSScoreRecord` for an assessment.
- **Response:** `ApiResult<PBRSScoreRecord>`.
- **Status codes:** `200`, `404` (not yet scored).

### `POST /api/assessments/:assessmentId/score/run`
- **Purpose:** Trigger (or re-trigger) the automated scoring engine against the assessment's evidence and asset version.
- **Request body:** none.
- **Response:** `ApiResult<PBRSScoreRecord>` with `scoringMethod: "Automated"`.
- **Status codes:** `202` (scoring queued — poll `GET .../score`), `409` (assessment not in `Scoring Pending`).
- **Permission notes:** `Contributor` and above.
- **Validation notes:** Always computes exactly the six PBRS dimensions (`accuracy`, `compliance`, `brandAlignment`, `structure`, `consistency`, `completeness`) plus the three derived signals. See `PBRS_SCORING_CONTRACT_PHX_PLATFORM_002.md`.

### `PATCH /api/assessments/:assessmentId/score/override`
- **Purpose:** Manually override one or more dimension scores after an automated run.
- **Request body:** `{ dimension: PBRSDimensionKey; value: number; overrideReason: string; evidenceIds: string[] }`.
- **Response:** `ApiResult<PBRSScoreRecord>`.
- **Status codes:** `200`, `400` (missing `overrideReason` or `evidenceIds`), `403`.
- **Permission notes:** `Reviewer` and above only. Writes one `AuditRecord` per override.

---

## 7. Passports

### `GET /api/workspaces/:workspaceId/passports`
- **Purpose:** List passports in a workspace.
- **Request params:** `cursor`, `limit`, optional `?status=`.
- **Response:** `PaginatedResult<PBRSPassport>`.
- **Status codes:** `200`, `403`.

### `POST /api/assessments/:assessmentId/passport`
- **Purpose:** Issue a passport from an `Approved` assessment.
- **Request body:** none.
- **Response:** `ApiResult<PBRSPassport>` (status `Issued`).
- **Status codes:** `201`, `409` (assessment not `Approved`, or a passport already exists for this assessment).
- **Permission notes:** `Reviewer`, `Admin`, `Owner`. If `Workspace.settings.autoIssuePassports` is `true`, this also fires automatically on approval.

### `GET /api/passports/:passportId`
- **Purpose:** Fetch a single passport.
- **Response:** `ApiResult<PBRSPassport>`.
- **Status codes:** `200`, `403`, `404`.

### `PATCH /api/passports/:passportId`
- **Purpose:** Revoke a passport (the only mutable transition post-issuance).
- **Request body:** `{ status: 'Revoked'; revokedReason: string }`.
- **Response:** `ApiResult<PBRSPassport>`.
- **Status codes:** `200`, `400`, `403`, `409` (already revoked/archived).
- **Permission notes:** `Admin`, `Owner`.

### `POST /api/passports/:passportId/verify`
- **Purpose:** Re-hash the source AssetVersion and confirm it still matches `recordHash`.
- **Response:** `ApiResult<{ verified: boolean; passport: PBRSPassport }>`.
- **Status codes:** `200`, `404`.
- **Permission notes:** Any active member. Updates `lastVerifiedAt`.

---

## 8. Certifications

### `GET /api/workspaces/:workspaceId/certifications`
- **Purpose:** List certifications in a workspace.
- **Request params:** `cursor`, `limit`, optional `?status=`, `?tier=`.
- **Response:** `PaginatedResult<PBRSCertificationRecord>`.
- **Status codes:** `200`, `403`.

### `POST /api/passports/:passportId/certification`
- **Purpose:** Grant a certification against an issued passport whose score clears the requested tier's threshold.
- **Request body:** `{ tier: CertificationTier }`.
- **Response:** `ApiResult<PBRSCertificationRecord>` (status `Certified`).
- **Status codes:** `201`, `409` (score below tier threshold, or passport not `Active`).
- **Permission notes:** `Admin`, `Owner`.

### `GET /api/certifications/:certificationId`
- **Purpose:** Fetch a single certification.
- **Response:** `ApiResult<PBRSCertificationRecord>`.
- **Status codes:** `200`, `403`, `404`.

### `PATCH /api/certifications/:certificationId`
- **Purpose:** Update expiry or renew.
- **Request body:** `Partial<Pick<PBRSCertificationRecord, 'expiryDate'>>`.
- **Response:** `ApiResult<PBRSCertificationRecord>`.
- **Status codes:** `200`, `403`.
- **Permission notes:** `Admin`, `Owner`.

### `POST /api/certifications/:certificationId/revoke`
- **Purpose:** Revoke a certification ahead of its expiry.
- **Request body:** `{ revokedReason: string }`.
- **Response:** `ApiResult<PBRSCertificationRecord>`.
- **Status codes:** `200`, `403`, `409` (already revoked/expired).
- **Permission notes:** `Owner` only.

---

## 9. Reports

### `GET /api/workspaces/:workspaceId/reports`
- **Purpose:** List generated/in-progress reports.
- **Request params:** `cursor`, `limit`, optional `?status=`.
- **Response:** `PaginatedResult<Report>`.
- **Status codes:** `200`, `403`.

### `POST /api/workspaces/:workspaceId/reports`
- **Purpose:** Request a new report from a template.
- **Request body:** `{ templateId: string; assetId?: string; format: 'pdf' | 'html' | 'csv' }`.
- **Response:** `ApiResult<Report>` (status `Requested`).
- **Status codes:** `201`, `400`, `403`.
- **Validation notes:** `assetId` required when the template's `scope` is `SingleAsset`; forbidden otherwise.

### `GET /api/reports/:reportId`
- **Purpose:** Poll report status.
- **Response:** `ApiResult<Report>`.
- **Status codes:** `200`, `403`, `404`.

### `POST /api/reports/:reportId/generate`
- **Purpose:** (Re)trigger generation for a `Requested` or `Failed` report.
- **Response:** `ApiResult<Report>` (status `Generating`).
- **Status codes:** `202`, `409` (already `Generating` or `Available`).

### `GET /api/reports/:reportId/download`
- **Purpose:** Redirect to (or return) the generated file.
- **Response:** `302` redirect to `fileUrl`, or `ApiResult<{ fileUrl: string }>` if the client requests JSON via `Accept: application/json`.
- **Status codes:** `200`/`302`, `404`, `409` (status is not `Available`).

---

## 10. Activity / Audit

### `GET /api/workspaces/:workspaceId/activity`
- **Purpose:** Workspace activity feed for the dashboard.
- **Request params:** `cursor`, `limit`, optional `?type=`, `?relatedEntityId=`.
- **Response:** `PaginatedResult<ActivityLog>`.
- **Status codes:** `200`, `403`.
- **Permission notes:** Any active role.

### `GET /api/workspaces/:workspaceId/audit-records`
- **Purpose:** Immutable audit trail for compliance review.
- **Request params:** `cursor`, `limit`, optional `?entityType=`, `?entityId=`, `?actorUserId=`, `?from=`, `?to=`.
- **Response:** `PaginatedResult<AuditRecord>`.
- **Status codes:** `200`, `403`.
- **Permission notes:** `Auditor`, `Admin`, `Owner` only. `Reviewer`/`Contributor`/`Viewer` receive `403`.
- **Sample response:**
```json
{
  "items": [
    {
      "id": "77aa...", "workspaceId": "3f2c...", "createdAt": "2026-07-05T14:02:11Z",
      "actorUserId": "1c9d...", "action": "assessment.decision.approved",
      "entityType": "Assessment", "entityId": "8b21...",
      "changes": { "status": ["Decision Pending", "Approved"] }
    }
  ],
  "nextCursor": null,
  "totalCount": 1
}
```
