// ============================================================
// Phoenix Backend — Permission Matrix
// PHX-BACKEND-006 — Auth Session Foundation & Permission Boundary
// ------------------------------------------------------------
// hasPermission(role, permission) — a pure, synchronous lookup. No
// database, no request/response objects, no side effects. Route-level
// enforcement lives in src/auth/request-actor.ts's requirePermission(),
// which calls this after resolving a RequestActor.
//
// This matrix is aligned with (not copied verbatim from, since the
// permission names differ slightly) two existing platform documents:
//   - docs/platform/PERMISSIONS_MODEL_PHX_PLATFORM_002.md (source of
//     truth for the six-role model and its R/U/D-by-role table)
//   - docs/platform/PHX_PLATFORM_006_ACCESS_CONTROL_MATRIX.md (the
//     frontend Alpha's role-only, no-"own"-nuance access-control layer)
//
// Backend-specific decisions, documented here rather than silently
// inferred:
//
// 1. assessment.submit is Owner/Admin/Contributor only, NOT Reviewer.
//    PHX_PLATFORM_002's Assessments matrix lists "Submit — U / U / — /
//    U (own) / — / —" for Owner/Admin/Reviewer/Contributor/Viewer/
//    Auditor — Reviewer has no Submit permission there. This backend
//    does not yet model the "(own)" ownership nuance (no session
//    concept existed before this sprint to resolve "did Contributor X
//    create this assessment" against) — every Contributor is granted
//    assessment.submit at the role level, matching
//    PHX_PLATFORM_006_ACCESS_CONTROL_MATRIX.md's documented "role-only
//    gating, no ownership check" Alpha limitation. A future sprint
//    that adds an ownership check should tighten this, not loosen it.
//
// 2. audit.read is Owner/Admin/Auditor only, matching
//    PHX_PLATFORM_006_ACCESS_CONTROL_MATRIX.md's `canViewAuditTrail`
//    row exactly (Reviewer/Contributor/Viewer excluded).
//
// 3. passport.issue (reserved — no passport write endpoint exists in
//    this backend yet) is Owner/Admin/Reviewer, matching
//    `canIssuePassport` in the same matrix.
//
// 4. certification.grant (reserved — no certification write endpoint
//    exists in this backend yet) is Owner/Admin only, matching
//    `canGrantCertification`.
//
// 5. Viewer and Auditor never receive any of the four write
//    permissions (assessment.create, assessment.submit,
//    evidence.create/update/delete) — this matches both source
//    documents without exception.
//
// No PBRS scoring permission is defined or implied here — scoring
// remains fully out of scope for this backend (see routes/
// assessments.ts's still-stubbed score/run and score/override
// routes).
// ============================================================

import type { Permission, WorkspaceRole } from './auth-types';

const ALL_PERMISSIONS: readonly Permission[] = [
  'workspace.read',
  'assessment.read',
  'assessment.create',
  'assessment.submit',
  'evidence.read',
  'evidence.create',
  'evidence.update',
  'evidence.delete',
  'audit.read',
  'passport.issue',
  'certification.grant',
  'reports.generate',
];

const PERMISSION_MATRIX: Record<WorkspaceRole, readonly Permission[]> = {
  // Owner: unrestricted — every permission in the current surface.
  Owner: ALL_PERMISSIONS,

  // Admin: unrestricted for everything currently defined. (The
  // platform's Certifications — Revoke row is Owner-only, but no
  // `certification.revoke` permission exists in this backend's
  // Permission union yet — there is no certification write endpoint
  // at all. When one is added, `certification.revoke` should be
  // introduced as Owner-only, matching PHX_PLATFORM_006_ACCESS_
  // CONTROL_MATRIX.md's `canRevokeCertification` row. Admin is not
  // restricted from anything in today's surface.)
  Admin: ALL_PERMISSIONS,

  // Reviewer: full read access, full evidence read/write (matches
  // `canEditEvidence` = Owner/Admin/Reviewer/Contributor), and the
  // reserved passport.issue permission (matches `canIssuePassport`).
  // Explicitly NOT assessment.create (canCreateAssessment excludes
  // Reviewer) and NOT assessment.submit (see note 1 above). NOT
  // audit.read (canViewAuditTrail excludes Reviewer). NOT
  // certification.grant.
  //
  // PHX-REPORTS-003: reports.generate added, matching the Reports —
  // "Request" row (C for Owner/Admin/Reviewer/Contributor, — for
  // Viewer/Auditor) in
  // docs/platform/PERMISSIONS_MODEL_PHX_PLATFORM_002.md's Reports
  // table.
  Reviewer: [
    'workspace.read',
    'assessment.read',
    'evidence.read',
    'evidence.create',
    'evidence.update',
    'evidence.delete',
    'passport.issue',
    'reports.generate',
  ],

  // Contributor: can create and submit assessments, full evidence
  // read/write. No audit.read, no passport.issue, no
  // certification.grant. PHX-REPORTS-003: reports.generate added —
  // same Reports — "Request" row rationale as Reviewer above.
  Contributor: [
    'workspace.read',
    'assessment.read',
    'assessment.create',
    'assessment.submit',
    'evidence.read',
    'evidence.create',
    'evidence.update',
    'evidence.delete',
    'reports.generate',
  ],

  // Viewer: read-only across the board. No audit.read (Viewer is not
  // listed in canViewAuditTrail). PHX-REPORTS-003: no reports.generate
  // either — the Reports table's "Request" row has "—" for Viewer.
  Viewer: ['workspace.read', 'assessment.read', 'evidence.read'],

  // Auditor: read-only, plus the audit trail specifically.
  // PHX-REPORTS-003: no reports.generate — the Reports table's
  // "Request" row has "—" for Auditor too.
  Auditor: ['workspace.read', 'assessment.read', 'evidence.read', 'audit.read'],
};

/**
 * True if `role` carries `permission` under this dev-auth permission
 * boundary. Pure function — no database, no I/O, safe to call
 * repeatedly per request.
 */
export function hasPermission(role: WorkspaceRole, permission: Permission): boolean {
  return PERMISSION_MATRIX[role].includes(permission);
}

/** Returns the full, read-only permission list for a role (for QA/introspection use). */
export function permissionsForRole(role: WorkspaceRole): readonly Permission[] {
  return PERMISSION_MATRIX[role];
}
