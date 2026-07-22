// ============================================================
// @phoenix/core/contracts — Assessment, AssessmentStep
// PHX-PLATFORM-002 — Backend Contract Definition
// ============================================================

import type { BaseRecord, UUID, WorkspaceScoped } from './common';
import type { AssessmentStatus, AssessmentStepStatus } from './enums';

/**
 * Assessment
 * Purpose: A single evaluation run of one AssetVersion against the PBRS
 * six-dimension model. An Asset may have many Assessments over its lifetime
 * (e.g. re-assessment after edits); the most recent Approved assessment
 * determines the Asset's current score and eligibility for a Passport.
 * Lifecycle: see DATA_LIFECYCLE_PHX_PLATFORM_002.md § Assessment Lifecycle.
 */
export interface Assessment extends BaseRecord, WorkspaceScoped {
  assetId: UUID;
  assetVersionId: UUID;
  status: AssessmentStatus;
  /** User who initiated the assessment (usually the asset owner or a contributor). */
  requestedByUserId: UUID;
  /** Reviewer assigned to make the final decision. Null until assigned. */
  assignedReviewerUserId: UUID | null;
  /** Set when status first reaches 'Under Review'. */
  submittedAt: string | null;
  /** Set when a reviewer records Approved / Needs Improvement / Rejected. */
  decidedAt: string | null;
  /** Free-text reviewer rationale recorded at decision time. */
  decisionNotes?: string;
  /** Pointer to the resulting PBRSScore once scoring has run. Null until 'Scoring Pending' completes. */
  scoreId: UUID | null;
}

/**
 * AssessmentStep
 * Purpose: A discrete checklist step within an assessment's workflow
 * (e.g. "Collect Evidence", "Run Automated Scoring", "Reviewer Sign-off").
 * Steps give the UI a granular progress view beyond the coarse Assessment.status.
 */
export interface AssessmentStep extends BaseRecord {
  assessmentId: UUID;
  /** Display order, ascending, starting at 1. */
  sequence: number;
  name: string;
  status: AssessmentStepStatus;
  /** User responsible for completing this step, if assigned. */
  assignedUserId: UUID | null;
  completedAt: string | null;
  /** Free-text notes captured on completion or skip. */
  notes?: string;
}
