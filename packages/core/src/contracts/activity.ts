// ============================================================
// @phoenix/core/contracts — ActivityLog, Notification, Integration
// PHX-PLATFORM-002 — Backend Contract Definition
// ============================================================

import type { BaseRecord, UUID, WorkspaceScoped } from './common';
import type { ActivityType, IntegrationStatus } from './enums';

/**
 * ActivityLog
 * Purpose: A human-readable, workspace-scoped feed entry describing a
 * notable action (e.g. "S. Al-Farsi submitted Executive AI Brief for
 * review"). Powers the dashboard activity feed. Distinct from AuditRecord,
 * which is the immutable compliance-grade record — ActivityLog is a
 * read-optimized, user-facing projection and may summarize multiple
 * AuditRecords into one line.
 */
export interface ActivityLog extends BaseRecord, WorkspaceScoped {
  type: ActivityType;
  actorUserId: UUID | null;
  /** Denormalized display name, so the feed renders even if the actor is later removed. */
  actorDisplayName: string;
  /** Human-readable summary, e.g. "Submitted Executive AI Brief for review." */
  summary: string;
  /** Optional pointers to the entity this activity concerns, for deep-linking. */
  relatedEntityType?: 'Asset' | 'Assessment' | 'Passport' | 'Certification' | 'Report' | 'User';
  relatedEntityId?: UUID;
}

/**
 * Notification
 * Purpose: A per-user, actionable alert (e.g. "Your assessment was
 * approved", "Certification expiring in 30 days"). Distinct from
 * ActivityLog, which is a shared workspace feed — Notifications are
 * individually addressed and individually dismissible/read.
 */
export interface Notification extends BaseRecord {
  workspaceId: UUID;
  recipientUserId: UUID;
  title: string;
  body: string;
  readAt: string | null;
  /** Optional deep-link target, mirrors ActivityLog's relatedEntity pattern. */
  relatedEntityType?: 'Asset' | 'Assessment' | 'Passport' | 'Certification' | 'Report';
  relatedEntityId?: UUID;
}

/**
 * Integration
 * Purpose: Connection state for an external system the workspace has linked
 * (e.g. a document source or SSO provider). This contract defines the
 * connection *record* only — no vendor SDKs, OAuth flows, or external
 * vendor names are introduced here, per task constraints.
 */
export interface Integration extends BaseRecord, WorkspaceScoped {
  /** Generic category, not a specific vendor — vendor selection is a future decision outside this contract. */
  category: 'DocumentSource' | 'IdentityProvider' | 'NotificationChannel' | 'Other';
  displayName: string;
  status: IntegrationStatus;
  connectedByUserId: UUID | null;
  connectedAt: string | null;
  lastSyncAt: string | null;
  lastErrorMessage?: string;
}
