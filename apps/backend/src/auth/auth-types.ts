// ============================================================
// Phoenix Backend — Development-Only Auth Types
// PHX-BACKEND-006 — Auth Session Foundation & Permission Boundary
// ------------------------------------------------------------
// Shared types for the development-only request actor / permission
// boundary introduced this sprint. This is NOT production
// authentication — there is no token, cookie, session store, or
// password anywhere in this module. An actor is resolved per-request
// from a plain `x-phoenix-user-id` header, verified against the
// database's `users`/`workspace_users` tables, and discarded once the
// request completes. See src/auth/request-actor.ts for resolution and
// docs/backend/PHX_BACKEND_006_IMPLEMENTATION_REPORT.md for the full
// design rationale and its explicit non-production-auth framing.
//
// WorkspaceRole matches the six roles already defined by the schema's
// workspace_users.role CHECK constraint (db/migrations/0001_initial_
// schema.sql) and by docs/platform/PERMISSIONS_MODEL_PHX_PLATFORM_002.md /
// PHX_PLATFORM_006_ACCESS_CONTROL_MATRIX.md — no new roles are
// introduced, none are renamed.
// ============================================================

export type WorkspaceRole = 'Owner' | 'Admin' | 'Reviewer' | 'Contributor' | 'Viewer' | 'Auditor';

export type WorkspaceMembershipStatus = 'Active' | 'Invited' | 'Suspended';

/**
 * A resolved, request-scoped actor: a real `users` row that is an
 * (Active-checked-by-caller) member of a specific workspace, with the
 * role that membership carries. Never persisted beyond the request —
 * there is no session store. `membershipStatus` is included so callers
 * can distinguish an Active actor from one whose membership exists but
 * is Suspended/Invited (both of which resolveRequestActor() still
 * returns for callers that need the distinction; requireActor()/
 * requirePermission() reject non-Active actors with 403 — see
 * request-actor.ts).
 */
export interface RequestActor {
  userId: string;
  email: string;
  name: string;
  workspaceId: string;
  role: WorkspaceRole;
  membershipStatus: WorkspaceMembershipStatus;
}

/**
 * The permission surface currently enforced (or reserved for a near-
 * future sprint) by this backend. Every permission below is either
 * enforced by a PHX-BACKEND-006 route guard today, or is an explicit,
 * documented placeholder for functionality that does not exist yet
 * (passport.issue, certification.grant — no passport/certification
 * write endpoints exist in this backend yet; the permission is defined
 * now so permissions.ts's matrix is complete and stable once those
 * endpoints are added).
 */
export type Permission =
  | 'workspace.read'
  | 'assessment.read'
  | 'assessment.create'
  | 'assessment.submit'
  | 'evidence.read'
  | 'evidence.create'
  | 'evidence.update'
  | 'evidence.delete'
  | 'audit.read'
  | 'passport.issue'
  | 'certification.grant';
