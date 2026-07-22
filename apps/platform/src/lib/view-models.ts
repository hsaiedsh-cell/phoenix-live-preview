// ============================================================
// Phoenix Platform — Contract-Aligned View Models
// PHX-PLATFORM-004 — Entity View & Audit Fixtures
// ------------------------------------------------------------
// UI read models for list/detail pages, composed from
// @phoenix/core contract entities (Asset, Assessment,
// PBRSScoreRecord, PBRSPassport, PBRSCertificationRecord,
// Report) rather than the old denormalized PhoenixAsset /
// PhoenixPassport / PhoenixReport shapes in sample-data.ts.
//
// These types describe SHAPE only. Composition happens in
// api-adapters.ts's build*ListItems() functions — components
// and pages should never assemble these relationships manually.
// No PBRS scoring logic is duplicated here; `score.summary` is
// always the exact @phoenix/core PBRSScore value produced by
// @phoenix/pbrs's generateScore().
// ============================================================

import type {
  Asset,
  Assessment,
  PBRSScoreRecord,
  PBRSPassport,
  PBRSCertificationRecord,
  Report,
  ReportTemplate,
  ReadinessGrade,
  PBRSDimensionKey,
  EvidenceItem,
  ActivityLog,
  AuditRecord,
  CertificationTier,
} from '@phoenix/core';
import type { PBRSCertificationLevel } from './certification-levels';

/** Platform's simplified 4-tier grade badge. Alias of the contract's ReadinessGrade for call-site clarity. */
export type SimpleGrade = ReadinessGrade;

/**
 * AssessmentListItemViewModel
 * Powers /assessments (list + filter) and the dashboard's recent
 * assessments panel — one row per Asset, joined with its most recent
 * Assessment and PBRSScoreRecord.
 */
export interface AssessmentListItemViewModel {
  asset: Asset;
  assessment: Assessment;
  score: PBRSScoreRecord;
  simpleGrade: SimpleGrade;
  ownerName: string;
  riskLabel: string;
  statusLabel: string;
}

/**
 * AssessmentDetailViewModel
 * Powers /assessments/[assessmentId] — the full detail view for one
 * assessment. Extends the same core relationship (Asset + Assessment +
 * PBRSScoreRecord) as AssessmentListItemViewModel with the evidence,
 * activity, and audit trail scoped to this specific assessment, so the
 * detail page never has to assemble these relationships itself.
 */
export interface AssessmentDetailViewModel {
  asset: Asset;
  assessment: Assessment;
  score: PBRSScoreRecord;
  evidenceItems: EvidenceItem[];
  ownerName: string;
  statusLabel: string;
  simpleGrade: SimpleGrade;
  riskLabel: string;
  activityItems: ActivityLog[];
  auditRecords: AuditRecord[];
  /**
   * PHX-CERT-002 — Certification Level eligibility, derived from
   * score.summary.overall via certificationLevelFromScore(). 'None' when
   * the score does not clear the Foundation threshold.
   */
  eligibleCertificationLevel?: PBRSCertificationLevel;
  /** Ready-to-render eligibility sentence, e.g. "Eligible for PBRS Foundation" or "Not eligible — remediation required". */
  eligibleCertificationLabel?: string;
}

/**
 * PassportListItemViewModel
 * Powers /passports — one row per issued PBRSPassport, joined with the
 * source Asset, Assessment, PBRSScoreRecord, and (if granted) its
 * PBRSCertificationRecord.
 */
export interface PassportListItemViewModel {
  passport: PBRSPassport;
  asset: Asset;
  assessment: Assessment;
  score: PBRSScoreRecord;
  certification?: PBRSCertificationRecord;
  ownerName: string;
  simpleGrade: SimpleGrade;
  statusLabel: string;
  /**
   * PHX-CERT-002 — Certification Level Display (Architecture doc §9).
   * `certificationLevel` / `certificationLevelLabel` are client-facing and
   * PRIMARY. `internalTier` is secondary metadata sourced from the existing
   * CertificationTier vocabulary. `showInternalTier` is computed by
   * certification-levels.ts's shouldDisplayInternalTier(); as of
   * PHX-CERT-003 the former 70–72 Certification Level / Internal Tier gap
   * is resolved (Bronze now begins at 70), so this no longer suppresses a
   * contradictory band — see
   * PBRS_CERTIFICATION_THRESHOLD_ADDENDUM_PHX_CERT_003.md.
   */
  certificationLevel: PBRSCertificationLevel;
  certificationLevelLabel: string;
  internalTier: CertificationTier;
  showInternalTier: boolean;
}

/**
 * CertificationListItemViewModel
 * Powers the /certifications page's certified-assets table — one row per
 * PBRSCertificationRecord, joined back to its passport, asset, assessment,
 * and score. Shares enough shape with AssessmentListItemViewModel
 * (asset, assessment, score, simpleGrade, riskLabel, statusLabel,
 * ownerName) that both can be rendered by AssessmentTable/AssessmentCard
 * without a separate component.
 */
export interface CertificationListItemViewModel {
  certification: PBRSCertificationRecord;
  passport: PBRSPassport;
  asset: Asset;
  assessment: Assessment;
  score: PBRSScoreRecord;
  ownerName: string;
  simpleGrade: SimpleGrade;
  riskLabel: string;
  statusLabel: string;
  /** PHX-CERT-002 — see PassportListItemViewModel for field semantics. */
  certificationLevel: PBRSCertificationLevel;
  certificationLevelLabel: string;
  internalTier: CertificationTier;
  showInternalTier: boolean;
}

/**
 * ReportListItemViewModel
 * Powers /reports — one row per Report, joined with its ReportTemplate
 * when one exists in this mock build.
 */
export interface ReportListItemViewModel {
  report: Report;
  template?: ReportTemplate;
  statusLabel: string;
  ctaLabel: string;
  /**
   * PHX-CERT-002 — Optional Certification Level fields for report surfaces
   * that show certification status. Not populated for reports with no
   * certification-status concept (e.g. the Executive Readiness Summary);
   * see api-adapters.ts buildReportListItems().
   */
  certificationLevel?: PBRSCertificationLevel;
  certificationLevelLabel?: string;
}

/**
 * DashboardActionItemViewModel
 * Re-declared here (rather than imported from api-adapters.ts) so
 * view-models.ts has no dependency on the adapters module — adapters
 * depend on view-models, not the other way around.
 */
export interface DashboardActionItemViewModel {
  id: string;
  label: string;
  href: string;
}

/**
 * DashboardSummaryViewModel
 * Extends the PHX-PLATFORM-003 DashboardSummary read-model so
 * `recentAssessments` is now an array of AssessmentListItemViewModel
 * instead of the old PhoenixAsset shape — this lets the dashboard reuse
 * the same AssessmentTable component the /assessments page uses.
 */
export interface DashboardSummaryViewModel {
  overallReadinessScore: number;
  assetsAssessed: number;
  certifiedAssets: number;
  averageConfidence: number;
  openRisks: number;
  dimensionAverages: Record<PBRSDimensionKey, number>;
  readinessTrend: number[];
  recentAssessments: AssessmentListItemViewModel[];
  actionItems: DashboardActionItemViewModel[];
}
