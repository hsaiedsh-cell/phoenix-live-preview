// ============================================================
// @phoenix/core/contracts — Workspace, Organization, Department
// PHX-PLATFORM-002 — Backend Contract Definition
// ============================================================

import type { BaseRecord, UUID } from './common';
import type { WorkspaceRole } from './enums';

/**
 * Organization
 * Purpose: The top-level billing/legal entity that owns one or more workspaces
 * (e.g. an enterprise customer such as "Acme Corp").
 */
export interface Organization extends BaseRecord {
  name: string;
  /** Short slug used in certification IDs, e.g. "ACME". Uppercase, alphanumeric, 2-12 chars. */
  orgCode: string;
  /** Primary contact for account/compliance matters. Optional at creation. */
  primaryContactEmail?: string;
  /** Industry classification, free text — used for benchmarking context. */
  industry?: string;
}

/**
 * Department
 * Purpose: A sub-division within an organization used to attribute assets and
 * assessments to a business function (e.g. "Human Resources", "Legal").
 * Aligns with PHOENIX_SOLUTIONS target enterprise functions but is a free-form
 * field customers can extend.
 */
export interface Department extends BaseRecord {
  organizationId: UUID;
  name: string;
  /** Optional free-text description of the department's mandate. */
  description?: string;
}

/**
 * Workspace
 * Purpose: The primary tenancy boundary. All assets, assessments, passports,
 * certifications, and reports are scoped to exactly one workspace. A single
 * Organization may have multiple workspaces (e.g. per business unit or region).
 */
export interface Workspace extends BaseRecord {
  organizationId: UUID;
  name: string;
  /** URL-safe unique slug, e.g. "acme-enterprise". */
  slug: string;
  /** Workspace-level settings. Kept intentionally small and additive. */
  settings: WorkspaceSettings;
}

export interface WorkspaceSettings {
  /** Default certification tier thresholds can be overridden per workspace; null means use platform default (see PBRS_SCORING_CONTRACT). */
  scoreThresholdOverride: {
    aMin: number;
    bMin: number;
    cMin: number;
  } | null;
  /** Whether newly Business Ready assets require a manual passport issuance step, or issue automatically. */
  autoIssuePassports: boolean;
  /** IANA timezone used for report scheduling and date displays. */
  timezone: string;
}

/**
 * WorkspaceMembership
 * Purpose: Join entity between User and Workspace, carrying the role that
 * governs permissions within that workspace. A user may belong to multiple
 * workspaces with different roles in each.
 * Lifecycle: Active -> Suspended -> Removed (soft delete via BaseRecord.deletedAt).
 */
export interface WorkspaceMembership extends BaseRecord {
  workspaceId: UUID;
  userId: UUID;
  role: WorkspaceRole;
  status: 'Active' | 'Suspended' | 'Invited';
  invitedByUserId: UUID | null;
}
