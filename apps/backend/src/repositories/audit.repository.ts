// ============================================================
// Phoenix Backend — Audit Record Repository
// PHX-BACKEND-007 — Ownership Enforcement & Audit Logging Foundation
// ------------------------------------------------------------
// Thin, explicit, parameterized-SQL-only INSERT function against
// `audit_records`. No ORM, no string interpolation with user input, no
// UPDATE/DELETE anywhere in this module — audit_records is append-only
// by design (see db/migrations/0001_initial_schema.sql's TODO comment
// about a future REVOKE UPDATE, DELETE grant; this sprint does not
// touch that, it simply never issues an UPDATE/DELETE against this
// table in the first place).
//
// ---- Schema reality vs. the task brief's suggested field list -------
// The task brief's Task 8 suggests recordAudit(input) accept
// { workspace_id, actor_user_id, action, entity_type, entity_id,
//   before_state, after_state, metadata, created_at }.
// The ACTUAL `audit_records` table (confirmed by inspection before
// writing this file) has a different shape:
//   id, workspace_id, created_at, actor_user_id, action, entity_type,
//   entity_id, changes (JSONB, shape `{ field: [before, after] }` —
//   confirmed against 0001_dev_seed.sql's existing seeded row,
//   '{"status": ["Under Review", "Approved"]}'), context (nullable
//   TEXT).
// There are NO separate before_state/after_state columns and NO
// metadata column on this table.
//
// This module's recordAudit() therefore maps onto the REAL schema:
//   - `before_state`/`after_state` collapse into ONE `changes` JSONB
//     object, built as { <field>: [before, after] } per changed field
//     — exactly the format the pre-existing seed row already uses, so
//     this sprint's new rows are indistinguishable in shape from that
//     one. Callers pass `changes` pre-built in this shape (see
//     buildFieldChange() helper below for the common
//     one-field-changed case).
//   - `metadata` has no column to land in — where a caller has a
//     little extra non-sensitive context, `context` (a free TEXT
//     field, already used by the seed row as
//     'Dev seed record — PHX-BACKEND-003.') is used instead, kept
//     short and human-readable, never a JSON blob.
// Documented, deliberate adaptation — see
// docs/backend/PHX_BACKEND_007_IMPLEMENTATION_REPORT.md
// §"Activity/audit field mapping — brief vs. actual schema".
//
// ---- Action strings -----------------------------------------------------
// `action` is an unconstrained TEXT column. The five actions this
// sprint writes (assessment.create, assessment.submit, evidence.create,
// evidence.update, evidence.delete) follow the exact dot-separated
// lowercase convention already established by 0001_dev_seed.sql's
// pre-existing row ('assessment.decision.approved') — no new naming
// scheme, no constraint to work around.
//
// ---- No sensitive data, no request headers -----------------------------
// `changes`/`context` never include request headers, tokens, or any
// field beyond the specific business columns this sprint's routes
// already expose in their success responses (evidence title/note/
// fileUrl/externalUrl/relatedDimension, assessment status). No email/
// display-name is stored here (unlike activity_logs.actor_display_name,
// which is denormalized by schema design) — `actor_user_id` alone is
// sufficient for audit_records' purpose.
//
// ---- Auth-failure audit logging: NOT implemented this sprint -----------
// Per the task brief Task 8 "Preferred: do not log auth failures in
// this sprint to avoid noisy unauthenticated writes and missing actor
// issues" — no call to recordAudit() exists anywhere on a 401/403 path
// in this sprint (permission failures in request-actor.ts and
// ownership failures in ownership-guards.ts remain response-only, no
// audit row). See
// docs/backend/PHX_BACKEND_007_IMPLEMENTATION_REPORT.md §"Auth-failure
// audit logging — deferred" for the documented future path (a
// dedicated `auth_audit_log`-style table or a distinct action-string
// convention, e.g. 'auth.denied', once there is a real actor to
// attribute an anonymous/unknown-header failure to).
//
// ---- Transaction participation ----------------------------------------
// Same optional trailing `client` pattern as activity.repository.ts —
// see that file's header for the full rationale.
// ============================================================

import type { Pool, PoolClient } from 'pg';
import { getDatabasePool } from '../db/client';

type Queryable = Pool | PoolClient;

/**
 * Audit action strings this sprint writes. Not a CHECK-constrained
 * enum (the column is unconstrained TEXT) — this union exists purely
 * for compile-time safety at call sites.
 */
export type AuditAction =
  | 'assessment.create'
  | 'assessment.submit'
  | 'evidence.create'
  | 'evidence.update'
  | 'evidence.delete'
  // PHX-REPORTS-003: the audit action the task brief specifies
  // verbatim ("Write an audit event: report.requested"). Matches the
  // dot-separated lowercase convention every action above already
  // uses.
  | 'report.requested'
  // PHX-REPORTS-004 — see docs/platform/DATA_LIFECYCLE_PHX_PLATFORM_002.md
  // §5's Report Lifecycle table / PHX-REPORTS-004 task brief §7's
  // Expected State and Audit Model for the exact transition -> action
  // mapping. All six are request- or system-triggered per that table;
  // see RecordAuditInput.actorUserId's doc comment below for which is
  // which.
  | 'report.generation.started'
  | 'report.generation.retried'
  | 'report.regenerated'
  | 'report.generated'
  | 'report.generation.failed'
  | 'report.expired';

/** A single field's [before, after] pair — the atom `changes` is built from. */
export type FieldChange = [before: unknown, after: unknown];

export interface RecordAuditInput {
  workspaceId: string;
  /**
   * PHX-REPORTS-004: nullable to support system/automated audit events
   * that have no human actor. audit_records.actor_user_id is, and has
   * always been, `UUID NULL REFERENCES users(id) ON DELETE SET NULL`
   * (migration 0001_initial_schema.sql) — this widens only the
   * TypeScript input type to match a schema capability that already
   * existed; the INSERT statement below binds this value as a plain
   * parameter, so `null` flows through to SQL `NULL` with no query-text
   * change. Every pre-PHX-REPORTS-004 call site continues passing a
   * real actor.userId string — this is purely additive, no existing
   * behavior changes.
   *
   * Attribution by trigger (PHX-REPORTS-004 task brief §7 / Phase 1
   * Addendum A §2): 'report.requested' (existing), 'report.generation.started',
   * 'report.generation.retried', and 'report.regenerated' are all
   * request-triggered -> real actor.userId. 'report.generated',
   * 'report.generation.failed' (worker-triggered), and 'report.expired'
   * (automatic lazy-expiry) are all system-triggered -> null.
   */
  actorUserId: string | null;
  action: AuditAction;
  entityType: string;
  entityId: string;
  /** `{ field: [before, after] }` — see file header for the exact shape. */
  changes: Record<string, FieldChange>;
  /** Short, free-text context — never a JSON blob, never sensitive data. */
  context?: string | null;
}

export interface AuditRecord {
  id: string;
  workspaceId: string;
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  changes: Record<string, FieldChange>;
  context: string | null;
  createdAt: string;
}

interface AuditRecordRow {
  id: string;
  workspace_id: string;
  actor_user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  changes: Record<string, FieldChange>;
  context: string | null;
  created_at: string;
}

/**
 * Builds a single-field `changes` object — the common case (a create,
 * a submit, a single-value transition). For multi-field updates (e.g.
 * PATCH /api/evidence/:evidenceId, which may change several columns at
 * once), callers build the full `Record<string, FieldChange>` object
 * directly instead of calling this helper.
 */
export function buildFieldChange(field: string, before: unknown, after: unknown): Record<string, FieldChange> {
  return { [field]: [before, after] };
}

/**
 * Inserts one audit_records row. Parameterized SQL only. `changes` is
 * passed as a bound JSONB parameter (never string-concatenated into
 * the query), so its contents cannot affect the SQL text regardless of
 * what a caller puts in it.
 */
export async function recordAudit(input: RecordAuditInput, client?: Queryable): Promise<AuditRecord> {
  const db = client ?? getDatabasePool();

  const result = await db.query<AuditRecordRow>(
    `INSERT INTO audit_records (
       workspace_id, actor_user_id, action, entity_type, entity_id, changes, context
     )
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
     RETURNING
       id, workspace_id, actor_user_id, action, entity_type, entity_id, changes, context, created_at`,
    [
      input.workspaceId,
      input.actorUserId,
      input.action,
      input.entityType,
      input.entityId,
      JSON.stringify(input.changes),
      input.context ?? null,
    ]
  );

  const row = result.rows[0];
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    actorUserId: row.actor_user_id,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    changes: row.changes,
    context: row.context,
    createdAt: row.created_at,
  };
}

// ============================================================
// PHX-BACKEND-008 — Activity & Audit Read Endpoints
// ------------------------------------------------------------
// Read path for GET /api/workspaces/:workspaceId/audit-records. Adds
// listWorkspaceAuditRecords() alongside the PHX-BACKEND-007 write-only
// recordAudit() above. Still no UPDATE/DELETE anywhere in this module
// — this is an additional SELECT only. Same parameterized-SQL-only
// discipline as activity.repository.ts's listWorkspaceActivity(): every
// dynamic WHERE clause fragment appends a bound placeholder ($N), never
// a value, into the query text.
//
// audit_records has no deleted_at column (append-only by design — see
// file header above), so no soft-delete filter is needed here, unlike
// activity_logs. Ordered created_at DESC. `total` follows the same
// items.length convention as listWorkspaceActivity() — see that
// function's doc comment for the rationale.
// ============================================================

export interface ListWorkspaceAuditRecordsInput {
  workspaceId: string;
  limit: number;
  entityType?: string;
  entityId?: string;
  action?: string;
}

function clampAuditLimit(limit: number): number {
  if (!Number.isFinite(limit) || !Number.isInteger(limit)) return 25;
  if (limit < 1) return 1;
  if (limit > 100) return 100;
  return limit;
}

function mapAuditRecordRow(row: AuditRecordRow): AuditRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    actorUserId: row.actor_user_id,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    changes: row.changes,
    context: row.context,
    createdAt: row.created_at,
  };
}

/**
 * Lists audit_records rows for one workspace, most recent first.
 * Optional entityType/entityId/action filters narrow the WHERE
 * clause — each present filter appends exactly one bound placeholder.
 */
export async function listWorkspaceAuditRecords(
  input: ListWorkspaceAuditRecordsInput
): Promise<{ items: AuditRecord[]; total: number }> {
  const db = getDatabasePool();
  const limit = clampAuditLimit(input.limit);

  const params: unknown[] = [input.workspaceId];
  const conditions = ['workspace_id = $1'];

  if (input.entityType) {
    params.push(input.entityType);
    conditions.push(`entity_type = $${params.length}`);
  }
  if (input.entityId) {
    params.push(input.entityId);
    conditions.push(`entity_id = $${params.length}`);
  }
  if (input.action) {
    params.push(input.action);
    conditions.push(`action = $${params.length}`);
  }

  params.push(limit);
  const limitParamIndex = params.length;

  const result = await db.query<AuditRecordRow>(
    `SELECT
       id, workspace_id, actor_user_id, action, entity_type, entity_id,
       changes, context, created_at
     FROM audit_records
     WHERE ${conditions.join(' AND ')}
     ORDER BY created_at DESC
     LIMIT $${limitParamIndex}`,
    params
  );

  const items = result.rows.map(mapAuditRecordRow);
  return { items, total: items.length };
}
