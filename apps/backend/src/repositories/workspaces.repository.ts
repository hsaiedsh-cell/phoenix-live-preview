// ============================================================
// Phoenix Backend — Workspaces Repository
// PHX-BACKEND-003 — Read-Only Workspace & Assessment Endpoints
// PHX-BACKEND-004 — Request Validation & API Error Hardening
// ------------------------------------------------------------
// Thin, explicit, parameterized-SQL-only read functions against the
// `workspaces` table. No ORM, no string interpolation with user input,
// no writes. Callers must have already confirmed database availability
// via middleware/database-required.ts's requireDatabase().
//
// PHX-BACKEND-004 safety note: workspaceId is validated as a UUID at
// the route layer (validation/route-params.ts) before any function
// here is called, but every query below still passes it as a bound
// parameter ($1) rather than interpolating it into SQL text — so these
// functions remain injection-safe even if called with unvalidated
// input in the future.
// ============================================================

import { getDatabasePool } from '../db/client';

export interface WorkspaceRecord {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  settings: unknown;
  status: 'Active';
  createdAt: string;
  updatedAt: string;
}

interface WorkspaceRow {
  id: string;
  organization_id: string;
  name: string;
  slug: string;
  settings: unknown;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

function mapWorkspaceRow(row: WorkspaceRow): WorkspaceRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    slug: row.slug,
    settings: row.settings,
    // The `workspaces` table has no dedicated status column; every
    // non-soft-deleted row (guaranteed by the WHERE clause below) is
    // reported as 'Active'. This is a placeholder mapping only — no
    // richer WorkspaceStatus enum is introduced by this schema.
    status: 'Active',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Fetches a single workspace by id. Returns null if the workspace does
 * not exist or has been soft-deleted (deleted_at IS NOT NULL).
 */
export async function getWorkspaceById(workspaceId: string): Promise<WorkspaceRecord | null> {
  const pool = getDatabasePool();
  const result = await pool.query<WorkspaceRow>(
    `SELECT id, organization_id, name, slug, settings, created_at, updated_at, deleted_at
     FROM workspaces
     WHERE id = $1 AND deleted_at IS NULL
     LIMIT 1`,
    [workspaceId]
  );

  const row = result.rows[0];
  return row ? mapWorkspaceRow(row) : null;
}

/**
 * Lightweight existence check — used by assessment routes to confirm a
 * workspace exists before listing/filtering by it, without pulling the
 * full workspace payload.
 */
export async function workspaceExists(workspaceId: string): Promise<boolean> {
  const pool = getDatabasePool();
  const result = await pool.query(
    `SELECT 1 FROM workspaces WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
    [workspaceId]
  );
  return (result.rowCount ?? 0) > 0;
}

// ---- PHX-BACKEND-005: placeholder-actor resolution ------------------
//
// DEPRECATED as of PHX-BACKEND-006: every route in routes/assessments.ts
// now resolves a real, permission-checked RequestActor (see
// src/auth/request-actor.ts) and always supplies actor.userId as
// requestedByUserId/uploadedByUserId explicitly — neither function
// below is called from any route anymore. They are kept (not deleted)
// per the PHX-BACKEND-006 task brief ("do not remove repository
// fallback functions if they remain unused; they can be deprecated/
// commented") in case a future non-actor-bearing code path (a CLI
// script, a test fixture) still needs a deterministic "pick some
// Active member" lookup. Do not wire these back into any HTTP route —
// use requirePermission()'s resolved actor instead.
//
// This backend does not implement authentication (explicitly out of
// scope — see PHX-BACKEND-005 task brief). Several NOT NULL "acting
// user" columns (assessments.requested_by_user_id,
// evidence_items.uploaded_by_user_id) still require a value on every
// write, and this sprint's body schemas make those fields OPTIONAL
// (no session to derive them from). When the caller omits them, the
// write endpoints fall back to this lookup: the workspace's
// Owner-role member (falling back to the earliest-added Active
// member if no Owner is found), rather than a fabricated "system"
// user row that would require an out-of-scope migration/seed change.
//
// This is a documented placeholder, not a permission or identity
// decision — see docs/backend/PHX_BACKEND_005_IMPLEMENTATION_REPORT.md
// §"requestedByUserId / uploadedByUserId placeholder actor decision".
// It is expected to be replaced once an auth sprint introduces a real
// session-derived actor.

interface DefaultActorRow {
  user_id: string;
}

/**
 * Resolves a placeholder "acting user" for a workspace: the Owner-role
 * Active member if one exists, else the earliest-added Active member,
 * else null (no Active members at all — callers must handle this by
 * surfacing a clear error rather than writing an invalid FK).
 */
export async function getDefaultActorUserId(workspaceId: string): Promise<string | null> {
  const pool = getDatabasePool();
  const result = await pool.query<DefaultActorRow>(
    `SELECT wu.user_id AS user_id
     FROM workspace_users wu
     WHERE wu.workspace_id = $1
       AND wu.status = 'Active'
       AND wu.deleted_at IS NULL
     ORDER BY (wu.role = 'Owner') DESC, wu.created_at ASC
     LIMIT 1`,
    [workspaceId]
  );

  return result.rows[0]?.user_id ?? null;
}

/**
 * Same resolution as getDefaultActorUserId(), but scoped by an
 * assessment id rather than a workspace id directly — used by the
 * evidence write endpoints, which only have assessmentId on hand.
 */
export async function getDefaultActorUserIdForAssessment(assessmentId: string): Promise<string | null> {
  const pool = getDatabasePool();
  const result = await pool.query<DefaultActorRow>(
    `SELECT wu.user_id AS user_id
     FROM workspace_users wu
     JOIN assessments a ON a.workspace_id = wu.workspace_id
     WHERE a.id = $1
       AND a.deleted_at IS NULL
       AND wu.status = 'Active'
       AND wu.deleted_at IS NULL
     ORDER BY (wu.role = 'Owner') DESC, wu.created_at ASC
     LIMIT 1`,
    [assessmentId]
  );

  return result.rows[0]?.user_id ?? null;
}
