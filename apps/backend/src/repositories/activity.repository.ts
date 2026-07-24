// ============================================================
// Phoenix Backend — Activity Log Repository
// PHX-BACKEND-007 — Ownership Enforcement & Audit Logging Foundation
// ------------------------------------------------------------
// Thin, explicit, parameterized-SQL-only INSERT function against
// `activity_logs`. No ORM, no string interpolation with user input.
// This module only ever inserts a row — no reads (the GET
// /api/workspaces/:workspaceId/activity route remains the
// PHX-BACKEND-001 501 stub; this sprint does not implement it — see
// task brief Task 10 "do not implement new public audit/activity
// endpoints").
//
// ---- Schema reality vs. the task brief's suggested field list -------
// The task brief's Task 7 suggests recordActivity(input) accept
// { workspace_id, actor_user_id, type, title, description,
//   related_entity_type, related_entity_id, metadata, created_at }.
// The ACTUAL `activity_logs` table (db/migrations/0001_initial_schema.sql,
// confirmed by inspection before writing this file, per the "read
// before writing" / "document rather than invent" standards) has a
// different, narrower shape:
//   id, workspace_id, type, actor_user_id, actor_display_name (NOT
//   NULL — denormalized), summary (a single TEXT field, not separate
//   title/description columns), related_entity_type, related_entity_id,
//   created_at, updated_at, deleted_at.
// There is NO metadata JSONB column on this table at all.
//
// This module's recordActivity() therefore maps onto the REAL schema,
// not the brief's suggested one:
//   - `title`/`description` collapse into a single `summary` string —
//     callers pass one pre-composed summary sentence (matching the
//     style already used by 0001_dev_seed.sql's three seeded rows,
//     e.g. 'Submitted "Q3 Investor Update Draft" for review.').
//   - `actorDisplayName` is a REQUIRED input (the column is NOT NULL)
//     — every call site in routes/assessments.ts supplies
//     actor.name (RequestActor.name, sourced from users.display_name).
//   - No `metadata` field exists to populate — if a caller has
//     structured context beyond the summary sentence, it must be
//     folded into the summary text itself. No call site in this sprint
//     needs more than the summary sentence already provides.
// This is a documented, deliberate adaptation, not a silent
// simplification — see
// docs/backend/PHX_BACKEND_007_IMPLEMENTATION_REPORT.md
// §"Activity/audit field mapping — brief vs. actual schema".
//
// ---- Activity type strings --------------------------------------------
// `type` is an unconstrained TEXT column (no CHECK constraint, no enum
// table) — confirmed by inspection. The five types this sprint writes
// (AssessmentCreated, AssessmentSubmitted, EvidenceAdded,
// EvidenceUpdated, EvidenceDeleted) follow the exact PascalCase
// convention already established by 0001_dev_seed.sql's pre-existing
// rows (AssessmentSubmitted, AssessmentDecided) — no new naming scheme
// introduced, no constraint to work around.
//
// ---- Transaction participation ----------------------------------------
// Accepts an optional trailing `client` (a `pg` Pool or PoolClient) so
// callers building a transaction via db/transaction.ts's
// withTransaction() can pass their borrowed client through, keeping
// the activity insert on the same connection/transaction as the
// business write it documents. Falls back to the shared pool when
// omitted (no caller in this sprint omits it for a write path, but the
// parameter is optional rather than required so this function remains
// callable standalone, e.g. from a future CLI/backfill script).
// ============================================================

import type { Pool, PoolClient } from 'pg';
import { getDatabasePool } from '../db/client';

/** Either the shared pool or a transaction-scoped client — both share pg's `.query()` shape. */
type Queryable = Pool | PoolClient;

/**
 * Activity type strings this sprint writes. Not a CHECK-constrained
 * enum (the column is unconstrained TEXT) — this union exists purely
 * for compile-time safety at call sites, so a typo can't silently
 * write an activity row with the wrong `type` string.
 */
export type ActivityType =
  | 'AssessmentCreated'
  | 'AssessmentSubmitted'
  | 'EvidenceAdded'
  | 'EvidenceUpdated'
  | 'EvidenceDeleted'
  // PHX-REPORTS-003: matches the `ReportRequested` system event named
  // explicitly in docs/platform/DATA_LIFECYCLE_PHX_PLATFORM_002.md §5's
  // Report Lifecycle table (Requested state, "System event" column),
  // not an invented name.
  | 'ReportRequested'
  // PHX-REPORTS-004: matches the `ReportGenerated` system event in the
  // same lifecycle table (Available state). Written by the report
  // generation worker on Generating -> Available success, with
  // actorUserId: null and actorDisplayName: 'Phoenix System' — see this
  // input's doc comments below and
  // docs/reports/PHX_REPORTS_004_IMPLEMENTATION_REPORT.md
  // §"System actor attribution".
  | 'ReportGenerated';

export interface RecordActivityInput {
  workspaceId: string;
  /**
   * PHX-REPORTS-004: nullable to support system/automated events that
   * have no human actor (e.g. the report generation worker's
   * ReportGenerated activity). activity_logs.actor_user_id is, and has
   * always been, `UUID NULL REFERENCES users(id) ON DELETE SET NULL`
   * (migration 0001_initial_schema.sql) — this widens only the
   * TypeScript input type to match a schema capability that already
   * existed; the INSERT statement below binds this value as a plain
   * parameter, so `null` flows through to SQL `NULL` with no query-text
   * change. Every pre-PHX-REPORTS-004 call site continues passing a
   * real actor.userId string — this is purely additive, no existing
   * behavior changes.
   */
  actorUserId: string | null;
  /**
   * Denormalized display name — activity_logs.actor_display_name is NOT
   * NULL, so this remains a required string even when actorUserId is
   * null. System/automated events use the literal 'Phoenix System' (see
   * ReportGenerated above) rather than leaving this blank or omitting
   * it.
   */
  actorDisplayName: string;
  type: ActivityType;
  /** A single, pre-composed summary sentence — see file header. */
  summary: string;
  relatedEntityType?: string | null;
  relatedEntityId?: string | null;
}

export interface ActivityLogRecord {
  id: string;
  workspaceId: string;
  type: string;
  actorUserId: string | null;
  actorDisplayName: string;
  summary: string;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  createdAt: string;
}

interface ActivityLogRow {
  id: string;
  workspace_id: string;
  type: string;
  actor_user_id: string | null;
  actor_display_name: string;
  summary: string;
  related_entity_type: string | null;
  related_entity_id: string | null;
  created_at: string;
}

/**
 * Inserts one activity_logs row. Parameterized SQL only — every value
 * is bound, never interpolated. Returns the inserted row's safe fields
 * (no sensitive data is ever accepted as input in the first place — see
 * RecordActivityInput above, which carries only ids/names/a summary
 * sentence).
 */
export async function recordActivity(
  input: RecordActivityInput,
  client?: Queryable
): Promise<ActivityLogRecord> {
  const db = client ?? getDatabasePool();

  const result = await db.query<ActivityLogRow>(
    `INSERT INTO activity_logs (
       workspace_id, type, actor_user_id, actor_display_name, summary,
       related_entity_type, related_entity_id
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING
       id, workspace_id, type, actor_user_id, actor_display_name, summary,
       related_entity_type, related_entity_id, created_at`,
    [
      input.workspaceId,
      input.type,
      input.actorUserId,
      input.actorDisplayName,
      input.summary,
      input.relatedEntityType ?? null,
      input.relatedEntityId ?? null,
    ]
  );

  const row = result.rows[0];
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    type: row.type,
    actorUserId: row.actor_user_id,
    actorDisplayName: row.actor_display_name,
    summary: row.summary,
    relatedEntityType: row.related_entity_type,
    relatedEntityId: row.related_entity_id,
    createdAt: row.created_at,
  };
}

// ============================================================
// PHX-BACKEND-008 — Activity & Audit Read Endpoints
// ------------------------------------------------------------
// Read path for GET /api/workspaces/:workspaceId/activity. Adds
// listWorkspaceActivity() alongside the PHX-BACKEND-007 write-only
// recordActivity() above. Same parameterized-SQL-only discipline: no
// string interpolation with user input, no ORM. Dynamic WHERE clauses
// only ever append a bound placeholder ($N) — never the filter value
// itself — into the query text, exactly matching the existing pattern
// in repositories/assessments.repository.ts's listAssessmentsByWorkspace().
//
// Excludes soft-deleted rows (deleted_at IS NULL), matching every other
// read path in this backend. Ordered created_at DESC. `total` follows
// the same convention already established by listAssessmentsByWorkspace()
// (items.length, i.e. the count of the returned page) rather than a
// separate COUNT(*) query — the task brief explicitly says "do not
// overbuild pagination yet", and this backend has no precedent for a
// true distinct-from-limit total on any existing list endpoint.
// `limit` is defensively re-clamped here (not just trusted from the
// route layer) in case this function is ever called from a future
// call site that skips route-level validation.
// ============================================================

export interface ListWorkspaceActivityInput {
  workspaceId: string;
  limit: number;
  entityType?: string;
  entityId?: string;
  type?: string;
}

/** List-item shape for GET /api/workspaces/:workspaceId/activity — includes
 * `updatedAt`, unlike ActivityLogRecord above (the INSERT...RETURNING in
 * recordActivity() never selects it, since no write call site needs it). */
export interface ActivityLogListItem {
  id: string;
  workspaceId: string;
  type: string;
  actorUserId: string | null;
  actorDisplayName: string;
  summary: string;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ActivityLogListRow extends ActivityLogRow {
  updated_at: string;
}

function clampActivityLimit(limit: number): number {
  if (!Number.isFinite(limit) || !Number.isInteger(limit)) return 25;
  if (limit < 1) return 1;
  if (limit > 100) return 100;
  return limit;
}

function mapActivityLogListRow(row: ActivityLogListRow): ActivityLogListItem {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    type: row.type,
    actorUserId: row.actor_user_id,
    actorDisplayName: row.actor_display_name,
    summary: row.summary,
    relatedEntityType: row.related_entity_type,
    relatedEntityId: row.related_entity_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Lists activity_logs rows for one workspace, most recent first,
 * excluding soft-deleted rows. Optional entityType/entityId/type
 * filters narrow the WHERE clause — each present filter appends
 * exactly one bound placeholder.
 */
export async function listWorkspaceActivity(
  input: ListWorkspaceActivityInput
): Promise<{ items: ActivityLogListItem[]; total: number }> {
  const db = getDatabasePool();
  const limit = clampActivityLimit(input.limit);

  const params: unknown[] = [input.workspaceId];
  const conditions = ['workspace_id = $1', 'deleted_at IS NULL'];

  if (input.entityType) {
    params.push(input.entityType);
    conditions.push(`related_entity_type = $${params.length}`);
  }
  if (input.entityId) {
    params.push(input.entityId);
    conditions.push(`related_entity_id = $${params.length}`);
  }
  if (input.type) {
    params.push(input.type);
    conditions.push(`type = $${params.length}`);
  }

  params.push(limit);
  const limitParamIndex = params.length;

  const result = await db.query<ActivityLogListRow>(
    `SELECT
       id, workspace_id, type, actor_user_id, actor_display_name, summary,
       related_entity_type, related_entity_id, created_at, updated_at
     FROM activity_logs
     WHERE ${conditions.join(' AND ')}
     ORDER BY created_at DESC
     LIMIT $${limitParamIndex}`,
    params
  );

  const items = result.rows.map(mapActivityLogListRow);
  return { items, total: items.length };
}

// ============================================================
// PHX-BACKEND-009B — Assessment-Scoped Activity & Audit Read Endpoints
// ------------------------------------------------------------
// Read path for GET /api/assessments/:assessmentId/activity. Scopes to
// one Assessment plus its child Evidence items, rather than an entire
// Workspace — see listWorkspaceActivity() above for the general
// pattern this mirrors (same parameterized-SQL-only discipline, same
// clamp/mapping helpers, same items.length `total` convention).
//
// Scope match: `related_entity_type = 'Assessment' AND
// related_entity_id = :assessmentId`, OR `related_entity_type =
// 'Evidence' AND related_entity_id IN (SELECT id FROM evidence_items
// WHERE assessment_id = :assessmentId)`. The inner evidence_items
// subquery deliberately does NOT filter `deleted_at IS NULL` — a
// soft-deleted Evidence item's id must still match so its full
// activity history (including the EvidenceDeleted row itself) remains
// visible, per task brief §3.5. `workspace_id = $1` is enforced
// defense-in-depth even though every related_entity_id already only
// ever points at an entity inside its own recorded workspace (see
// routes/assessments.ts's write call sites, which always pass the
// same workspaceId used for the corresponding recordActivity() call);
// this still prevents any leakage if that invariant were ever violated
// by a future call site.
// ============================================================

export interface ListAssessmentActivityInput {
  workspaceId: string;
  assessmentId: string;
  limit: number;
}

/**
 * Lists activity_logs rows scoped to one Assessment (the Assessment's
 * own events plus its child Evidence items' events), most recent
 * first, excluding activity_logs rows already soft-deleted
 * (deleted_at IS NULL — unrelated to whether the referenced Evidence
 * itself is deleted, see file header). Deleted-Evidence history is
 * retained (no evidence_items.deleted_at filter — see file header).
 */
export async function listAssessmentActivity(
  input: ListAssessmentActivityInput
): Promise<{ items: ActivityLogListItem[]; total: number }> {
  const db = getDatabasePool();
  const limit = clampActivityLimit(input.limit);

  const result = await db.query<ActivityLogListRow>(
    `SELECT
       id, workspace_id, type, actor_user_id, actor_display_name, summary,
       related_entity_type, related_entity_id, created_at, updated_at
     FROM activity_logs
     WHERE workspace_id = $1
       AND deleted_at IS NULL
       AND (
         (related_entity_type = 'Assessment' AND related_entity_id = $2)
         OR (
           related_entity_type = 'Evidence'
           AND related_entity_id IN (
             SELECT id FROM evidence_items WHERE assessment_id = $2
           )
         )
       )
     ORDER BY created_at DESC
     LIMIT $3`,
    [input.workspaceId, input.assessmentId, limit]
  );

  const items = result.rows.map(mapActivityLogListRow);
  return { items, total: items.length };
}
