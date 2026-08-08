// ============================================================
// Phoenix Backend — Auth Repository
// PHX-BACKEND-006 — Auth Session Foundation & Permission Boundary
// ------------------------------------------------------------
// Thin, explicit, parameterized-SQL-only READ functions against
// `users` and `workspace_users`. No ORM, no string interpolation with
// user input, no password/token/secret logic anywhere in this file —
// this module only ever answers "does this user exist" and "what is
// this user's membership/role in this workspace".
//
// `users` has no separate first/last name columns (see
// db/migrations/0001_initial_schema.sql) — only `display_name` and
// `email`. RequestActor.name is mapped from `display_name` directly;
// there is no split-name mapping to perform.
//
// Callers must have already confirmed database availability via
// middleware/database-required.ts's requireDatabase() before calling
// any function here — same convention as every other repository in
// this backend.
// ============================================================

import { getDatabasePool } from '../db/client';
import type { RequestActor, WorkspaceMembershipStatus, WorkspaceRole } from '../auth/auth-types';

// ---- getUserById ----------------------------------------------------

export type PlatformRole = 'SuperAdmin' | 'StandardUser' | 'ServiceAccount';

export interface UserRecord {
  id: string;
  email: string;
  displayName: string;
  platformRole: PlatformRole;
  deleted: boolean;
}

interface UserRow {
  id: string;
  email: string;
  display_name: string;
  platform_role: PlatformRole;
}

/**
 * Fetches a user by id. Returns null if the id does not correspond to
 * an existing, non-soft-deleted `users` row. This is the check behind
 * "unknown user id" → 401 AUTH_REQUIRED in request-actor.ts — a
 * missing user is treated as an unauthenticated request, not a 404,
 * since `x-phoenix-user-id` plays the role an auth token would play in
 * a real system.
 */
export async function getUserById(userId: string): Promise<UserRecord | null> {
  const pool = getDatabasePool();
  const result = await pool.query<UserRow>(
    `SELECT id, email, display_name, platform_role
     FROM users
     WHERE id = $1 AND deleted_at IS NULL
     LIMIT 1`,
    [userId]
  );

  const row = result.rows[0];
  return row
    ? {
        id: row.id,
        email: row.email,
        displayName: row.display_name,
        platformRole: row.platform_role,
        deleted: false,
      }
    : null;
}

// ---- getWorkspaceMembership -------------------------------------------

export interface WorkspaceMembershipRecord {
  userId: string;
  workspaceId: string;
  role: WorkspaceRole;
  status: WorkspaceMembershipStatus;
}

export interface IdentityWorkspaceRecord {
  workspaceId: string;
  organizationId: string;
  name: string;
  slug: string;
  role: WorkspaceRole;
}

export async function listActiveWorkspacesForUser(userId: string): Promise<IdentityWorkspaceRecord[]> {
  const result = await getDatabasePool().query<{
    workspace_id: string; organization_id: string; name: string; slug: string; role: string;
  }>(
    `SELECT w.id AS workspace_id,w.organization_id,w.name,w.slug,wu.role
     FROM workspace_users wu JOIN workspaces w ON w.id=wu.workspace_id
     WHERE wu.user_id=$1 AND wu.status='Active' AND wu.deleted_at IS NULL AND w.deleted_at IS NULL
     ORDER BY w.created_at ASC,w.id ASC`, [userId]
  );
  return result.rows.map((row) => ({
    workspaceId: row.workspace_id, organizationId: row.organization_id,
    name: row.name, slug: row.slug, role: row.role as WorkspaceRole,
  }));
}

interface WorkspaceMembershipRow {
  user_id: string;
  workspace_id: string;
  role: string;
  status: string;
}

/**
 * Fetches a user's membership row for a specific workspace. Returns
 * null if the user has never been a member of this workspace (or the
 * membership row was soft-deleted) — this is distinct from a
 * Suspended/Invited membership, which DOES return a row here (callers
 * decide what to do with a non-Active status; see request-actor.ts,
 * which maps both "no row" and "row but not Active" to 403 FORBIDDEN,
 * per the task brief).
 */
export async function getWorkspaceMembership(
  userId: string,
  workspaceId: string
): Promise<WorkspaceMembershipRecord | null> {
  const pool = getDatabasePool();
  const result = await pool.query<WorkspaceMembershipRow>(
    `SELECT user_id, workspace_id, role, status
     FROM workspace_users
     WHERE user_id = $1 AND workspace_id = $2 AND deleted_at IS NULL
     LIMIT 1`,
    [userId, workspaceId]
  );

  const row = result.rows[0];
  if (!row) return null;

  return {
    userId: row.user_id,
    workspaceId: row.workspace_id,
    // role/status are already constrained by the schema's CHECK
    // constraints (chk_workspace_users_role / chk_workspace_users_status)
    // to the exact string unions WorkspaceRole/WorkspaceMembershipStatus
    // describe, so this cast reflects a guarantee the database itself
    // enforces, not an unchecked assumption.
    role: row.role as WorkspaceRole,
    status: row.status as WorkspaceMembershipStatus,
  };
}

// ---- getActorForWorkspace ----------------------------------------------

/**
 * Resolves a full RequestActor for (userId, workspaceId) in a single
 * joined query — the common case used by request-actor.ts's
 * resolveRequestActor(). Returns null if the user does not exist, or
 * has no membership row (Active or otherwise) for this workspace.
 * Unlike getWorkspaceMembership() alone, this always returns a row
 * that includes the user's email/display name, since RequestActor
 * needs both. A non-Active membership status IS still returned here
 * (membershipStatus reflects the real value) — callers enforce the
 * Active requirement, this function only resolves data.
 */
export async function getActorForWorkspace(
  userId: string,
  workspaceId: string
): Promise<RequestActor | null> {
  const pool = getDatabasePool();
  const result = await pool.query<{
    user_id: string;
    email: string;
    display_name: string;
    workspace_id: string;
    role: string;
    status: string;
  }>(
    `SELECT
       u.id            AS user_id,
       u.email         AS email,
       u.display_name  AS display_name,
       wu.workspace_id AS workspace_id,
       wu.role         AS role,
       wu.status       AS status
     FROM users u
     JOIN workspace_users wu
       ON wu.user_id = u.id
      AND wu.workspace_id = $2
      AND wu.deleted_at IS NULL
     WHERE u.id = $1 AND u.deleted_at IS NULL
     LIMIT 1`,
    [userId, workspaceId]
  );

  const row = result.rows[0];
  if (!row) return null;

  return {
    userId: row.user_id,
    email: row.email,
    name: row.display_name,
    workspaceId: row.workspace_id,
    role: row.role as WorkspaceRole,
    membershipStatus: row.status as WorkspaceMembershipStatus,
  };
}
