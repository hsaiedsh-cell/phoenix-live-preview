// ============================================================
// @phoenix/core/contracts — PBRSPassport
// PHX-PLATFORM-002 — Backend Contract Definition
// ============================================================

import type { BaseRecord, UUID, WorkspaceScoped } from './common';
import type { PassportStatus } from './enums';

/**
 * PBRSPassport
 * Purpose: A portable, verifiable record of an asset's readiness at the
 * moment it was issued — the artifact shared with procurement, auditors, or
 * partners as proof of business-readiness. A Passport is issued from an
 * Approved Assessment and its PBRSScoreRecord; it does not re-score, it
 * snapshots.
 * Lifecycle: see DATA_LIFECYCLE_PHX_PLATFORM_002.md § Passport Lifecycle.
 */
export interface PBRSPassport extends BaseRecord, WorkspaceScoped {
  /** Human-readable passport ID, format PBRS-[ORG]-[YEAR]-[SEQ]-[LEVEL], e.g. PBRS-ACME-2026-0001-GD. */
  passportId: string;
  assetId: UUID;
  assessmentId: UUID;
  scoreId: UUID;
  status: PassportStatus;
  /** Snapshot of overall score at issuance — immutable even if the asset is later re-assessed. */
  scoreSnapshot: number;
  /** Snapshot of simplified grade at issuance. */
  gradeSnapshot: 'A' | 'B' | 'C' | 'Hold';
  issuedAt: string | null;
  issuedByUserId: UUID | null;
  validFrom: string | null;
  validUntil: string | null;
  /** Content hash of the scored AssetVersion, for tamper-evidence. Format: "0x" + hex digest. */
  recordHash: string;
  /** Set when POST /passports/:id/verify is called — confirms recordHash still matches source content. */
  lastVerifiedAt: string | null;
  revokedAt: string | null;
  revokedReason?: string;
}
