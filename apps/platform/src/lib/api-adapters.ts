// ============================================================
// Phoenix Platform — Mock API Data Adapters
// PHX-PLATFORM-003 — Mock API Layer
// ------------------------------------------------------------
// Converts the existing sample-data.ts fixtures into shapes
// aligned with the PHX-PLATFORM-002 backend contract
// (@phoenix/core/contracts). This is the ONLY layer, besides
// api-client.ts, that is allowed to import sample-data.ts.
//
// Design note (read before extending):
// sample-data.ts's `PhoenixAsset` is a denormalized "list view"
// row — it already joins what the future backend will keep as
// three separate records (Asset, Assessment, PBRSScoreRecord).
// The functions below can decompose a PhoenixAsset into each of
// those contract entities (mapSampleAssetToAsset,
// mapSampleAssetToAssessment, mapSampleAssetToPBRSScoreRecord)
// for callers that need contract-faithful shapes, while
// api-client.ts's page-facing functions continue to return the
// joined view directly — exactly what a real
// `GET /dashboard-summary`-style read endpoint would return to
// avoid N+1 calls. See API_CONTRACT_ADDENDUM_PHX_PLATFORM_003.md.
// ============================================================

import type {
  Asset,
  Assessment,
  PBRSScoreRecord,
  PBRSDimensionScore,
  DerivedSignalValue,
  PBRSPassport,
  PBRSCertificationRecord,
  Report,
  ReportTemplate,
  EvidenceItem,
  ActivityLog,
  AuditRecord,
  WorkspaceSettings,
  AssetStatus as ContractAssetStatus,
  AssessmentStatus,
  CertificationTier as ContractCertificationTier,
} from '@phoenix/core';
import type { PBRSDimensionKey } from '@phoenix/core';
import { formatCertificationId } from '@phoenix/core';
import {
  SAMPLE_ASSETS,
  SAMPLE_PASSPORTS,
  SAMPLE_REPORTS,
  CERTIFICATION_LEVELS,
  CERTIFIED_ASSETS,
  ELIGIBLE_ASSETS,
  EXPIRING_SOON,
  READINESS_TREND,
  WORKSPACE_NAME,
  averageOverallScore,
  averageConfidenceIndex,
  openRiskCount,
  certifiedCount,
  averageDimensionScores,
  toSimpleGrade,
  type PhoenixAsset,
  type PhoenixPassport,
  type PhoenixReport,
  type AssetStatus,
} from './sample-data';
import {
  MOCK_WORKSPACE_ID,
  MOCK_ORGANIZATION_ID,
  MOCK_OWNER_USER_ID,
  ownerUserIdForName,
  ownerNameForUserId,
} from './mock-ids';
import { getEvidenceItemsForAssessment, getActivityLogPage, getAuditRecordsPage } from './mock-fixtures';
import type {
  AssessmentListItemViewModel,
  AssessmentDetailViewModel,
  PassportListItemViewModel,
  CertificationListItemViewModel,
  ReportListItemViewModel,
  DashboardSummaryViewModel,
  DashboardActionItemViewModel,
} from './view-models';
import {
  certificationLevelFromScore,
  certificationLevelShortLabel,
  eligibilityLabelFromScore,
  shouldDisplayInternalTier,
  type PBRSCertificationLevel,
} from './certification-levels';

// Re-export so callers that only need the certification-level helpers
// don't have to reach into certification-levels.ts directly.
export { certificationLevelFromScore, certificationLevelShortLabel };

// Re-export so callers that only need the grade-collapsing helper
// don't have to reach into sample-data.ts directly.
export { toSimpleGrade };

// Re-export shared mock identifiers so existing call sites that imported
// them from api-adapters.ts (pre-PHX-PLATFORM-004) keep working unchanged.
export { MOCK_WORKSPACE_ID, MOCK_ORGANIZATION_ID, MOCK_OWNER_USER_ID };

function asISODateTime(dateOnly: string): string {
  // Sample fixtures store dates as "YYYY-MM-DD"; contracts want ISODateTime.
  return `${dateOnly}T00:00:00Z`;
}

// --- Status label / mapping adapters ---
// Keep adapter logic isolated here rather than duplicating status
// vocabularies inside page or badge components.

/** Pass-through label helper for risk levels — a hook point for future i18n or relabeling. */
export function toPlatformRiskLabel(level: PhoenixAsset['score']['riskLevel']): string {
  return level;
}

/** Pass-through label helper for the platform's simplified asset status — a hook point for future i18n or relabeling. */
export function toPlatformStatusLabel(status: AssetStatus): string {
  return status;
}

/**
 * The platform's local AssetStatus ("Needs Improvement", etc.) is a simplified
 * blend of the contract's separate Asset.status and Assessment.status
 * vocabularies. This maps it to the nearest Asset.status value.
 */
function mapLocalStatusToContractAssetStatus(status: AssetStatus): ContractAssetStatus {
  switch (status) {
    case 'Draft':
      return 'Draft';
    case 'In Review':
      return 'In Review';
    case 'Business Ready':
      return 'Business Ready';
    case 'Certified':
      return 'Certified';
    case 'Needs Improvement':
      // The asset itself has been assessed; "needs improvement" is an
      // Assessment-level outcome (see mapLocalStatusToAssessmentStatus).
      return 'Assessed';
    default:
      return 'Draft';
  }
}

function mapLocalStatusToAssessmentStatus(status: AssetStatus): AssessmentStatus {
  switch (status) {
    case 'Draft':
      return 'Draft';
    case 'In Review':
      return 'Under Review';
    case 'Business Ready':
    case 'Certified':
      return 'Approved';
    case 'Needs Improvement':
      return 'Needs Improvement';
    default:
      return 'Draft';
  }
}

/**
 * Presentation-only status label for view models — reconstructs the
 * platform's simplified 5-value status vocabulary ("Draft", "In Review",
 * "Business Ready", "Certified", "Needs Improvement") from the two
 * separate contract fields (Asset.status, Assessment.status) so existing
 * UI badges render unchanged even though the underlying data is now
 * contract-shaped. This is a label mapping only — no PBRS scoring logic.
 */
export function toAssessmentStatusLabel(asset: Asset, assessment: Assessment): string {
  if (asset.status === 'Certified') return 'Certified';
  if (asset.status === 'Business Ready') return 'Business Ready';
  if (assessment.status === 'Needs Improvement') return 'Needs Improvement';
  if (asset.status === 'In Review') return 'In Review';
  return asset.status;
}

// --- Asset / Assessment / Score adapters ---

export function mapSampleAssetToAsset(a: PhoenixAsset): Asset {
  const timestamp = asISODateTime(a.lastAssessed);
  return {
    id: a.id,
    workspaceId: MOCK_WORKSPACE_ID,
    name: a.name,
    // Sample `type` strings are authored 1:1 against AssetType's values.
    type: a.type as Asset['type'],
    department: a.department,
    ownerUserId: ownerUserIdForName(a.owner),
    status: mapLocalStatusToContractAssetStatus(a.status),
    currentVersionId: `${a.id}-v1`,
    lastAssessedAt: timestamp,
    latestScoreSnapshot: a.score.overall,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
  };
}

export function mapSampleAssetToAssessment(a: PhoenixAsset): Assessment {
  const timestamp = asISODateTime(a.lastAssessed);
  const status = mapLocalStatusToAssessmentStatus(a.status);
  const isDecided = status === 'Approved' || status === 'Needs Improvement' || status === 'Rejected';

  return {
    id: `${a.id}-assessment`,
    workspaceId: MOCK_WORKSPACE_ID,
    assetId: a.id,
    assetVersionId: `${a.id}-v1`,
    status,
    requestedByUserId: ownerUserIdForName(a.owner),
    assignedReviewerUserId: MOCK_OWNER_USER_ID,
    submittedAt: timestamp,
    decidedAt: isDecided ? timestamp : null,
    scoreId: `${a.id}-score`,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
  };
}

export function mapSampleAssetToPBRSScoreRecord(a: PhoenixAsset): PBRSScoreRecord {
  const timestamp = asISODateTime(a.lastAssessed);
  const scoreId = `${a.id}-score`;
  const assessmentId = `${a.id}-assessment`;

  // PHX-PLATFORM-005: cross-link each dimension score to the EvidenceItem(s)
  // that support it. This only populates evidenceIds — dimension values are
  // unchanged and no scoring logic is duplicated here; the match is a plain
  // filter against the existing evidence fixtures by assessmentId + dimension.
  const evidenceForAssessment = getEvidenceItemsForAssessment(assessmentId);

  const dimensionScores: PBRSDimensionScore[] = (
    Object.keys(a.score.dimensions) as PBRSDimensionKey[]
  ).map((dimension) => ({
    id: `${scoreId}-dim-${dimension}`,
    scoreId,
    dimension,
    value: a.score.dimensions[dimension],
    evidenceIds: evidenceForAssessment
      .filter((item) => item.relatedDimension === dimension)
      .map((item) => item.id),
    isOverridden: false,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
  }));

  const derivedSignals: DerivedSignalValue[] = [
    { id: `${scoreId}-signal-risk`, scoreId, key: 'riskLevel', value: a.score.riskLevel, createdAt: timestamp, updatedAt: timestamp, deletedAt: null },
    { id: `${scoreId}-signal-confidence`, scoreId, key: 'confidenceIndex', value: a.score.confidenceIndex, createdAt: timestamp, updatedAt: timestamp, deletedAt: null },
    { id: `${scoreId}-signal-automation`, scoreId, key: 'automationReadiness', value: a.score.automationReadiness, createdAt: timestamp, updatedAt: timestamp, deletedAt: null },
  ];

  return {
    id: scoreId,
    assessmentId,
    summary: a.score,
    dimensionScores,
    derivedSignals,
    hasOverrides: false,
    scoredByUserId: null,
    scoringMethod: 'Automated',
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
  };
}

// --- Passport adapter ---

export function mapSamplePassportToPBRSPassport(p: PhoenixPassport): PBRSPassport {
  const sourceAsset = SAMPLE_ASSETS.find((a) => a.name === p.assetName);
  const issuedAt = sourceAsset ? asISODateTime(sourceAsset.lastAssessed) : null;

  return {
    id: p.id,
    workspaceId: MOCK_WORKSPACE_ID,
    passportId: p.passportId,
    assetId: sourceAsset?.id ?? p.id,
    assessmentId: sourceAsset ? `${sourceAsset.id}-assessment` : `${p.id}-assessment`,
    scoreId: sourceAsset ? `${sourceAsset.id}-score` : `${p.id}-score`,
    status: p.certificationStatus === 'Certified' ? 'Active' : 'Issued',
    scoreSnapshot: p.score,
    gradeSnapshot: p.grade,
    issuedAt,
    issuedByUserId: MOCK_OWNER_USER_ID,
    validFrom: issuedAt,
    validUntil: asISODateTime(p.validUntil),
    recordHash: p.recordHash,
    lastVerifiedAt: null,
    revokedAt: null,
    createdAt: issuedAt ?? new Date().toISOString(),
    updatedAt: issuedAt ?? new Date().toISOString(),
    deletedAt: null,
  };
}

// --- Certification adapter ---

export function mapCertifiedAssetToCertificationRecord(
  a: PhoenixAsset,
  sequence: number
): PBRSCertificationRecord {
  const timestamp = asISODateTime(a.lastAssessed);
  return {
    id: `${a.id}-certification`,
    workspaceId: MOCK_WORKSPACE_ID,
    certificationId: formatCertificationId('ACME', 2026, sequence, a.score.tier),
    // Best-effort link — sample data does not guarantee a strict 1:1
    // passport-to-certification relationship the way a real backend would.
    passportId: `${a.id}-passport`,
    organizationId: MOCK_ORGANIZATION_ID,
    tier: a.score.tier,
    status: 'Certified',
    scoreSnapshot: a.score.overall,
    issuedDate: a.lastAssessed,
    expiryDate: '2027-06-30',
    grantedByUserId: MOCK_OWNER_USER_ID,
    revokedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
  };
}

// --- Certification Level display adapter (PHX-CERT-002) ---

/**
 * PHX-CERT-002 — Composed Certification Level display fields for one
 * asset/passport/certification. Certification Level is derived from the
 * PBRS overall score (`score.summary.overall` / `scoreSnapshot`) via
 * certificationLevelFromScore() and is PRIMARY for client-facing UI.
 * Internal Tier is passed through unchanged from the existing
 * CertificationTier vocabulary (score.summary.tier /
 * PBRSCertificationRecord.tier) and is SECONDARY metadata only.
 *
 * Does not change PBRS scoring logic, generateScore(), or PBRS_DIMENSIONS —
 * purely a presentation-layer composition over already-computed values.
 */
export function buildCertificationDisplay(
  scoreOverall: number,
  internalTier: ContractCertificationTier,
  hasCertification: boolean
): {
  level: PBRSCertificationLevel;
  levelLabel: string;
  internalTier: ContractCertificationTier;
  showInternalTier: boolean;
  statusLabel: string;
} {
  const level = certificationLevelFromScore(scoreOverall);
  const levelLabel = level === 'None' ? 'Not Yet Certified' : level;
  const showInternalTier = shouldDisplayInternalTier(scoreOverall, level, internalTier, 'client');
  const statusLabel = !hasCertification
    ? 'Pending Certification'
    : level === 'None'
      ? 'Not Yet Certified'
      : `${level} Certified`;

  return { level, levelLabel, internalTier, showInternalTier, statusLabel };
}

// --- Report adapter ---

export function mapSampleReportToReport(r: PhoenixReport): Report {
  const isAvailable = r.status === 'Available';
  const now = new Date().toISOString();
  const generatedAt = isAvailable ? asISODateTime(r.generatedDate) : null;

  return {
    id: r.id,
    workspaceId: MOCK_WORKSPACE_ID,
    templateId: `${r.id}-template`,
    name: r.name,
    // 'Coming Soon' has no direct contract lifecycle state; the nearest
    // equivalent is 'Requested' (queued, not yet generated).
    status: isAvailable ? 'Available' : 'Requested',
    requestedByUserId: MOCK_OWNER_USER_ID,
    requestedAt: generatedAt ?? now,
    generatedAt,
    fileUrl: isAvailable ? `/mock-reports/${r.id}.pdf` : null,
    format: 'pdf',
    expiresAt: null,
    // PHX-REPORTS-004: mock/sample data has no real generation lifecycle,
    // so it is always presented as the first (and only) attempt.
    version: 1,
    createdAt: generatedAt ?? now,
    updatedAt: generatedAt ?? now,
    deletedAt: null,
  };
}

// --- Contract-aligned view-model builders (PHX-PLATFORM-004) ---
// Relationship composition lives here, not in pages/components.
// Each function returns UI read models derived from contract
// entities — see lib/view-models.ts for the shapes.

/** One row per Asset, joined with its most recent Assessment + PBRSScoreRecord. Powers /assessments and the dashboard. */
export function buildAssessmentListItems(): AssessmentListItemViewModel[] {
  return SAMPLE_ASSETS.map((a) => {
    const asset = mapSampleAssetToAsset(a);
    const assessment = mapSampleAssetToAssessment(a);
    const score = mapSampleAssetToPBRSScoreRecord(a);
    return {
      asset,
      assessment,
      score,
      simpleGrade: a.simpleGrade,
      ownerName: ownerNameForUserId(asset.ownerUserId),
      riskLabel: score.summary.riskLevel,
      statusLabel: toAssessmentStatusLabel(asset, assessment),
    };
  });
}

// Certification records are built once, keyed by sequence within
// CERTIFIED_ASSETS, so passport and certification list items reference
// the exact same PBRSCertificationRecord for a given certified asset.
const CERTIFICATION_RECORDS: PBRSCertificationRecord[] = CERTIFIED_ASSETS.map((a, i) =>
  mapCertifiedAssetToCertificationRecord(a, i + 1)
);

function findCertificationForAssetId(assetId: string): PBRSCertificationRecord | undefined {
  return CERTIFICATION_RECORDS.find((c) => c.id === `${assetId}-certification`);
}

/** One row per issued PBRSPassport, joined with its source Asset/Assessment/Score and (if granted) certification. Powers /passports. */
export function buildPassportListItems(): PassportListItemViewModel[] {
  return SAMPLE_PASSPORTS.flatMap((p) => {
    const sourceAsset = SAMPLE_ASSETS.find((a) => a.name === p.assetName);
    if (!sourceAsset) return [];

    const passport = mapSamplePassportToPBRSPassport(p);
    const asset = mapSampleAssetToAsset(sourceAsset);
    const assessment = mapSampleAssetToAssessment(sourceAsset);
    const score = mapSampleAssetToPBRSScoreRecord(sourceAsset);
    const certification = findCertificationForAssetId(sourceAsset.id);

    const display = buildCertificationDisplay(
      score.summary.overall,
      score.summary.tier,
      certification !== undefined
    );

    const item: PassportListItemViewModel = {
      passport,
      asset,
      assessment,
      score,
      certification,
      ownerName: ownerNameForUserId(asset.ownerUserId),
      simpleGrade: sourceAsset.simpleGrade,
      statusLabel: toAssessmentStatusLabel(asset, assessment),
      certificationLevel: display.level,
      certificationLevelLabel: display.levelLabel,
      internalTier: display.internalTier,
      showInternalTier: display.showInternalTier,
    };
    return [item];
  });
}

/** One row per PBRSCertificationRecord, joined back to its passport/asset/assessment/score. Powers the /certifications certified-assets table. */
export function buildCertificationListItems(): CertificationListItemViewModel[] {
  return CERTIFIED_ASSETS.flatMap((sourceAsset, i) => {
    const certification = CERTIFICATION_RECORDS[i];
    const sourcePassport = SAMPLE_PASSPORTS.find((p) => p.assetName === sourceAsset.name);
    if (!certification || !sourcePassport) return [];

    const asset = mapSampleAssetToAsset(sourceAsset);
    const assessment = mapSampleAssetToAssessment(sourceAsset);
    const score = mapSampleAssetToPBRSScoreRecord(sourceAsset);
    const passport = mapSamplePassportToPBRSPassport(sourcePassport);

    // Certified rows always have a granted certification by construction
    // (this function iterates CERTIFIED_ASSETS), so hasCertification is true.
    const display = buildCertificationDisplay(score.summary.overall, score.summary.tier, true);

    const item: CertificationListItemViewModel = {
      certification,
      passport,
      asset,
      assessment,
      score,
      ownerName: ownerNameForUserId(asset.ownerUserId),
      simpleGrade: sourceAsset.simpleGrade,
      riskLabel: score.summary.riskLevel,
      statusLabel: toAssessmentStatusLabel(asset, assessment),
      certificationLevel: display.level,
      certificationLevelLabel: display.levelLabel,
      internalTier: display.internalTier,
      showInternalTier: display.showInternalTier,
    };
    return [item];
  });
}

/** Assessed-but-not-yet-certified assets that clear the eligibility threshold. Shares AssessmentListItemViewModel so it can reuse AssessmentTable/AssessmentCard. */
export function buildEligibleAssessmentListItems(): AssessmentListItemViewModel[] {
  const eligibleIds = new Set(ELIGIBLE_ASSETS.map((a) => a.id));
  return buildAssessmentListItems().filter((item) => eligibleIds.has(item.asset.id));
}

/** Passports expiring soon, as full PassportListItemViewModel rows. */
export function buildExpiringSoonPassportListItems(): PassportListItemViewModel[] {
  const expiringIds = new Set(EXPIRING_SOON.map((p) => p.id));
  return buildPassportListItems().filter((item) => expiringIds.has(item.passport.id));
}

export interface CertificationLevelView {
  id: string;
  name: string;
  description: string;
  minScore: number;
}

export interface CertificationsOverview {
  levels: CertificationLevelView[];
  certifiedItems: CertificationListItemViewModel[];
  eligibleItems: AssessmentListItemViewModel[];
  expiringSoon: PassportListItemViewModel[];
}

/** Composed read model for the /certifications page — levels + certified/eligible/expiring view-model rows. */
export function buildCertificationsOverview(): CertificationsOverview {
  return {
    levels: CERTIFICATION_LEVELS.map((level) => ({ ...level })),
    certifiedItems: buildCertificationListItems(),
    eligibleItems: buildEligibleAssessmentListItems(),
    expiringSoon: buildExpiringSoonPassportListItems(),
  };
}

function buildReportTemplate(r: PhoenixReport): ReportTemplate {
  const now = new Date().toISOString();
  return {
    id: `${r.id}-template`,
    key: r.id,
    name: r.name,
    description: r.description,
    scope: 'Workspace',
    outputFormats: ['pdf'],
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
}

/** One row per Report, joined with a synthesized ReportTemplate. Powers /reports. */
export function buildReportListItems(): ReportListItemViewModel[] {
  return SAMPLE_REPORTS.map((r) => {
    const report = mapSampleReportToReport(r);
    const template = buildReportTemplate(r);
    return {
      report,
      template,
      statusLabel: r.status,
      ctaLabel: 'Preview Report',
    };
  });
}

/** Evidence items for one assessment, newest first. Backs getEvidenceItems(assessmentId). */
export function buildEvidenceItems(assessmentId: string): EvidenceItem[] {
  return getEvidenceItemsForAssessment(assessmentId);
}

/** Workspace activity feed, newest first, capped at `limit`. Backs getActivityLog(). */
export function buildActivityLogs(limit = 25): ActivityLog[] {
  return getActivityLogPage(limit);
}

/** Immutable audit trail, newest first, capped at `limit`. Backs getAuditRecords(). */
export function buildAuditRecords(limit = 25): AuditRecord[] {
  return getAuditRecordsPage(limit);
}

// --- Assessment detail (PHX-PLATFORM-005) ---
// Evidence traceability + activity/audit scoping for one assessment.
// Relationship composition (which activity/audit rows "belong" to an
// assessment) lives here, not on the page — see buildAssessmentDetail().

function assessmentIdToAssetIdLocal(assessmentId: string): string {
  return assessmentId.endsWith('-assessment') ? assessmentId.slice(0, -'-assessment'.length) : assessmentId;
}

/**
 * Entity ids that should be considered "related to" a given assessment for
 * activity/audit scoping: the assessment itself, its parent Asset, its
 * PBRSScoreRecord, and (if issued/granted) its Passport and Certification.
 * ActivityLog/AuditRecord entries reference whichever of these entities was
 * directly acted upon, so a single assessment's story is spread across a few
 * different entityIds — this is the join that reassembles it.
 */
function relatedEntityIdsForAssessment(assessmentId: string): string[] {
  const assetId = assessmentIdToAssetIdLocal(assessmentId);
  const scoreId = `${assetId}-score`;
  const ids = new Set<string>([assessmentId, assetId, scoreId]);

  const sourceAsset = SAMPLE_ASSETS.find((a) => a.id === assetId);
  if (sourceAsset) {
    const passport = SAMPLE_PASSPORTS.find((p) => p.assetName === sourceAsset.name);
    if (passport) ids.add(passport.id);
    const certification = findCertificationForAssetId(assetId);
    if (certification) ids.add(certification.id);
  }
  return Array.from(ids);
}

/** Activity entries directly referencing one entity id, newest first. Backs the PHX-PLATFORM-005 activity/audit UI. */
export function getActivityForEntity(entityId: string, limit = 25): ActivityLog[] {
  return buildActivityLogs(100)
    .filter((entry) => entry.relatedEntityId === entityId)
    .slice(0, limit);
}

/** Audit records directly referencing one entity id, newest first. */
export function getAuditRecordsForEntity(entityId: string, limit = 25): AuditRecord[] {
  return buildAuditRecords(100)
    .filter((record) => record.entityId === entityId)
    .slice(0, limit);
}

function dedupeById<T extends { id: string }>(records: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const record of records) {
    if (seen.has(record.id)) continue;
    seen.add(record.id);
    result.push(record);
  }
  return result;
}

/**
 * Composed detail read model for /assessments/[assessmentId] — one Asset +
 * Assessment + PBRSScoreRecord, joined with the evidence, activity, and
 * audit records scoped to this assessment (and its related passport /
 * certification, where applicable). Returns null if no sample asset matches.
 */
export function buildAssessmentDetail(assessmentId: string): AssessmentDetailViewModel | null {
  const assetId = assessmentIdToAssetIdLocal(assessmentId);
  const sourceAsset = SAMPLE_ASSETS.find((a) => a.id === assetId);
  if (!sourceAsset) return null;

  const asset = mapSampleAssetToAsset(sourceAsset);
  const assessment = mapSampleAssetToAssessment(sourceAsset);
  const score = mapSampleAssetToPBRSScoreRecord(sourceAsset);
  const evidenceItems = getEvidenceItemsForAssessment(assessment.id);

  const relatedIds = relatedEntityIdsForAssessment(assessment.id);
  const activityItems = dedupeById(relatedIds.flatMap((id) => getActivityForEntity(id)))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, 10);
  const auditRecords = dedupeById(relatedIds.flatMap((id) => getAuditRecordsForEntity(id)))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, 10);

  return {
    asset,
    assessment,
    score,
    evidenceItems,
    ownerName: ownerNameForUserId(asset.ownerUserId),
    statusLabel: toAssessmentStatusLabel(asset, assessment),
    simpleGrade: sourceAsset.simpleGrade,
    riskLabel: score.summary.riskLevel,
    activityItems,
    auditRecords,
    // PHX-CERT-002 — Certification Level eligibility (Architecture doc §6.1,
    // UI Copy Guide §3). Derived from score.summary.overall only; does not
    // read or duplicate any dimension score, weight, or scoring logic.
    // PHX-CERT-003: the former 70–72 gap (eligibilityLabelFromScore never
    // referenced Internal Tier here to begin with) is now moot — Internal
    // Tier itself no longer contradicts Foundation eligibility for that
    // band. See PBRS_CERTIFICATION_THRESHOLD_ADDENDUM_PHX_CERT_003.md.
    eligibleCertificationLevel: certificationLevelFromScore(score.summary.overall),
    eligibleCertificationLabel: eligibilityLabelFromScore(score.summary.overall),
  };
}

// --- Dashboard summary ---

/** @deprecated Use DashboardActionItemViewModel from lib/view-models.ts. Kept as an alias for existing imports. */
export type DashboardActionItem = DashboardActionItemViewModel;

/** @deprecated Use DashboardSummaryViewModel from lib/view-models.ts. Kept as an alias for existing imports. */
export type DashboardSummary = DashboardSummaryViewModel;

export function buildDashboardSummary(): DashboardSummaryViewModel {
  const recentAssessments = [...buildAssessmentListItems()]
    .sort((a, b) => ((a.asset.lastAssessedAt ?? '') < (b.asset.lastAssessedAt ?? '') ? 1 : -1))
    .slice(0, 5);

  return {
    overallReadinessScore: averageOverallScore(),
    assetsAssessed: SAMPLE_ASSETS.length,
    certifiedAssets: certifiedCount(),
    averageConfidence: averageConfidenceIndex(),
    openRisks: openRiskCount(),
    dimensionAverages: averageDimensionScores(),
    readinessTrend: READINESS_TREND,
    recentAssessments,
    actionItems: [
      { id: 'start-assessment', label: 'Start New Assessment', href: '/assessments/new' },
      { id: 'review-passports', label: 'Review Passports', href: '/passports' },
      { id: 'generate-report', label: 'Generate Report', href: '/reports' },
    ],
  };
}

export function buildReadinessTrend(): number[] {
  return READINESS_TREND;
}

// --- Workspace settings ---

export interface NotificationPreferenceView {
  key: string;
  label: string;
  description: string;
  enabled: boolean;
}

export interface PlatformWorkspaceSettingsView {
  workspaceName: string;
  environment: string;
  primaryContact: string;
  settings: WorkspaceSettings;
  pbrsModelVersion: string;
  notificationPreferences: NotificationPreferenceView[];
  brandProfile: { voiceToneGuide: string; terminologyGlossary: string };
  dataRetention: { assessmentHistory: string; passportRecords: string };
}

export function buildWorkspaceSettings(): PlatformWorkspaceSettingsView {
  return {
    workspaceName: WORKSPACE_NAME,
    environment: 'Platform Alpha',
    primaryContact: 'Hossam M.',
    settings: {
      scoreThresholdOverride: null,
      autoIssuePassports: false,
      timezone: 'Asia/Dubai',
    },
    pbrsModelVersion: 'v1.0 — Six-dimension model',
    notificationPreferences: [
      {
        key: 'assessmentCompleted',
        label: 'Assessment completed',
        description: 'Notify when an asset finishes PBRS review.',
        enabled: true,
      },
      {
        key: 'certificationIssued',
        label: 'Certification issued',
        description: 'Notify when a passport is issued or renewed.',
        enabled: true,
      },
      {
        key: 'riskThresholdBreached',
        label: 'Risk threshold breached',
        description: "Notify when an asset's risk level increases.",
        enabled: false,
      },
    ],
    brandProfile: {
      voiceToneGuide: 'Not configured',
      terminologyGlossary: 'Not configured',
    },
    dataRetention: {
      assessmentHistory: '24 months (placeholder)',
      passportRecords: 'Indefinite (placeholder)',
    },
  };
}
