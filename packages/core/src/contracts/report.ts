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
}
