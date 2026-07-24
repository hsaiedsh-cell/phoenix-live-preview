// ============================================================
// Phoenix Platform — Mock API Client (Implementation)
// PHX-PLATFORM-003 — Mock API Layer
// PHX-PLATFORM-009 — Backend Integration Readiness Layer
// ------------------------------------------------------------
// Contract-shaped async functions standing in for the future
// Phoenix Platform backend (see API_CONTRACT_PHX_PLATFORM_002.md
// and its PHX-PLATFORM-003 addendum). Every function here reads
// from local sample data and resolves a Promise — no network
// calls are made.
//
// PHX-PLATFORM-009: this file is the MOCK IMPLEMENTATION. It is
// no longer the public import surface — api-client.ts is now a
// thin public facade that re-exports everything below and wraps
// the four governance actions (issuePassport, revokePassport,
// grantCertification, revokeCertification) with the api-config.ts
// mode boundary. Pages/components should continue to import from
// api-client.ts, never from this file directly, so a future real
// backend integration only ever changes the facade.
//
// Only this file and api-adapters.ts are permitted to import
// sample-data.ts (this replaces the prior PHX-PLATFORM-003 rule
// that named api-client.ts directly — api-client.ts no longer
// imports sample-data.ts at all as of PHX-PLATFORM-009).
//
// Migrating to a real backend later should mean swapping the
// facade's routing in api-client.ts to call real-api-client.ts
// instead of this file for a given function — this file's
// function bodies do not need to change shape for that to happen.
//
// PHX-PLATFORM-006 note: this layer does not receive or enforce
// the mock session/role from lib/mock-session.ts or
// lib/access-control.ts. All gating in this Alpha is UI-only (see
// RoleGate.tsx). A real backend should accept the session/role as
// request context (e.g. an auth header or server-side session
// lookup) and enforce PERMISSIONS_MODEL_PHX_PLATFORM_002.md
// server-side — the functions below are not a security boundary
// and should not be treated as one. No request headers, tokens, or
// other fake security are added here in this Alpha.
// ============================================================

import type {
  Asset,
  Assessment,
  AssessmentStep,
  EvidenceItem,
  PBRSScoreRecord,
  PBRSDimensionScore,
  PBRSCertificationRecord,
  PBRSPassport,
  Report,
  ActivityLog,
  AuditRecord,
  User,
  Workspace,
  WorkspaceSettings,
  ApiResult,
  PaginatedResult,
} from '@phoenix/core';
import {
  mapSampleAssetToAsset,
  mapSampleAssetToAssessment,
  mapSampleAssetToPBRSScoreRecord,
  mapSampleReportToReport,
  buildDashboardSummary,
  buildReadinessTrend,
  buildWorkspaceSettings,
  buildAssessmentListItems,
  buildPassportListItems,
  buildCertificationListItems,
  buildCertificationsOverview,
  buildReportListItems,
  buildEvidenceItems,
  buildActivityLogs,
  buildAuditRecords,
  buildAssessmentDetail,
  getActivityForEntity as adaptersGetActivityForEntity,
  getAuditRecordsForEntity as adaptersGetAuditRecordsForEntity,
  type CertificationsOverview,
  type PlatformWorkspaceSettingsView,
  MOCK_WORKSPACE_ID,
  MOCK_ORGANIZATION_ID,
  MOCK_OWNER_USER_ID,
} from './api-adapters';
import { SAMPLE_ASSETS, SAMPLE_REPORTS } from './sample-data';
import type {
  AssessmentListItemViewModel,
  AssessmentDetailViewModel,
  PassportListItemViewModel,
  CertificationListItemViewModel,
  ReportListItemViewModel,
  DashboardSummaryViewModel,
} from './view-models';
import { mockDelay } from './mock-latency';
import type {
  CreateAssetInput,
  UpdateAssetInput,
  CreateAssessmentInput,
  UpdateAssessmentStepInput,
  AssessmentDecisionInput,
  AddEvidenceInput,
  UpdateEvidenceInput,
  OverrideDimensionScoreInput,
  RequestReportInput,
  UpdateWorkspaceSettingsInput,
} from './api-inputs';
import type { PhoenixActionResult, PassportActionInput, CertificationActionInput } from './action-types';

// Re-export action-layer types so components/pages depend on api-client.ts,
// consistent with the view-model / certification-level re-export pattern
// above (Task 2 / Task 3-4, PHX-PLATFORM-007).
export type { PhoenixActionStatus, PhoenixActionResult, PassportActionInput, CertificationActionInput } from './action-types';

// Re-export view models so components/pages depend on api-client.ts,
// never on lib/view-models.ts or sample-data.ts directly.
export type {
  AssessmentListItemViewModel,
  AssessmentDetailViewModel,
  PassportListItemViewModel,
  CertificationListItemViewModel,
  ReportListItemViewModel,
  DashboardSummaryViewModel,
  SimpleGrade,
} from './view-models';
export type { CertificationsOverview, PlatformWorkspaceSettingsView } from './api-adapters';

// PHX-CERT-002 — Certification Level presentation helpers, re-exported so
// pages/components depend on api-client.ts rather than reaching into
// lib/certification-levels.ts directly (same pattern as view-models above).
export type { PBRSCertificationLevel, PBRSInternalTier } from './certification-levels';
export {
  certificationLevelFromScore,
  certificationLevelShortLabel,
  certificationStatusLabel,
  isCertificationLevelEligible,
  eligibilityLabelFromScore,
  shouldDisplayInternalTier,
  PBRS_CERTIFICATION_SAFE_DISCLAIMER,
} from './certification-levels';
// `export { X } from './module'` re-exports X for other files but does not
// bind it in this module's own scope — imported separately here since
// grantCertification() below needs to use the disclaimer text directly.
import { PBRS_CERTIFICATION_SAFE_DISCLAIMER } from './certification-levels';

// Legacy sample-only types. Still used internally by a handful of
// mutation functions (createAsset, requestReport, etc.) that synthesize
// mock entities without a full sample-data row to decompose. Not the
// primary shape returned by list-facing functions anymore — see
// getAssessments / getPassports / getCertifications / getReports below.
export type { PhoenixAsset, PhoenixPassport, PhoenixReport, AssetStatus } from './sample-data';

// ------------------------------------------------------------
// Mock workspace / user singletons
// ------------------------------------------------------------

const MOCK_USER: User = {
  id: MOCK_OWNER_USER_ID,
  email: 'hossam@acme-enterprise.example',
  displayName: 'Hossam M.',
  platformRole: 'StandardUser',
  lastLoginAt: new Date().toISOString(),
  createdAt: '2026-01-10T09:00:00Z',
  updatedAt: '2026-01-10T09:00:00Z',
  deletedAt: null,
};

const MOCK_WORKSPACE: Workspace = {
  id: MOCK_WORKSPACE_ID,
  organizationId: MOCK_ORGANIZATION_ID,
  name: 'Acme Enterprise Workspace',
  slug: 'acme-enterprise',
  settings: {
    scoreThresholdOverride: null,
    autoIssuePassports: false,
    timezone: 'Asia/Dubai',
  },
  createdAt: '2026-01-10T09:00:00Z',
  updatedAt: '2026-06-01T09:00:00Z',
  deletedAt: null,
};

function assessmentIdToAssetId(assessmentId: string): string {
  return assessmentId.endsWith('-assessment') ? assessmentId.slice(0, -'-assessment'.length) : assessmentId;
}

// ------------------------------------------------------------
// Workspace / User
// ------------------------------------------------------------

export async function getCurrentUser(): Promise<ApiResult<User>> {
  return mockDelay({ data: MOCK_USER });
}

export async function getCurrentWorkspace(): Promise<ApiResult<Workspace>> {
  return mockDelay({ data: MOCK_WORKSPACE });
}

export async function getWorkspaceUsers(): Promise<PaginatedResult<User & { role: string }>> {
  const items = [{ ...MOCK_USER, role: 'Owner' }];
  return mockDelay({ items, nextCursor: null, totalCount: items.length });
}

// ------------------------------------------------------------
// Dashboard
// ------------------------------------------------------------

export async function getDashboardSummary(): Promise<DashboardSummaryViewModel> {
  return mockDelay(buildDashboardSummary());
}

export async function getReadinessTrend(): Promise<number[]> {
  return mockDelay(buildReadinessTrend());
}

export async function getRecentAssessments(limit: number = 5): Promise<AssessmentListItemViewModel[]> {
  const sorted = [...buildAssessmentListItems()].sort((a, b) =>
    (a.asset.lastAssessedAt ?? '') < (b.asset.lastAssessedAt ?? '') ? 1 : -1
  );
  return mockDelay(sorted.slice(0, limit));
}

// ------------------------------------------------------------
// Assets
// ------------------------------------------------------------

export async function getAssets(): Promise<PaginatedResult<Asset>> {
  const items = SAMPLE_ASSETS.map(mapSampleAssetToAsset);
  return mockDelay({ items, nextCursor: null, totalCount: items.length });
}

export async function getAssetById(assetId: string): Promise<ApiResult<Asset> | null> {
  const found = SAMPLE_ASSETS.find((a) => a.id === assetId);
  if (!found) return mockDelay(null);
  return mockDelay({ data: mapSampleAssetToAsset(found) });
}

export async function createAsset(input: CreateAssetInput): Promise<ApiResult<Asset>> {
  // Mock-only: synthesizes and echoes back an Asset. Nothing is persisted
  // in this Alpha build — a page refresh loses any "created" asset.
  const now = new Date().toISOString();
  const asset: Asset = {
    id: `ast-mock-${Date.now()}`,
    workspaceId: MOCK_WORKSPACE_ID,
    name: input.name,
    type: input.type,
    department: input.department,
    ownerUserId: MOCK_OWNER_USER_ID,
    status: 'Draft',
    currentVersionId: null,
    lastAssessedAt: null,
    latestScoreSnapshot: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  return mockDelay({ data: asset });
}

export async function updateAsset(assetId: string, input: UpdateAssetInput): Promise<ApiResult<Asset>> {
  const existing = SAMPLE_ASSETS.find((a) => a.id === assetId);
  const base = existing ? mapSampleAssetToAsset(existing) : (await createAsset({ name: 'Untitled Asset', type: 'Other', department: 'Unassigned' })).data;
  const updated: Asset = { ...base, ...input, updatedAt: new Date().toISOString() };
  return mockDelay({ data: updated });
}

// ------------------------------------------------------------
// Assessments
// ------------------------------------------------------------

export interface AssessmentFilters {
  status?: string;
  department?: string;
  riskLevel?: string;
  grade?: string;
}

/**
 * Returns the assessment list view consumed by the /assessments page —
 * one AssessmentListItemViewModel per Asset, composed in
 * api-adapters.ts's buildAssessmentListItems() from Asset + Assessment +
 * PBRSScoreRecord. Filtering happens against the view model's presentation
 * fields (statusLabel, riskLabel, simpleGrade) so filter values match what
 * the UI displays.
 */
export async function getAssessments(
  filters?: AssessmentFilters
): Promise<PaginatedResult<AssessmentListItemViewModel>> {
  let items = buildAssessmentListItems();
  if (filters) {
    items = items.filter((item) => {
      if (filters.status && item.statusLabel !== filters.status) return false;
      if (filters.department && item.asset.department !== filters.department) return false;
      if (filters.riskLevel && item.riskLabel !== filters.riskLevel) return false;
      if (filters.grade && item.simpleGrade !== filters.grade) return false;
      return true;
    });
  }
  return mockDelay({ items, nextCursor: null, totalCount: items.length });
}

/** Same shape as getAssessments(), named to match the PHX-PLATFORM-004 optional-function convention. */
export async function getAssessmentListItems(
  filters?: AssessmentFilters
): Promise<PaginatedResult<AssessmentListItemViewModel>> {
  return getAssessments(filters);
}

export async function getAssessmentById(assessmentId: string): Promise<ApiResult<Assessment> | null> {
  const found = SAMPLE_ASSETS.find((a) => a.id === assessmentIdToAssetId(assessmentId));
  if (!found) return mockDelay(null);
  return mockDelay({ data: mapSampleAssetToAssessment(found) });
}

/**
 * Returns the full assessment detail read model consumed by
 * /assessments/[assessmentId] — Asset + Assessment + PBRSScoreRecord, joined
 * with evidence, activity, and audit records scoped to this assessment. See
 * buildAssessmentDetail() in api-adapters.ts. Returns null if no asset
 * matches the given assessment id.
 */
export async function getAssessmentDetail(
  assessmentId: string
): Promise<ApiResult<AssessmentDetailViewModel> | null> {
  const detail = buildAssessmentDetail(assessmentId);
  if (!detail) return mockDelay(null);
  return mockDelay({ data: detail });
}

export async function createAssessment(input: CreateAssessmentInput): Promise<ApiResult<Assessment>> {
  // Mock-only: no workflow engine is connected; synthesizes a Draft assessment.
  const now = new Date().toISOString();
  const assessment: Assessment = {
    id: `asm-mock-${Date.now()}`,
    workspaceId: MOCK_WORKSPACE_ID,
    assetId: input.assetId,
    assetVersionId: input.assetVersionId ?? `${input.assetId}-v1`,
    status: 'Draft',
    requestedByUserId: input.requestedByUserId ?? MOCK_OWNER_USER_ID,
    assignedReviewerUserId: null,
    submittedAt: null,
    decidedAt: null,
    scoreId: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  return mockDelay({ data: assessment });
}

export async function submitAssessment(assessmentId: string): Promise<ApiResult<Assessment>> {
  const existing = await getAssessmentById(assessmentId);
  const now = new Date().toISOString();
  const base = existing?.data ?? (await createAssessment({ assetId: assessmentIdToAssetId(assessmentId) })).data;
  const updated: Assessment = { ...base, status: 'Under Review', submittedAt: now, updatedAt: now };
  return mockDelay({ data: updated });
}

export async function updateAssessmentStep(
  assessmentId: string,
  stepId: string,
  input: UpdateAssessmentStepInput
): Promise<ApiResult<AssessmentStep>> {
  const now = new Date().toISOString();
  const step: AssessmentStep = {
    id: stepId,
    assessmentId,
    sequence: 1,
    name: 'Mock Step',
    status: input.status,
    assignedUserId: MOCK_OWNER_USER_ID,
    completedAt: input.status === 'Completed' ? now : null,
    notes: input.notes,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  return mockDelay({ data: step });
}

export async function recordAssessmentDecision(
  assessmentId: string,
  input: AssessmentDecisionInput
): Promise<ApiResult<Assessment>> {
  const existing = await getAssessmentById(assessmentId);
  const now = new Date().toISOString();
  const base = existing?.data ?? (await createAssessment({ assetId: assessmentIdToAssetId(assessmentId) })).data;
  const updated: Assessment = {
    ...base,
    status: input.status,
    decidedAt: now,
    decisionNotes: input.decisionNotes,
    updatedAt: now,
  };
  return mockDelay({ data: updated });
}

// ------------------------------------------------------------
// Evidence
// ------------------------------------------------------------

export async function getEvidenceItems(assessmentId: string): Promise<PaginatedResult<EvidenceItem>> {
  const items = buildEvidenceItems(assessmentId);
  return mockDelay({ items, nextCursor: null, totalCount: items.length });
}

export async function addEvidenceItem(assessmentId: string, input: AddEvidenceInput): Promise<ApiResult<EvidenceItem>> {
  const now = new Date().toISOString();
  const item: EvidenceItem = {
    id: `evi-mock-${Date.now()}`,
    assessmentId,
    type: input.type,
    title: input.title,
    note: input.note,
    fileUrl: input.fileUrl,
    externalUrl: input.externalUrl,
    uploadedByUserId: MOCK_OWNER_USER_ID,
    relatedDimension: input.relatedDimension,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  return mockDelay({ data: item });
}

export async function updateEvidenceItem(evidenceId: string, input: UpdateEvidenceInput): Promise<ApiResult<EvidenceItem>> {
  const now = new Date().toISOString();
  const item: EvidenceItem = {
    id: evidenceId,
    assessmentId: 'unknown',
    type: 'Other',
    title: input.title ?? 'Untitled Evidence',
    note: input.note,
    uploadedByUserId: MOCK_OWNER_USER_ID,
    relatedDimension: input.relatedDimension,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  return mockDelay({ data: item });
}

export async function deleteEvidenceItem(evidenceId: string): Promise<ApiResult<{ id: string; deleted: true }>> {
  return mockDelay({ data: { id: evidenceId, deleted: true } });
}

// ------------------------------------------------------------
// PBRS Score
// ------------------------------------------------------------

export async function getAssessmentScore(assessmentId: string): Promise<ApiResult<PBRSScoreRecord> | null> {
  const found = SAMPLE_ASSETS.find((a) => a.id === assessmentIdToAssetId(assessmentId));
  if (!found) return mockDelay(null);
  return mockDelay({ data: mapSampleAssetToPBRSScoreRecord(found) });
}

export async function runAssessmentScore(assessmentId: string): Promise<ApiResult<PBRSScoreRecord> | null> {
  // Mock-only: no live scoring engine is connected in this Alpha build.
  // Returns the existing sample score for the underlying asset unchanged.
  return getAssessmentScore(assessmentId);
}

export async function overrideDimensionScore(
  assessmentId: string,
  input: OverrideDimensionScoreInput
): Promise<ApiResult<PBRSDimensionScore>> {
  const now = new Date().toISOString();
  const dimensionScore: PBRSDimensionScore = {
    id: `${assessmentId}-dim-${input.dimension}-override`,
    scoreId: `${assessmentIdToAssetId(assessmentId)}-score`,
    dimension: input.dimension,
    value: input.value,
    evidenceIds: input.evidenceIds,
    isOverridden: true,
    overrideReason: input.overrideReason,
    overriddenByUserId: input.overriddenByUserId ?? MOCK_OWNER_USER_ID,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  return mockDelay({ data: dimensionScore });
}

// ------------------------------------------------------------
// Passports
// ------------------------------------------------------------

/** Returns the passport list view consumed by /passports — see buildPassportListItems() in api-adapters.ts. */
export async function getPassports(): Promise<PaginatedResult<PassportListItemViewModel>> {
  const items = buildPassportListItems();
  return mockDelay({ items, nextCursor: null, totalCount: items.length });
}

/** Same shape as getPassports(), named to match the PHX-PLATFORM-004 optional-function convention. */
export async function getPassportListItems(): Promise<PaginatedResult<PassportListItemViewModel>> {
  return getPassports();
}

export async function getPassportById(passportId: string): Promise<ApiResult<PassportListItemViewModel> | null> {
  const found = buildPassportListItems().find(
    (item) => item.passport.passportId === passportId || item.passport.id === passportId
  );
  if (!found) return mockDelay(null);
  return mockDelay({ data: found });
}

/**
 * Internal helper — synthesizes a full mock PBRSPassport record for a given
 * assessment, using the same shape/derivation the PHX-PLATFORM-003/004 mock
 * layer always has. Not exported: the public governance-action surface is
 * issuePassport() below, which returns a PhoenixActionResult rather than a
 * full entity (see action-types.ts). Kept separate so the record-shape
 * logic is not lost, in case a future sprint needs the full mock entity
 * (e.g. an optimistic UI update) rather than just a result summary.
 */
function synthesizeIssuedPassportRecord(assessmentId: string): PBRSPassport | null {
  const asset = SAMPLE_ASSETS.find((a) => a.id === assessmentIdToAssetId(assessmentId));
  if (!asset) return null;
  const now = new Date().toISOString();
  return {
    id: `psp-mock-${Date.now()}`,
    workspaceId: MOCK_WORKSPACE_ID,
    passportId: `PBRS-ACME-2026-MOCK-${asset.score.tier === 'Platinum' ? 'PT' : asset.score.tier === 'Gold' ? 'GD' : asset.score.tier === 'Silver' ? 'SV' : 'BZ'}`,
    assetId: asset.id,
    assessmentId,
    scoreId: `${asset.id}-score`,
    status: 'Issued',
    scoreSnapshot: asset.score.overall,
    gradeSnapshot: asset.simpleGrade,
    issuedAt: now,
    issuedByUserId: MOCK_OWNER_USER_ID,
    validFrom: now,
    validUntil: null,
    recordHash: `0x${asset.id.replace('ast-', '').padStart(4, '0')}…mock`,
    lastVerifiedAt: null,
    revokedAt: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
}

// ------------------------------------------------------------
// Governance actions — Passports (PHX-PLATFORM-007)
// ------------------------------------------------------------
// Mock-only workflow actions backing the Issue/Revoke Passport UI
// (GovernanceActionButton + ActionConfirmDialog). These functions do not
// persist anything and are not a security boundary — see the file-level
// note above and RoleGate.tsx / access-control.ts for the actual UI
// gating. A real backend should accept the caller's session/role as
// request context and enforce PERMISSIONS_MODEL_PHX_PLATFORM_002.md
// server-side.

/**
 * Issues a mock PBRS Passport for the given assessment/asset. Mock-only:
 * nothing is persisted, so a page refresh loses the "issued" state. Always
 * succeeds when given an assessmentId or passportId to reference, since
 * this Alpha has no real workflow engine to reject the request against.
 */
export async function issuePassport(input: PassportActionInput): Promise<PhoenixActionResult> {
  const reference = input.assessmentId ?? input.passportId;
  if (!reference) {
    return mockDelay({
      ok: false,
      message: 'Issuing a passport requires an assessment or passport reference.',
    });
  }

  const record = input.assessmentId ? synthesizeIssuedPassportRecord(input.assessmentId) : null;
  const passportLabel = record?.passportId ?? input.passportId ?? reference;
  const activityId = `act-mock-${Date.now()}`;
  const auditRecordId = `adt-mock-${Date.now()}`;

  return mockDelay({
    ok: true,
    message: `Passport ${passportLabel} issued. Alpha mock workflow action — not persisted to a real backend yet.`,
    activityId,
    auditRecordId,
  });
}

/**
 * Revokes a mock PBRS Passport. Requires a documented `reason` — this is
 * validated here (not just in the UI) so the action stays honest about
 * what it enforces even though the mock layer is not a real security
 * boundary. Mock-only: does not hard-delete the passport record; the UI
 * should keep the card visible and show it as revoked.
 */
export async function revokePassport(input: PassportActionInput): Promise<PhoenixActionResult> {
  if (!input.reason || !input.reason.trim()) {
    return mockDelay({ ok: false, message: 'Revocation requires a documented reason.' });
  }

  const reference = input.passportId ?? input.assessmentId ?? 'this passport';
  const activityId = `act-mock-${Date.now()}`;
  const auditRecordId = `adt-mock-${Date.now()}`;

  return mockDelay({
    ok: true,
    message: `Passport ${reference} marked as revoked. Alpha mock workflow action — not persisted; the record remains visible for reference.`,
    activityId,
    auditRecordId,
  });
}

export async function verifyPassport(passportId: string): Promise<ApiResult<{ passportId: string; verified: boolean; verifiedAt: string }>> {
  const now = new Date().toISOString();
  return mockDelay({ data: { passportId, verified: true, verifiedAt: now } });
}

// ------------------------------------------------------------
// Certifications
// ------------------------------------------------------------

/**
 * Returns the composed /certifications read model — levels plus
 * certified/eligible/expiring rows as CertificationListItemViewModel /
 * AssessmentListItemViewModel / PassportListItemViewModel. See
 * buildCertificationsOverview() in api-adapters.ts.
 */
export async function getCertifications(): Promise<CertificationsOverview> {
  return mockDelay(buildCertificationsOverview());
}

/** Same shape as getCertifications(), named to match the PHX-PLATFORM-004 optional-function convention. */
export async function getCertificationListItems(): Promise<CertificationListItemViewModel[]> {
  const overview = await getCertifications();
  return overview.certifiedItems;
}

export async function getCertificationById(certificationId: string): Promise<ApiResult<PBRSCertificationRecord> | null> {
  const found = buildCertificationListItems().find((item) => item.certification.id === certificationId);
  if (!found) return mockDelay(null);
  return mockDelay({ data: found.certification });
}

// ------------------------------------------------------------
// Governance actions — Certifications (PHX-PLATFORM-007)
// ------------------------------------------------------------
// Mock-only workflow actions backing the Grant/Revoke Certification UI.
// As with the Passport actions above, permission gating belongs in the UI
// (RoleGate + access-control.ts) — these functions do not enforce it and
// are not a security boundary. No PBRS Certification Level / Internal Tier
// threshold logic is duplicated or changed here; certification-levels.ts
// remains the single source of truth for level derivation.

/**
 * Grants a mock certification for the given passport. Mock-only: no real
 * external certification is issued, and Certification Level / Internal
 * Tier thresholds are unchanged (see certification-levels.ts). Requires a
 * passportId — the certification is always granted against a specific
 * issued passport, never a bare assessment.
 */
export async function grantCertification(input: CertificationActionInput): Promise<PhoenixActionResult> {
  if (!input.passportId) {
    return mockDelay({ ok: false, message: 'Granting a certification requires a passport reference.' });
  }

  const certificationId = `PBRS-ACME-2026-MOCK-${Date.now().toString().slice(-4)}`;
  const activityId = `act-mock-${Date.now()}`;
  const auditRecordId = `adt-mock-${Date.now()}`;

  return mockDelay({
    ok: true,
    message: `Certification ${certificationId} granted for passport ${input.passportId}. ${PBRS_CERTIFICATION_SAFE_DISCLAIMER} Alpha mock workflow action — not persisted.`,
    activityId,
    auditRecordId,
  });
}

/**
 * Revokes a mock certification. Requires a certificationId or passportId to
 * reference and a documented `reason` — both validated here. UI should
 * restrict this to the Owner role (see PHX_PLATFORM_006_ACCESS_CONTROL_MATRIX.md),
 * but this mock function itself does not enforce that; it is not a
 * security boundary.
 */
export async function revokeCertification(input: CertificationActionInput): Promise<PhoenixActionResult> {
  const reference = input.certificationId ?? input.passportId;
  if (!reference) {
    return mockDelay({
      ok: false,
      message: 'Certification revocation requires a certification or passport reference.',
    });
  }
  if (!input.reason || !input.reason.trim()) {
    return mockDelay({ ok: false, message: 'Certification revocation requires a documented reason.' });
  }

  const activityId = `act-mock-${Date.now()}`;
  const auditRecordId = `adt-mock-${Date.now()}`;

  return mockDelay({
    ok: true,
    message: `Certification ${reference} marked as revoked. Alpha mock workflow action — not persisted; the record remains visible for reference.`,
    activityId,
    auditRecordId,
  });
}

// ------------------------------------------------------------
// Reports
// ------------------------------------------------------------

/** Returns the report list view consumed by /reports — see buildReportListItems() in api-adapters.ts. */
export async function getReports(): Promise<ReportListItemViewModel[]> {
  return mockDelay(buildReportListItems());
}

/** Same shape as getReports(), named to match the PHX-PLATFORM-004 optional-function convention. */
export async function getReportListItems(): Promise<ReportListItemViewModel[]> {
  return getReports();
}

export async function getReportById(reportId: string): Promise<ApiResult<ReportListItemViewModel> | null> {
  const found = buildReportListItems().find((item) => item.report.id === reportId);
  if (!found) return mockDelay(null);
  return mockDelay({ data: found });
}

export async function requestReport(input: RequestReportInput): Promise<ApiResult<Report>> {
  const now = new Date().toISOString();
  const report: Report = {
    id: `rpt-mock-${Date.now()}`,
    workspaceId: MOCK_WORKSPACE_ID,
    templateId: input.templateId,
    name: 'Requested Report',
    status: 'Requested',
    assetId: input.assetId,
    requestedByUserId: MOCK_OWNER_USER_ID,
    requestedAt: now,
    generatedAt: null,
    fileUrl: null,
    format: input.format ?? 'pdf',
    expiresAt: null,
    // PHX-REPORTS-004: a freshly mock-requested report starts at version 1.
    version: 1,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  return mockDelay({ data: report });
}

export async function generateReport(reportId: string): Promise<ApiResult<Report>> {
  const found = SAMPLE_REPORTS.find((r) => r.id === reportId);
  const now = new Date().toISOString();
  const base = found ? mapSampleReportToReport(found) : (await requestReport({ templateId: `${reportId}-template` })).data;
  const updated: Report = { ...base, status: 'Available', generatedAt: now, fileUrl: `/mock-reports/${reportId}.pdf`, updatedAt: now };
  return mockDelay({ data: updated });
}

// ------------------------------------------------------------
// Activity / Audit
// ------------------------------------------------------------

/** Workspace activity feed, newest first. Backed by mock-fixtures/activity.ts via buildActivityLogs(). */
export async function getActivityLog(limit: number = 25): Promise<PaginatedResult<ActivityLog>> {
  const items = buildActivityLogs(limit);
  return mockDelay({ items, nextCursor: null, totalCount: items.length });
}

/** Immutable audit trail, newest first. Backed by mock-fixtures/audit.ts via buildAuditRecords(). */
export async function getAuditRecords(limit: number = 25): Promise<PaginatedResult<AuditRecord>> {
  const items = buildAuditRecords(limit);
  return mockDelay({ items, nextCursor: null, totalCount: items.length });
}

/** Activity entries directly referencing one entity id (Asset/Assessment/Passport/Certification/Report), newest first. */
export async function getActivityForEntity(entityId: string, limit: number = 25): Promise<ActivityLog[]> {
  return mockDelay(adaptersGetActivityForEntity(entityId, limit));
}

/** Audit records directly referencing one entity id, newest first. */
export async function getAuditRecordsForEntity(entityId: string, limit: number = 25): Promise<AuditRecord[]> {
  return mockDelay(adaptersGetAuditRecordsForEntity(entityId, limit));
}

// ------------------------------------------------------------
// Settings
// ------------------------------------------------------------

export async function getWorkspaceSettings(): Promise<PlatformWorkspaceSettingsView> {
  return mockDelay(buildWorkspaceSettings());
}

export async function updateWorkspaceSettings(input: UpdateWorkspaceSettingsInput): Promise<ApiResult<WorkspaceSettings>> {
  const current = buildWorkspaceSettings().settings;
  const updated: WorkspaceSettings = {
    ...current,
    ...(input.settings ?? {}),
  };
  return mockDelay({ data: updated });
}
