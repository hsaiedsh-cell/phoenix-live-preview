// ============================================================
// Phoenix Platform — Access Control
// PHX-PLATFORM-006 — Authentication & Workspace Access Foundation
// ------------------------------------------------------------
// Pure, reusable permission logic derived directly from
// docs/platform/PERMISSIONS_MODEL_PHX_PLATFORM_002.md. This module
// has no dependency on mock-session.ts, React, or Next.js — it is
// a plain function of `PhoenixUserRole -> boolean` so it can be
// reused unchanged once a real authorization layer exists.
//
// This is UI-gating logic only. It hides or disables affordances
// that the mock API layer does not actually enforce yet — see the
// note in api-client.ts. It is not a security boundary.
// ============================================================

import type { PhoenixUserRole } from './auth-types';

export type PhoenixPermission =
  | 'canViewDashboard'
  | 'canViewAssessments'
  | 'canCreateAssessment'
  | 'canEditEvidence'
  | 'canRunScoring'
  | 'canOverrideDimensionScore'
  | 'canApproveAssessment'
  | 'canIssuePassport'
  | 'canRevokePassport'
  | 'canGrantCertification'
  | 'canRevokeCertification'
  | 'canViewReports'
  | 'canExportReports'
  | 'canViewSettings'
  | 'canManageWorkspace'
  | 'canViewAuditTrail'
  | 'canViewActivityLog';

const ALL_ROLES: PhoenixUserRole[] = ['Owner', 'Admin', 'Reviewer', 'Contributor', 'Viewer', 'Auditor'];

/**
 * Permission -> allowed roles. Mirrors the PHX-PLATFORM-002 permission
 * matrix table-for-table. Where the matrix names an action "own only"
 * (e.g. Contributor editing their own evidence), that nuance is not
 * modeled here — this Alpha layer gates by role only, not by resource
 * ownership, since there is no real backend/session to determine
 * ownership against. See PHX_PLATFORM_006_ACCESS_CONTROL_MATRIX.md for
 * the documented deviation.
 */
const PERMISSION_ROLES: Record<PhoenixPermission, PhoenixUserRole[]> = {
  // Assets/Assessments — Read
  canViewDashboard: ALL_ROLES,
  canViewAssessments: ALL_ROLES,
  // Assessments — Create
  canCreateAssessment: ['Owner', 'Admin', 'Contributor'],
  // Evidence — Add
  canEditEvidence: ['Owner', 'Admin', 'Reviewer', 'Contributor'],
  // Scoring — Trigger automated run
  canRunScoring: ['Owner', 'Admin', 'Reviewer', 'Contributor'],
  // Scoring — Override dimension
  canOverrideDimensionScore: ['Owner', 'Admin', 'Reviewer'],
  // Assessments — Record decision
  canApproveAssessment: ['Owner', 'Admin', 'Reviewer'],
  // Passports — Issue
  canIssuePassport: ['Owner', 'Admin', 'Reviewer'],
  // Passports — Revoke
  canRevokePassport: ['Owner', 'Admin'],
  // Certifications — Grant
  canGrantCertification: ['Owner', 'Admin'],
  // Certifications — Revoke (Owner only, per PHX-PLATFORM-002 note on
  // irreversible/legal-weight actions)
  canRevokeCertification: ['Owner'],
  // Reports — Read / Download
  canViewReports: ALL_ROLES,
  canExportReports: ALL_ROLES,
  // Settings — Read workspace settings
  canViewSettings: ALL_ROLES,
  // Settings — Update workspace settings / manage integrations
  canManageWorkspace: ['Owner', 'Admin'],
  // Audit Logs — Read audit_records (compliance trail)
  canViewAuditTrail: ['Owner', 'Admin', 'Auditor'],
  // Audit Logs — Read activity_logs (feed)
  canViewActivityLog: ALL_ROLES,
};

const RESTRICTED_MESSAGES: Record<PhoenixPermission, string> = {
  canViewDashboard: 'Your role does not have access to the dashboard.',
  canViewAssessments: 'Your role does not have access to assessments.',
  canCreateAssessment: 'Your role can view assessments but cannot create new ones.',
  canEditEvidence: 'Your role cannot add or edit evidence.',
  canRunScoring: 'Your role cannot trigger a scoring run.',
  canOverrideDimensionScore: 'Your role cannot override a dimension score.',
  canApproveAssessment: 'Your role cannot record an assessment decision.',
  canIssuePassport: 'Your role cannot issue a PBRS Passport.',
  canRevokePassport: 'Your role cannot revoke a PBRS Passport.',
  canGrantCertification: 'Your role cannot grant a certification.',
  canRevokeCertification: 'Certification revocation is restricted to the workspace Owner.',
  canViewReports: 'Your role does not have access to reports.',
  canExportReports: 'Your role cannot export reports.',
  canViewSettings: 'Your role does not have access to workspace settings.',
  canManageWorkspace: 'Your role cannot manage workspace settings.',
  canViewAuditTrail: 'Full audit trail access is restricted to Owner, Admin, and Auditor roles.',
  canViewActivityLog: 'Your role does not have access to the activity feed.',
};

/** Returns whether `role` is permitted to perform `permission`. */
export function hasPermission(role: PhoenixUserRole, permission: PhoenixPermission): boolean {
  return PERMISSION_ROLES[permission].includes(role);
}

/** Returns the human-readable reason a permission is restricted, for muted/disabled-state copy. */
export function getRestrictedMessage(permission: PhoenixPermission): string {
  return RESTRICTED_MESSAGES[permission];
}

/** Returns the full capability map for a role — useful for the session hook / role-aware UI. */
export function getRoleCapabilities(role: PhoenixUserRole): Record<PhoenixPermission, boolean> {
  const capabilities = {} as Record<PhoenixPermission, boolean>;
  (Object.keys(PERMISSION_ROLES) as PhoenixPermission[]).forEach((permission) => {
    capabilities[permission] = hasPermission(role, permission);
  });
  return capabilities;
}

// ------------------------------------------------------------
// Named per-permission helpers (Task 3 signatures)
// ------------------------------------------------------------

export const canViewDashboard = (role: PhoenixUserRole) => hasPermission(role, 'canViewDashboard');
export const canViewAssessments = (role: PhoenixUserRole) => hasPermission(role, 'canViewAssessments');
export const canCreateAssessment = (role: PhoenixUserRole) => hasPermission(role, 'canCreateAssessment');
export const canEditEvidence = (role: PhoenixUserRole) => hasPermission(role, 'canEditEvidence');
export const canRunScoring = (role: PhoenixUserRole) => hasPermission(role, 'canRunScoring');
export const canOverrideDimensionScore = (role: PhoenixUserRole) =>
  hasPermission(role, 'canOverrideDimensionScore');
export const canApproveAssessment = (role: PhoenixUserRole) => hasPermission(role, 'canApproveAssessment');
export const canIssuePassport = (role: PhoenixUserRole) => hasPermission(role, 'canIssuePassport');
export const canRevokePassport = (role: PhoenixUserRole) => hasPermission(role, 'canRevokePassport');
export const canGrantCertification = (role: PhoenixUserRole) => hasPermission(role, 'canGrantCertification');
export const canRevokeCertification = (role: PhoenixUserRole) => hasPermission(role, 'canRevokeCertification');
export const canViewReports = (role: PhoenixUserRole) => hasPermission(role, 'canViewReports');
export const canExportReports = (role: PhoenixUserRole) => hasPermission(role, 'canExportReports');
export const canViewSettings = (role: PhoenixUserRole) => hasPermission(role, 'canViewSettings');
export const canManageWorkspace = (role: PhoenixUserRole) => hasPermission(role, 'canManageWorkspace');
export const canViewAuditTrail = (role: PhoenixUserRole) => hasPermission(role, 'canViewAuditTrail');
export const canViewActivityLog = (role: PhoenixUserRole) => hasPermission(role, 'canViewActivityLog');
