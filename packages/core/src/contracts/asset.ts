// ============================================================
// @phoenix/core/contracts — Asset, AssetVersion
// PHX-PLATFORM-002 — Backend Contract Definition
// ============================================================

import type { BaseRecord, UUID, WorkspaceScoped } from './common';
import type { AssetStatus, AssetType } from './enums';

/**
 * Asset
 * Purpose: The central object being made "business ready" — an AI-generated
 * (or AI-assisted) deliverable such as a briefing, report, or policy document.
 * An Asset accumulates AssetVersions over time and is the parent of every
 * Assessment run against it.
 * Lifecycle: see DATA_LIFECYCLE_PHX_PLATFORM_002.md § Asset Lifecycle.
 */
export interface Asset extends BaseRecord, WorkspaceScoped {
  name: string;
  type: AssetType;
  /** Free-text department attribution; may later reference Department.id. */
  department: string;
  /** Current owning user. */
  ownerUserId: UUID;
  status: AssetStatus;
  /** Pointer to the AssetVersion currently considered authoritative. */
  currentVersionId: UUID | null;
  /** Denormalized for list views — timestamp of the most recently completed assessment. Null if never assessed. */
  lastAssessedAt: string | null;
  /** Denormalized latest overall PBRS score for list/dashboard display. Null if never scored. Source of truth is PBRSScore. */
  latestScoreSnapshot: number | null;
}

/**
 * AssetVersion
 * Purpose: An immutable snapshot of an asset's content at a point in time.
 * Assessments always reference a specific AssetVersion, not the mutable Asset,
 * so historical scores remain reproducible even after the asset is edited.
 * Required validation: content or contentUrl must be provided (not both empty).
 */
export interface AssetVersion extends BaseRecord {
  assetId: UUID;
  /** Monotonically increasing per asset, starting at 1. */
  versionNumber: number;
  /** Inline content, for text-based assets. Mutually exclusive-ish with contentUrl (at least one required). */
  content?: string;
  /** Pointer to externally stored content (e.g. object storage) for large or binary assets. */
  contentUrl?: string;
  /** MIME type of the version's content. */
  contentType: string;
  createdByUserId: UUID;
  /** Free-text note describing what changed in this version. */
  changeNote?: string;
}
