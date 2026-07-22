// ============================================================
// Phoenix Platform — Audit Record Fixtures
// PHX-PLATFORM-004 — Entity View & Audit Fixtures
// ------------------------------------------------------------
// Representative mock AuditRecord entries — the immutable,
// compliance-grade change log. Conceptually append-only: this
// module exposes no update/delete helpers, only reads.
// ============================================================

import type { AuditRecord } from '@phoenix/core';
import { MOCK_WORKSPACE_ID, ownerUserIdForName } from '../mock-ids';

function iso(dateOnly: string, time = '09:00:00'): string {
  return `${dateOnly}T${time}Z`;
}

export const AUDIT_RECORDS: AuditRecord[] = [
  {
    id: 'adt-001',
    workspaceId: MOCK_WORKSPACE_ID,
    createdAt: iso('2026-06-20', '09:00:00'),
    actorUserId: ownerUserIdForName('M. Khoury'),
    action: 'asset.status_changed',
    entityType: 'Asset',
    entityId: 'ast-002',
    changes: { status: ['Draft', 'Submitted'] },
    context: 'HR Policy Summary submitted for initial assessment.',
  },
  {
    id: 'adt-002',
    workspaceId: MOCK_WORKSPACE_ID,
    createdAt: iso('2026-06-29', '15:10:00'),
    actorUserId: null,
    action: 'assessment.status_changed.system',
    entityType: 'Assessment',
    entityId: 'ast-003-assessment',
    changes: { status: ['Scoring Pending', 'Under Review'] },
    context: 'Automated scoring completed; routed to reviewer.',
  },
  {
    id: 'adt-003',
    workspaceId: MOCK_WORKSPACE_ID,
    createdAt: iso('2026-06-30', '16:45:00'),
    actorUserId: ownerUserIdForName('R. Haddad'),
    action: 'pbrs_score.dimension_overridden',
    entityType: 'PBRSScoreRecord',
    entityId: 'ast-004-score',
    changes: { 'dimensions.compliance': [68, 62] },
    context: 'Reviewer override after finding unsubstantiated sustainability claims.',
  },
  {
    id: 'adt-004',
    workspaceId: MOCK_WORKSPACE_ID,
    createdAt: iso('2026-06-28', '09:45:00'),
    actorUserId: ownerUserIdForName('S. Al-Farsi'),
    action: 'assessment.decided',
    entityType: 'Assessment',
    entityId: 'ast-001-assessment',
    changes: { status: ['Decision Pending', 'Approved'] },
    context: 'Approved following reviewer sign-off; no outstanding issues.',
  },
  {
    id: 'adt-005',
    workspaceId: MOCK_WORKSPACE_ID,
    createdAt: iso('2026-06-28', '10:00:00'),
    actorUserId: ownerUserIdForName('Hossam M.'),
    action: 'passport.issued',
    entityType: 'PBRSPassport',
    entityId: 'psp-001',
    changes: { status: ['Not Issued', 'Issued'] },
    context: 'Passport issued immediately following assessment approval.',
  },
  {
    id: 'adt-006',
    workspaceId: MOCK_WORKSPACE_ID,
    createdAt: iso('2026-06-28', '10:05:00'),
    actorUserId: ownerUserIdForName('Hossam M.'),
    action: 'certification.granted',
    entityType: 'PBRSCertificationRecord',
    entityId: 'ast-001-certification',
    changes: { status: ['Eligible', 'Certified'] },
    context: 'Granted PBRS Enterprise certification — score exceeded the Enterprise tier threshold.',
  },
  {
    // PHX-PLATFORM-007 — illustrative historical example, pairing with the
    // 'certification.revoked' example above and act-011 in activity.ts.
    id: 'adt-011',
    workspaceId: MOCK_WORKSPACE_ID,
    createdAt: iso('2025-11-12', '11:55:00'),
    actorUserId: ownerUserIdForName('Hossam M.'),
    action: 'passport.revoked',
    entityType: 'PBRSPassport',
    entityId: 'psp-illustrative-prior-passport',
    changes: { status: ['Issued', 'Revoked'] },
    context: 'Illustrative historical example — passport revoked after the source asset was materially edited post-issuance.',
  },
  {
    id: 'adt-007',
    workspaceId: MOCK_WORKSPACE_ID,
    createdAt: iso('2025-11-12', '12:00:00'),
    actorUserId: ownerUserIdForName('Hossam M.'),
    action: 'certification.revoked',
    entityType: 'PBRSCertificationRecord',
    entityId: 'ast-illustrative-prior-certification',
    changes: { status: ['Certified', 'Revoked'] },
    context: 'Illustrative historical example — certification revoked after source asset was materially edited post-issuance.',
  },
  {
    id: 'adt-008',
    workspaceId: MOCK_WORKSPACE_ID,
    createdAt: iso('2026-06-01', '09:00:00'),
    actorUserId: ownerUserIdForName('Hossam M.'),
    action: 'workspace.settings_updated',
    entityType: 'Workspace',
    entityId: MOCK_WORKSPACE_ID,
    changes: { 'settings.autoIssuePassports': [true, false] },
    context: 'Disabled automatic passport issuance pending manual review process rollout.',
  },
  {
    id: 'adt-009',
    workspaceId: MOCK_WORKSPACE_ID,
    createdAt: iso('2026-06-27', '13:35:00'),
    actorUserId: ownerUserIdForName('L. Nasser'),
    action: 'assessment.decided',
    entityType: 'Assessment',
    entityId: 'ast-005-assessment',
    changes: { status: ['Decision Pending', 'Approved'] },
    context: 'Approved for Business Ready status following on-brand copy validation across all channel variants.',
  },
  {
    id: 'adt-010',
    workspaceId: MOCK_WORKSPACE_ID,
    createdAt: iso('2026-07-03', '14:25:00'),
    actorUserId: null,
    action: 'assessment.status_changed.system',
    entityType: 'Assessment',
    entityId: 'ast-006-assessment',
    changes: { status: ['Draft', 'Evidence Pending'] },
    context: 'Assessment created and routed to evidence collection following submission.',
  },
];

/** Returns audit records newest-first — used by api-client.ts's getAuditRecords(). */
export function getAuditRecordsPage(limit = 25): AuditRecord[] {
  return [...AUDIT_RECORDS].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, limit);
}
