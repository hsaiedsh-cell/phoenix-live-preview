// ============================================================
// @phoenix/core/contracts — EvidenceItem
// PHX-PLATFORM-002 — Backend Contract Definition
// ============================================================

import type { BaseRecord, UUID } from './common';
import type { EvidenceType } from './enums';

/**
 * EvidenceItem
 * Purpose: A single piece of supporting material attached to an Assessment —
 * source documents, screenshots, reviewer notes, or links — used to justify
 * dimension scores and satisfy auditability requirements. Every PBRS score
 * override or manual dimension score MUST reference at least one EvidenceItem
 * (see PBRS_SCORING_CONTRACT_PHX_PLATFORM_002.md).
 */
export interface EvidenceItem extends BaseRecord {
  assessmentId: UUID;
  type: EvidenceType;
  title: string;
  /** Inline note content, for ReviewerNote-type evidence. */
  note?: string;
  /** Pointer to stored file/object, for Document/Screenshot/Dataset types. */
  fileUrl?: string;
  /** External URL, for ExternalLink type. */
  externalUrl?: string;
  uploadedByUserId: UUID;
  /** Optional linkage to the specific PBRS dimension this evidence supports. */
  relatedDimension?:
    | 'accuracy'
    | 'compliance'
    | 'brandAlignment'
    | 'structure'
    | 'consistency'
    | 'completeness';
}
