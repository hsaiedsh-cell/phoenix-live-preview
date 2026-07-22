// ============================================================
// Phoenix Platform — Activity Log Fixtures
// PHX-PLATFORM-004 — Entity View & Audit Fixtures
// ------------------------------------------------------------
// Representative mock ActivityLog entries — the human-readable
// workspace feed, distinct from the immutable AuditRecord trail
// in audit.ts. Ordered newest first.
// ============================================================

import type { ActivityLog } from '@phoenix/core';
import { MOCK_WORKSPACE_ID, ownerUserIdForName } from '../mock-ids';

function iso(dateOnly: string, time = '09:00:00'): string {
  return `${dateOnly}T${time}Z`;
}

export const ACTIVITY_LOG: ActivityLog[] = [
  {
    // PHX-PLATFORM-007 — illustrative historical example (mirrors the
    // certification.revoked audit example below), representing what the
    // activity feed would show after a mock revokePassport() action.
    id: 'act-011',
    workspaceId: MOCK_WORKSPACE_ID,
    type: 'PassportRevoked',
    actorUserId: ownerUserIdForName('Hossam M.'),
    actorDisplayName: 'Hossam M.',
    summary: 'Revoked a PBRS Passport after the source asset was materially edited post-issuance.',
    relatedEntityType: 'Passport',
    relatedEntityId: 'psp-illustrative-prior-passport',
    createdAt: iso('2025-11-12', '11:55:00'),
    updatedAt: iso('2025-11-12', '11:55:00'),
    deletedAt: null,
  },
  {
    id: 'act-010',
    workspaceId: MOCK_WORKSPACE_ID,
    type: 'ReportRequested',
    actorUserId: ownerUserIdForName('Hossam M.'),
    actorDisplayName: 'Hossam M.',
    summary: 'Requested the Executive Readiness Summary report.',
    relatedEntityType: 'Report',
    relatedEntityId: 'rpt-executive-summary',
    createdAt: iso('2026-07-05', '10:15:00'),
    updatedAt: iso('2026-07-05', '10:15:00'),
    deletedAt: null,
  },
  {
    id: 'act-009',
    workspaceId: MOCK_WORKSPACE_ID,
    type: 'AssessmentSubmitted',
    actorUserId: ownerUserIdForName('T. Rahim'),
    actorDisplayName: 'T. Rahim',
    summary: 'Submitted Legal Risk Memo for PBRS assessment.',
    relatedEntityType: 'Assessment',
    relatedEntityId: 'ast-006-assessment',
    createdAt: iso('2026-07-03', '14:20:00'),
    updatedAt: iso('2026-07-03', '14:20:00'),
    deletedAt: null,
  },
  {
    id: 'act-008',
    workspaceId: MOCK_WORKSPACE_ID,
    type: 'ScoreCalculated',
    actorUserId: null,
    actorDisplayName: 'Phoenix Scoring Engine',
    summary: 'Calculated PBRS score for Board Report Draft — 81.2, Grade B-.',
    relatedEntityType: 'Assessment',
    relatedEntityId: 'ast-003-assessment',
    createdAt: iso('2026-07-01', '11:05:00'),
    updatedAt: iso('2026-07-01', '11:05:00'),
    deletedAt: null,
  },
  {
    id: 'act-007',
    workspaceId: MOCK_WORKSPACE_ID,
    type: 'AssessmentReviewed',
    actorUserId: ownerUserIdForName('R. Haddad'),
    actorDisplayName: 'R. Haddad',
    summary: 'Reviewed Sustainability Claims Review and flagged compliance gaps.',
    relatedEntityType: 'Assessment',
    relatedEntityId: 'ast-004-assessment',
    createdAt: iso('2026-06-30', '16:40:00'),
    updatedAt: iso('2026-06-30', '16:40:00'),
    deletedAt: null,
  },
  {
    id: 'act-006',
    workspaceId: MOCK_WORKSPACE_ID,
    type: 'EvidenceAdded',
    actorUserId: ownerUserIdForName('L. Nasser'),
    actorDisplayName: 'L. Nasser',
    summary: 'Added a human validation note to Marketing Campaign Copy.',
    relatedEntityType: 'Assessment',
    relatedEntityId: 'ast-005-assessment',
    createdAt: iso('2026-06-27', '13:30:00'),
    updatedAt: iso('2026-06-27', '13:30:00'),
    deletedAt: null,
  },
  {
    id: 'act-005',
    workspaceId: MOCK_WORKSPACE_ID,
    type: 'AssessmentDecided',
    actorUserId: ownerUserIdForName('S. Al-Farsi'),
    actorDisplayName: 'S. Al-Farsi',
    summary: 'Approved Executive AI Brief following PBRS assessment.',
    relatedEntityType: 'Assessment',
    relatedEntityId: 'ast-001-assessment',
    createdAt: iso('2026-06-28', '09:45:00'),
    updatedAt: iso('2026-06-28', '09:45:00'),
    deletedAt: null,
  },
  {
    id: 'act-004',
    workspaceId: MOCK_WORKSPACE_ID,
    type: 'PassportIssued',
    actorUserId: ownerUserIdForName('Hossam M.'),
    actorDisplayName: 'Hossam M.',
    summary: 'Issued a PBRS Passport for Executive AI Brief.',
    relatedEntityType: 'Passport',
    relatedEntityId: 'psp-001',
    createdAt: iso('2026-06-28', '10:00:00'),
    updatedAt: iso('2026-06-28', '10:00:00'),
    deletedAt: null,
  },
  {
    id: 'act-003',
    workspaceId: MOCK_WORKSPACE_ID,
    type: 'CertificationGranted',
    actorUserId: ownerUserIdForName('Hossam M.'),
    actorDisplayName: 'Hossam M.',
    summary: 'Granted PBRS Enterprise certification to Executive AI Brief.',
    relatedEntityType: 'Certification',
    relatedEntityId: 'ast-001-certification',
    createdAt: iso('2026-06-28', '10:05:00'),
    updatedAt: iso('2026-06-28', '10:05:00'),
    deletedAt: null,
  },
  {
    id: 'act-002',
    workspaceId: MOCK_WORKSPACE_ID,
    type: 'ReportGenerated',
    actorUserId: null,
    actorDisplayName: 'Phoenix Reporting Engine',
    summary: 'Generated the PBRS Assessment Report for the current workspace.',
    relatedEntityType: 'Report',
    relatedEntityId: 'rpt-pbrs-assessment',
    createdAt: iso('2026-07-04', '08:30:00'),
    updatedAt: iso('2026-07-04', '08:30:00'),
    deletedAt: null,
  },
  {
    id: 'act-001',
    workspaceId: MOCK_WORKSPACE_ID,
    type: 'AssetCreated',
    actorUserId: ownerUserIdForName('M. Khoury'),
    actorDisplayName: 'M. Khoury',
    summary: 'Created HR Policy Summary as a new asset.',
    relatedEntityType: 'Asset',
    relatedEntityId: 'ast-002',
    createdAt: iso('2026-06-20', '09:00:00'),
    updatedAt: iso('2026-06-20', '09:00:00'),
    deletedAt: null,
  },
];

/** Returns activity entries newest-first — used by api-client.ts's getActivityLog(). */
export function getActivityLogPage(limit = 25): ActivityLog[] {
  return [...ACTIVITY_LOG].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, limit);
}
