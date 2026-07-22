// ============================================================
// @phoenix/core/contracts — AuditRecord
// PHX-PLATFORM-002 — Backend Contract Definition
// ============================================================

import type { UUID, WorkspaceScoped } from './common';

/**
 * AuditRecord
 * Purpose: The immutable, compliance-grade log of every state-changing
 * action in the system. Unlike ActivityLog (a readable feed), AuditRecord is
 * append-only, never edited or soft-deleted, and captures a structured
 * before/after diff suitable for external audit (ISO/IEC 27001, SOX-style
 * change control). Every lifecycle transition documented in
 * DATA_LIFECYCLE_PHX_PLATFORM_002.md must write exactly one AuditRecord.
 */
export interface AuditRecord extends WorkspaceScoped {
  id: UUID;
  /** Always set — audit records are never updated after creation. */
  createdAt: string;
  actorUserId: UUID | null;
  /** Null actorUserId + action ending in ".system" indicates an automated/system action. */
  action: string;
  entityType:
    | 'Workspace'
    | 'User'
    | 'Asset'
    | 'AssetVersion'
    | 'Assessment'
    | 'EvidenceItem'
    | 'PBRSScoreRecord'
    | 'PBRSPassport'
    | 'PBRSCertificationRecord'
    | 'Report'
    | 'Integration';
  entityId: UUID;
  /** Field-level diff. Keys are field names; values are [before, after]. Omitted fields are unchanged. */
  changes: Record<string, [unknown, unknown]>;
  /** Free-text context, e.g. IP/request metadata reference. No PII beyond what's already on the actor. */
  context?: string;
}
