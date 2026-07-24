// ============================================================
// @phoenix/core/contracts — Report, ReportTemplate
// PHX-PLATFORM-002 — Backend Contract Definition
// ============================================================

import type { BaseRecord, UUID, WorkspaceScoped } from './common';
import type { ReportStatus } from './enums';

/**
 * ReportTemplate
 * Purpose: A reusable report definition (e.g. "Executive Readiness Summary",
 * "PBRS Assessment Report") describing what data a generated Report of that
 * kind will include. Templates are platform-seeded initially; workspace-level
 * customization is a future phase, not part of this contract.
 */
export interface ReportTemplate extends BaseRecord {
  key: string;
  name: string;
  description: string;
  /** Scope of data the template pulls from — informs which endpoints the generation job calls. */
  scope: 'SingleAsset' | 'Workspace' | 'CertificationPortfolio';
  outputFormats: Array<'pdf' | 'html' | 'csv'>;
}

/**
 * Report
 * Purpose: A generated (or in-progress) instance of a ReportTemplate for a
 * specific workspace, optionally scoped to a single asset.
 * Lifecycle: see DATA_LIFECYCLE_PHX_PLATFORM_002.md § Report Lifecycle.
 */
export interface Report extends BaseRecord, WorkspaceScoped {
  templateId: UUID;
  /** Denormalized template name at generation time, for display even if the template later changes. */
  name: string;
  status: ReportStatus;
  /** Present when scope is SingleAsset. */
  assetId?: UUID;
  requestedByUserId: UUID;
  requestedAt: string;
  generatedAt: string | null;
  /** Pointer to the generated file once status is Available. */
  fileUrl: string | null;
  format: 'pdf' | 'html' | 'csv';
  /** Reports are retained for a limited window; after this the status moves to Expired. */
  expiresAt: string | null;
  /** Populated when status is Failed. */
  failureReason?: string;
  /**
   * Server/database-controlled generation attempt number for this report.
   * Starts at 1 (report_version's column DEFAULT — see
   * apps/backend/db/migrations/0004_report_version.sql) and increments by
   * exactly 1 on every retry (Failed -> Generating) or regenerate
   * (Expired -> Generating) transition (PHX-REPORTS-004). Never
   * client-supplied — every write path that could set this rejects a
   * client-supplied `version` field outright rather than accepting and
   * ignoring it (see apps/backend/src/validation/schemas/report.schemas.ts).
   */
  version: number;
}
