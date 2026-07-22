// ============================================================
// Phoenix Platform — Mock API Input Types
// PHX-PLATFORM-003 — Mock API Layer
// ------------------------------------------------------------
// Request-body shapes for api-client.ts mutation functions.
// These mirror the request bodies documented in
// API_CONTRACT_PHX_PLATFORM_002.md (and its PHX-PLATFORM-003
// addendum) so the mock layer can be swapped for real fetch
// calls later with the same input types.
//
// Type-only definitions — no validation, persistence, or
// backend logic lives here.
// ============================================================

import type {
  AssetType,
  AssetStatus,
  AssessmentStepStatus,
  AssessmentStatus,
  EvidenceType,
  PBRSDimensionKey,
  CertificationStatus,
  UUID,
} from '@phoenix/core';

// --- Assets ---

export interface CreateAssetInput {
  name: string;
  type: AssetType;
  department: string;
  content?: string;
  contentUrl?: string;
  contentType?: string;
}

export interface UpdateAssetInput {
  name?: string;
  department?: string;
  ownerUserId?: UUID;
  status?: AssetStatus;
}

// --- Assessments ---

export interface CreateAssessmentInput {
  assetId: UUID;
  assetVersionId?: UUID;
  requestedByUserId?: UUID;
}

export interface UpdateAssessmentStepInput {
  status: AssessmentStepStatus;
  notes?: string;
}

export interface AssessmentDecisionInput {
  status: Extract<AssessmentStatus, 'Approved' | 'Needs Improvement' | 'Rejected'>;
  decisionNotes?: string;
}

// --- Evidence ---

export interface AddEvidenceInput {
  type: EvidenceType;
  title: string;
  note?: string;
  fileUrl?: string;
  externalUrl?: string;
  relatedDimension?: PBRSDimensionKey;
}

export interface UpdateEvidenceInput {
  title?: string;
  note?: string;
  relatedDimension?: PBRSDimensionKey;
}

// --- PBRS Score ---

export interface OverrideDimensionScoreInput {
  dimension: PBRSDimensionKey;
  value: number;
  overrideReason: string;
  overriddenByUserId?: UUID;
  evidenceIds: UUID[];
}

// --- Certifications ---

export interface GrantCertificationInput {
  tier?: string;
  expiryDate?: string;
  grantedByUserId?: UUID;
}

export interface RevokeCertificationInput {
  reason: string;
  revokedByUserId?: UUID;
  status?: Extract<CertificationStatus, 'Revoked'>;
}

// --- Reports ---

export interface RequestReportInput {
  templateId: UUID;
  assetId?: UUID;
  format?: 'pdf' | 'html' | 'csv';
}

// --- Settings ---

export interface UpdateWorkspaceSettingsInput {
  name?: string;
  settings?: {
    scoreThresholdOverride?: { aMin: number; bMin: number; cMin: number } | null;
    autoIssuePassports?: boolean;
    timezone?: string;
  };
}
