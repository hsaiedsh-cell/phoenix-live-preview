// ============================================================
// @phoenix/core/contracts — Enumerations
// PHX-PLATFORM-002 — Backend Contract Definition
// ============================================================

/** Platform-wide role. Coarse-grained; fine-grained permissions live at the workspace level. */
export type UserRole = 'SuperAdmin' | 'StandardUser' | 'ServiceAccount';

/** Role scoped to a single workspace. See PERMISSIONS_MODEL_PHX_PLATFORM_002.md for the full matrix. */
export type WorkspaceRole =
  | 'Owner'
  | 'Admin'
  | 'Reviewer'
  | 'Contributor'
  | 'Viewer'
  | 'Auditor';

export type AssetType =
  | 'Executive Briefing'
  | 'Board Report'
  | 'Policy Document'
  | 'Marketing Asset'
  | 'Legal Memo'
  | 'Compliance Review'
  | 'Other';

export type AssetStatus =
  | 'Draft'
  | 'Submitted'
  | 'In Review'
  | 'Assessed'
  | 'Business Ready'
  | 'Certified'
  | 'Expired'
  | 'Archived';

export type AssessmentStatus =
  | 'Draft'
  | 'Evidence Pending'
  | 'Scoring Pending'
  | 'Under Review'
  | 'Decision Pending'
  | 'Approved'
  | 'Needs Improvement'
  | 'Rejected'
  | 'Closed';

export type AssessmentStepStatus =
  | 'Not Started'
  | 'In Progress'
  | 'Completed'
  | 'Skipped'
  | 'Blocked';

export type RiskLevel = 'Low' | 'Medium' | 'High' | 'Critical';

/** Simplified readiness grade used in platform UI. Distinct from the granular PBRSGrade in @phoenix/core. */
export type ReadinessGrade = 'A' | 'B' | 'C' | 'Hold';

export type CertificationStatus =
  | 'Not Eligible'
  | 'Eligible'
  | 'Certified'
  | 'Expiring Soon'
  | 'Expired'
  | 'Revoked';

export type PassportStatus =
  | 'Not Issued'
  | 'Issued'
  | 'Active'
  | 'Expired'
  | 'Revoked'
  | 'Archived';

export type ReportStatus = 'Requested' | 'Generating' | 'Available' | 'Expired' | 'Failed';

export type EvidenceType =
  | 'Document'
  | 'Screenshot'
  | 'Dataset'
  | 'SourceOutput'
  | 'ReviewerNote'
  | 'ExternalLink'
  | 'Other';

export type IntegrationStatus = 'Not Connected' | 'Connected' | 'Error' | 'Disabled';

export type ActivityType =
  | 'AssetCreated'
  | 'AssetStatusChanged'
  | 'AssessmentCreated'
  | 'AssessmentSubmitted'
  | 'AssessmentReviewed'
  | 'AssessmentDecided'
  | 'EvidenceAdded'
  | 'EvidenceRemoved'
  | 'ScoreCalculated'
  | 'ScoreOverridden'
  | 'PassportIssued'
  | 'PassportVerified'
  // PHX-PLATFORM-007 — additive: passport revocation had no ActivityType
  // value before this sprint. Purely additive; no existing value changed.
  | 'PassportRevoked'
  | 'CertificationGranted'
  | 'CertificationRevoked'
  | 'ReportRequested'
  | 'ReportGenerated'
  | 'UserInvited'
  | 'UserRoleChanged'
  | 'IntegrationConnected'
  | 'IntegrationDisconnected';
