// ============================================================
// @phoenix/core/contracts — PBRSCertificationRecord
// PHX-PLATFORM-002 — Backend Contract Definition
// ------------------------------------------------------------
// Extends the existing @phoenix/core `PBRSCertification` value
// type (id, organization, tier, issuedDate, expiryDate, score)
// with the persisted lifecycle fields a backend needs. Does not
// redefine certification ID formatting — reuses
// `formatCertificationId` from @phoenix/core.
// ============================================================

import type { CertificationTier } from '../index';
import type { BaseRecord, UUID, WorkspaceScoped } from './common';
import type { CertificationStatus } from './enums';

/**
 * PBRSCertificationRecord
 * Purpose: The formal certification granted to a passport once its score
 * clears the tier threshold for the requested certification level. A
 * Certification is always issued against exactly one PBRSPassport and
 * inherits its immutable score snapshot.
 * Lifecycle: see DATA_LIFECYCLE_PHX_PLATFORM_002.md § Certification Lifecycle.
 */
export interface PBRSCertificationRecord extends BaseRecord, WorkspaceScoped {
  /** Certification ID, format PBRS-[ORG]-[YEAR]-[SEQ]-[LEVEL] — see formatCertificationId(). */
  certificationId: string;
  passportId: UUID;
  organizationId: UUID;
  tier: CertificationTier;
  status: CertificationStatus;
  scoreSnapshot: number;
  issuedDate: string | null;
  expiryDate: string | null;
  grantedByUserId: UUID | null;
  revokedAt: string | null;
  revokedByUserId?: UUID;
  revokedReason?: string;
}
