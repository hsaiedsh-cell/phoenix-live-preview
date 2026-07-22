// ============================================================
// Phoenix Backend — Assessments Repository
// PHX-BACKEND-003 — Read-Only Workspace & Assessment Endpoints
// PHX-BACKEND-004 — Request Validation & API Error Hardening
// ------------------------------------------------------------
// Thin, explicit, parameterized-SQL-only read functions against
// `assessments` and its related tables (assessment_steps,
// evidence_items, pbrs_scores, pbrs_dimension_scores, derived_signals).
// No ORM, no string interpolation with user input, no writes, no
// scoring logic — this module only reads whatever @phoenix/pbrs already
// wrote to pbrs_scores.summary. See
// docs/backend/PHX_BACKEND_003_IMPLEMENTATION_REPORT.md for response
// shape rationale.
//
// PHX-BACKEND-004 safety note: assessmentId/workspaceId are validated
// as UUIDs, and `status`/`limit` are validated against an allow-list
// and an integer range, at the route layer (validation/route-params.ts)
// before any function here is called. Every query below still binds
// these as parameters ($1, $2, ...) rather than interpolating them into
// SQL text — including the dynamic `status` WHERE clause in
// listAssessmentsByWorkspace(), which only ever appends a placeholder
// ($N), never the value itself, into the query string. `limit` is
// always passed as an already-validated number, never a raw string.
// ============================================================

import type { PoolClient } from 'pg';
import { getDatabasePool } from '../db/client';
import { getDefaultActorUserId } from './workspaces.repository';

// ---- List ----------------------------------------------------

export interface AssessmentListItem {
  assessmentId: string;
  assetId: string;
  assetName: string;
  assetType: string;
  status: string;
  overallScore: number | null;
  grade: string | null;
  riskLevel: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListAssessmentsOptions {
  /** Optional AssessmentStatus filter, matched exactly. */
  status?: string;
  /** Max rows to return. Default 25, capped at 100. */
  limit?: number;
}

interface AssessmentListRow {
  id: string;
  asset_id: string;
  asset_name: string;
  asset_type: string;
  status: string;
  created_at: string;
  updated_at: string;
  score_summary: { overall?: number; grade?: string; riskLevel?: string } | null;
}

function clampLimit(limit: number | undefined): number {
  if (!limit || Number.isNaN(limit) || limit <= 0) return 25;
  return Math.min(limit, 100);
}

export async function listAssessmentsByWorkspace(
  workspaceId: string,
  options: ListAssessmentsOptions = {}
): Promise<{ items: AssessmentListItem[]; total: number }> {
  const pool = getDatabasePool();
  const limit = clampLimit(options.limit);

  const params: unknown[] = [workspaceId];
  let statusClause = '';
  if (options.status) {
    params.push(options.status);
    statusClause = ` AND a.status = $${params.length}`;
  }
  params.push(limit);
  const limitParamIndex = params.length;

  const result = await pool.query<AssessmentListRow>(
    `SELECT
       a.id                AS id,
       a.asset_id          AS asset_id,
       ast.name             AS asset_name,
       ast.type             AS asset_type,
       a.status             AS status,
       a.created_at         AS created_at,
       a.updated_at         AS updated_at,
       ps.summary           AS score_summary
     FROM assessments a
     JOIN assets ast ON ast.id = a.asset_id
     LEFT JOIN pbrs_scores ps ON ps.id = a.score_id
     WHERE a.workspace_id = $1
       AND a.deleted_at IS NULL${statusClause}
     ORDER BY a.created_at DESC
     LIMIT $${limitParamIndex}`,
    params
  );

  const items: AssessmentListItem[] = result.rows.map((row) => ({
    assessmentId: row.id,
    assetId: row.asset_id,
    assetName: row.asset_name,
    assetType: row.asset_type,
    status: row.status,
    overallScore: row.score_summary?.overall ?? null,
    grade: row.score_summary?.grade ?? null,
    riskLevel: row.score_summary?.riskLevel ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));

  return { items, total: items.length };
}

// ---- Existence check -------------------------------------------

export async function assessmentExists(assessmentId: string): Promise<boolean> {
  const pool = getDatabasePool();
  const result = await pool.query(
    `SELECT 1 FROM assessments WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
    [assessmentId]
  );
  return (result.rowCount ?? 0) > 0;
}

// ---- PHX-BACKEND-006: workspace context resolution ----------------------

/**
 * Resolves the workspaceId an assessment belongs to, directly via
 * `assessments.workspace_id` (no join needed — the column is already
 * denormalized onto the row). Returns null if the assessment does not
 * exist or is soft-deleted. Used by src/auth/request-actor.ts to
 * resolve permission-check context for assessmentId-only routes (the
 * assessment detail/submit/evidence routes never receive workspaceId
 * directly in their path).
 */
export async function getWorkspaceIdForAssessment(assessmentId: string): Promise<string | null> {
  const pool = getDatabasePool();
  const result = await pool.query<{ workspace_id: string }>(
    `SELECT workspace_id FROM assessments WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
    [assessmentId]
  );
  return result.rows[0]?.workspace_id ?? null;
}

/**
 * Resolves the current status of an assessment. Returns null if the
 * assessment does not exist or is soft-deleted. Used by PHX-BACKEND-006's
 * evidence-immutability check (routes/assessments.ts's PATCH/DELETE
 * /api/evidence/:evidenceId handlers) to decide whether the parent
 * assessment is still in an editable (Draft/Needs Revision) state.
 */
export async function getAssessmentStatus(assessmentId: string): Promise<string | null> {
  const pool = getDatabasePool();
  const result = await pool.query<{ status: string }>(
    `SELECT status FROM assessments WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
    [assessmentId]
  );
  return result.rows[0]?.status ?? null;
}

// ---- PHX-BACKEND-007: ownership context resolution -----------------

/**
 * The minimal set of fields src/auth/ownership.ts's predicates need to
 * decide whether an actor may manage/submit a given assessment.
 * Mirrors src/auth/ownership.ts's AssessmentOwnershipContext type
 * exactly (that module does not import from here to avoid a
 * repository→auth→repository cycle; the two shapes are kept in sync by
 * hand, both narrow and unlikely to drift).
 */
export interface AssessmentOwnershipRow {
  assessmentId: string;
  workspaceId: string;
  requestedByUserId: string;
  assignedReviewerUserId: string | null;
  status: string;
  deletedAt: string | null;
}

/**
 * Resolves the ownership-relevant fields for an assessment, INCLUDING
 * soft-deleted rows (unlike assessmentExists()/getWorkspaceIdForAssessment(),
 * which both filter deleted_at IS NULL) — callers that need to
 * distinguish "not found" from "found but soft-deleted" (none do today;
 * every PHX-BACKEND-007 route still calls assessmentExists() first and
 * only reaches this function for a row already confirmed live) can
 * inspect the returned `deletedAt` field. Returns null only if no row
 * with this id exists at all.
 */
export async function getAssessmentOwnershipContext(
  assessmentId: string
): Promise<AssessmentOwnershipRow | null> {
  const pool = getDatabasePool();
  const result = await pool.query<{
    id: string;
    workspace_id: string;
    requested_by_user_id: string;
    assigned_reviewer_user_id: string | null;
    status: string;
    deleted_at: string | null;
  }>(
    `SELECT id, workspace_id, requested_by_user_id, assigned_reviewer_user_id, status, deleted_at
     FROM assessments
     WHERE id = $1
     LIMIT 1`,
    [assessmentId]
  );

  const row = result.rows[0];
  if (!row) return null;

  return {
    assessmentId: row.id,
    workspaceId: row.workspace_id,
    requestedByUserId: row.requested_by_user_id,
    assignedReviewerUserId: row.assigned_reviewer_user_id,
    status: row.status,
    deletedAt: row.deleted_at,
  };
}

// ---- Detail -----------------------------------------------------

export interface AssessmentDetail {
  id: string;
  workspaceId: string;
  assetId: string;
  assetVersionId: string;
  status: string;
  requestedByUserId: string;
  assignedReviewerUserId: string | null;
  submittedAt: string | null;
  decidedAt: string | null;
  decisionNotes: string | null;
  scoreId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AssessmentAssetSummary {
  id: string;
  name: string;
  type: string;
  department: string;
  status: string;
}

export interface AssessmentWorkspaceSummary {
  id: string;
  name: string;
  slug: string;
}

export interface AssessmentStepRecord {
  id: string;
  sequence: number;
  name: string;
  status: string;
  assignedUserId: string | null;
  completedAt: string | null;
  notes: string | null;
}

export interface AssessmentDetailResult {
  assessment: AssessmentDetail;
  asset: AssessmentAssetSummary;
  workspace: AssessmentWorkspaceSummary;
  steps: AssessmentStepRecord[];
}

interface AssessmentDetailRow {
  id: string;
  workspace_id: string;
  asset_id: string;
  asset_version_id: string;
  status: string;
  requested_by_user_id: string;
  assigned_reviewer_user_id: string | null;
  submitted_at: string | null;
  decided_at: string | null;
  decision_notes: string | null;
  score_id: string | null;
  created_at: string;
  updated_at: string;
  asset_name: string;
  asset_type: string;
  asset_department: string;
  asset_status: string;
  workspace_name: string;
  workspace_slug: string;
}

interface AssessmentStepRow {
  id: string;
  sequence: number;
  name: string;
  status: string;
  assigned_user_id: string | null;
  completed_at: string | null;
  notes: string | null;
}

export async function getAssessmentById(assessmentId: string): Promise<AssessmentDetailResult | null> {
  const pool = getDatabasePool();

  const detailResult = await pool.query<AssessmentDetailRow>(
    `SELECT
       a.id                          AS id,
       a.workspace_id                AS workspace_id,
       a.asset_id                    AS asset_id,
       a.asset_version_id            AS asset_version_id,
       a.status                      AS status,
       a.requested_by_user_id        AS requested_by_user_id,
       a.assigned_reviewer_user_id   AS assigned_reviewer_user_id,
       a.submitted_at                AS submitted_at,
       a.decided_at                  AS decided_at,
       a.decision_notes              AS decision_notes,
       a.score_id                    AS score_id,
       a.created_at                  AS created_at,
       a.updated_at                  AS updated_at,
       ast.name                      AS asset_name,
       ast.type                      AS asset_type,
       ast.department                AS asset_department,
       ast.status                    AS asset_status,
       w.name                        AS workspace_name,
       w.slug                        AS workspace_slug
     FROM assessments a
     JOIN assets ast ON ast.id = a.asset_id
     JOIN workspaces w ON w.id = a.workspace_id
     WHERE a.id = $1 AND a.deleted_at IS NULL
     LIMIT 1`,
    [assessmentId]
  );

  const row = detailResult.rows[0];
  if (!row) return null;

  const stepsResult = await pool.query<AssessmentStepRow>(
    `SELECT id, sequence, name, status, assigned_user_id, completed_at, notes
     FROM assessment_steps
     WHERE assessment_id = $1 AND deleted_at IS NULL
     ORDER BY sequence ASC`,
    [assessmentId]
  );

  return {
    assessment: {
      id: row.id,
      workspaceId: row.workspace_id,
      assetId: row.asset_id,
      assetVersionId: row.asset_version_id,
      status: row.status,
      requestedByUserId: row.requested_by_user_id,
      assignedReviewerUserId: row.assigned_reviewer_user_id,
      submittedAt: row.submitted_at,
      decidedAt: row.decided_at,
      decisionNotes: row.decision_notes,
      scoreId: row.score_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
    asset: {
      id: row.asset_id,
      name: row.asset_name,
      type: row.asset_type,
      department: row.asset_department,
      status: row.asset_status,
    },
    workspace: {
      id: row.workspace_id,
      name: row.workspace_name,
      slug: row.workspace_slug,
    },
    steps: stepsResult.rows.map((step) => ({
      id: step.id,
      sequence: step.sequence,
      name: step.name,
      status: step.status,
      assignedUserId: step.assigned_user_id,
      completedAt: step.completed_at,
      notes: step.notes,
    })),
  };
}

// ---- Evidence -----------------------------------------------------

export interface EvidenceItemRecord {
  id: string;
  assessmentId: string;
  type: string;
  title: string;
  note: string | null;
  fileUrl: string | null;
  externalUrl: string | null;
  uploadedByUserId: string;
  relatedDimension: string | null;
  createdAt: string;
  updatedAt: string;
}

interface EvidenceItemRow {
  id: string;
  assessment_id: string;
  type: string;
  title: string;
  note: string | null;
  file_url: string | null;
  external_url: string | null;
  uploaded_by_user_id: string;
  related_dimension: string | null;
  created_at: string;
  updated_at: string;
}

export async function getEvidenceByAssessmentId(
  assessmentId: string
): Promise<{ items: EvidenceItemRecord[]; total: number }> {
  const pool = getDatabasePool();
  const result = await pool.query<EvidenceItemRow>(
    `SELECT id, assessment_id, type, title, note, file_url, external_url,
            uploaded_by_user_id, related_dimension, created_at, updated_at
     FROM evidence_items
     WHERE assessment_id = $1 AND deleted_at IS NULL
     ORDER BY created_at ASC`,
    [assessmentId]
  );

  const items: EvidenceItemRecord[] = result.rows.map((row) => ({
    id: row.id,
    assessmentId: row.assessment_id,
    type: row.type,
    title: row.title,
    note: row.note,
    fileUrl: row.file_url,
    externalUrl: row.external_url,
    uploadedByUserId: row.uploaded_by_user_id,
    relatedDimension: row.related_dimension,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));

  return { items, total: items.length };
}

// ---- Score --------------------------------------------------------

export interface DimensionScoreRecord {
  dimension: string;
  value: number;
  evidenceIds: string[];
  isOverridden: boolean;
  overrideReason: string | null;
}

export interface DerivedSignalRecord {
  key: string;
  valueText: string | null;
  valueNumeric: number | null;
}

export interface ScoreRecord {
  id: string;
  assessmentId: string;
  /** PBRSScore snapshot exactly as produced by @phoenix/pbrs. Read-only passthrough — no scoring logic here. */
  summary: unknown;
  hasOverrides: boolean;
  scoringMethod: string;
  scoredByUserId: string | null;
  createdAt: string;
  updatedAt: string;
  dimensionScores: DimensionScoreRecord[];
  derivedSignals: DerivedSignalRecord[];
}

interface ScoreRow {
  id: string;
  assessment_id: string;
  summary: unknown;
  has_overrides: boolean;
  scoring_method: string;
  scored_by_user_id: string | null;
  created_at: string;
  updated_at: string;
}

interface DimensionScoreRow {
  dimension: string;
  value: string; // NUMERIC comes back as string from pg by default
  evidence_ids: string[];
  is_overridden: boolean;
  override_reason: string | null;
}

interface DerivedSignalRow {
  key: string;
  value_text: string | null;
  value_numeric: string | null; // NUMERIC comes back as string from pg by default
}

/**
 * Returns the current PBRS score for an assessment, or null if the
 * assessment has not been scored yet. Callers must confirm the
 * assessment itself exists (via assessmentExists()) before treating a
 * null result as "not yet scored" rather than "assessment not found".
 */
export async function getScoreByAssessmentId(assessmentId: string): Promise<ScoreRecord | null> {
  const pool = getDatabasePool();

  const scoreResult = await pool.query<ScoreRow>(
    `SELECT id, assessment_id, summary, has_overrides, scoring_method,
            scored_by_user_id, created_at, updated_at
     FROM pbrs_scores
     WHERE assessment_id = $1 AND deleted_at IS NULL
     LIMIT 1`,
    [assessmentId]
  );

  const scoreRow = scoreResult.rows[0];
  if (!scoreRow) return null;

  const [dimensionResult, derivedResult] = await Promise.all([
    pool.query<DimensionScoreRow>(
      `SELECT dimension, value, evidence_ids, is_overridden, override_reason
       FROM pbrs_dimension_scores
       WHERE score_id = $1 AND deleted_at IS NULL
       ORDER BY dimension ASC`,
      [scoreRow.id]
    ),
    pool.query<DerivedSignalRow>(
      `SELECT key, value_text, value_numeric
       FROM derived_signals
       WHERE score_id = $1 AND deleted_at IS NULL
       ORDER BY key ASC`,
      [scoreRow.id]
    ),
  ]);

  return {
    id: scoreRow.id,
    assessmentId: scoreRow.assessment_id,
    summary: scoreRow.summary,
    hasOverrides: scoreRow.has_overrides,
    scoringMethod: scoreRow.scoring_method,
    scoredByUserId: scoreRow.scored_by_user_id,
    createdAt: scoreRow.created_at,
    updatedAt: scoreRow.updated_at,
    dimensionScores: dimensionResult.rows.map((row) => ({
      dimension: row.dimension,
      value: Number(row.value),
      evidenceIds: row.evidence_ids,
      isOverridden: row.is_overridden,
      overrideReason: row.override_reason,
    })),
    derivedSignals: derivedResult.rows.map((row) => ({
      key: row.key,
      valueText: row.value_text,
      valueNumeric: row.value_numeric !== null ? Number(row.value_numeric) : null,
    })),
  };
}

// ============================================================
// PHX-BACKEND-005 — Write functions
// ------------------------------------------------------------
// Everything below this line is new for PHX-BACKEND-005. Nothing
// above this line was modified beyond the getDefaultActorUserId
// import. Still parameterized-SQL-only, still no ORM, still no PBRS
// scoring — createAssessment() creates a Draft assessment shell only
// (no score_id, no pbrs_scores row). See
// docs/backend/PHX_BACKEND_005_IMPLEMENTATION_REPORT.md.
// ============================================================

// ---- Asset / asset-version existence checks -------------------------
// Supporting reads for POST /api/workspaces/:workspaceId/assessments.
// All read-only, all parameterized.

export async function assetExists(assetId: string): Promise<boolean> {
  const pool = getDatabasePool();
  const result = await pool.query(`SELECT 1 FROM assets WHERE id = $1 AND deleted_at IS NULL LIMIT 1`, [
    assetId,
  ]);
  return (result.rowCount ?? 0) > 0;
}

/**
 * Confirms an asset exists AND belongs to the given workspace, in one
 * query. Distinct from assetExists() because "asset exists but in a
 * different workspace" and "asset does not exist at all" are both
 * reported as 404 by the route (see routes/assessments.ts) — this
 * helper exists so the route only needs one repository call to answer
 * "is this a usable (workspaceId, assetId) pair".
 */
export async function assetBelongsToWorkspace(assetId: string, workspaceId: string): Promise<boolean> {
  const pool = getDatabasePool();
  const result = await pool.query(
    `SELECT 1 FROM assets WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL LIMIT 1`,
    [assetId, workspaceId]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function assetVersionExists(assetVersionId: string): Promise<boolean> {
  const pool = getDatabasePool();
  const result = await pool.query(
    `SELECT 1 FROM asset_versions WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
    [assetVersionId]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function assetVersionBelongsToAsset(assetVersionId: string, assetId: string): Promise<boolean> {
  const pool = getDatabasePool();
  const result = await pool.query(
    `SELECT 1 FROM asset_versions WHERE id = $1 AND asset_id = $2 AND deleted_at IS NULL LIMIT 1`,
    [assetVersionId, assetId]
  );
  return (result.rowCount ?? 0) > 0;
}

// ---- Create assessment -----------------------------------------------

export interface CreateAssessmentInput {
  workspaceId: string;
  assetId: string;
  assetVersionId: string;
  assignedReviewerUserId?: string | null;
  requestedByUserId?: string;
  // dueDate/notes are accepted by the request body schema but the
  // `assessments` table has no due_date/general "notes" column (only
  // decision_notes, populated at the decision stage — out of scope
  // this sprint). They are intentionally NOT persisted. See
  // docs/backend/PHX_BACKEND_005_IMPLEMENTATION_REPORT.md
  // §"dueDate / notes on create — accepted, not persisted" for the
  // documented limitation; they are still accepted here (typed) only
  // so the shape is visible at the call site, never written to SQL.
  dueDate?: string | null;
  notes?: string;
}

export type CreateAssessmentResult =
  | { outcome: 'created'; assessment: AssessmentDetail }
  | { outcome: 'no_actor_available' };

/**
 * Creates a new assessment in `Draft` status. Callers must have
 * already confirmed (workspaceId, assetId, assetVersionId) are a
 * valid, related triple via assetBelongsToWorkspace() and
 * assetVersionBelongsToAsset() before calling this — this function
 * does not re-check those relationships, only performs the insert.
 *
 * `requestedByUserId`: if not supplied by the caller, falls back to
 * getDefaultActorUserId(workspaceId) (see workspaces.repository.ts).
 * If the workspace has no Active member at all, returns
 * `{ outcome: 'no_actor_available' }` rather than attempting an
 * insert that would violate the NOT NULL/FK constraint.
 *
 * PHX-BACKEND-007: accepts an optional trailing `client` (see
 * db/transaction.ts's withTransaction()) so routes/assessments.ts's
 * POST /workspaces/:workspaceId/assessments handler can insert this
 * row, its activity_logs row, and its audit_records row inside one
 * transaction. Falls back to the shared pool when omitted, unchanged
 * from PHX-BACKEND-005 behavior.
 */
export async function createAssessment(
  input: CreateAssessmentInput,
  client?: PoolClient
): Promise<CreateAssessmentResult> {
  const db = client ?? getDatabasePool();

  const requestedByUserId =
    input.requestedByUserId ?? (await getDefaultActorUserId(input.workspaceId));

  if (!requestedByUserId) {
    return { outcome: 'no_actor_available' };
  }

  const result = await db.query<AssessmentDetailRow>(
    `INSERT INTO assessments (
       workspace_id, asset_id, asset_version_id, status,
       requested_by_user_id, assigned_reviewer_user_id
     )
     VALUES ($1, $2, $3, 'Draft', $4, $5)
     RETURNING
       id, workspace_id, asset_id, asset_version_id, status,
       requested_by_user_id, assigned_reviewer_user_id,
       submitted_at, decided_at, decision_notes, score_id,
       created_at, updated_at`,
    [input.workspaceId, input.assetId, input.assetVersionId, requestedByUserId, input.assignedReviewerUserId ?? null]
  );

  const row = result.rows[0];

  return {
    outcome: 'created',
    assessment: {
      id: row.id,
      workspaceId: row.workspace_id,
      assetId: row.asset_id,
      assetVersionId: row.asset_version_id,
      status: row.status,
      requestedByUserId: row.requested_by_user_id,
      assignedReviewerUserId: row.assigned_reviewer_user_id,
      submittedAt: row.submitted_at,
      decidedAt: row.decided_at,
      decisionNotes: row.decision_notes,
      scoreId: row.score_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
  };
}

// ---- Submit assessment -------------------------------------------------

/** Statuses from which a submission transition is allowed. */
const SUBMITTABLE_STATUSES = ['Draft', 'Needs Revision'] as const;

export type SubmitAssessmentResult =
  | { outcome: 'submitted'; assessment: AssessmentDetail }
  | { outcome: 'invalid_transition'; currentStatus: string }
  | { outcome: 'not_found' };

/**
 * Transitions an assessment from Draft/Needs Revision to Submitted,
 * inside a transaction with a row lock (SELECT ... FOR UPDATE) so a
 * concurrent double-submit cannot both succeed. `submittedByUserId`/
 * `note` from SubmitAssessmentBodySchema are intentionally NOT
 * persisted — `assessments` has no submitted_by_user_id or general
 * note column (only `submitted_at`, which this function does set).
 * See docs/backend/PHX_BACKEND_005_IMPLEMENTATION_REPORT.md
 * §"submittedByUserId / note on submit — accepted, not persisted".
 *
 * Callers should have already confirmed the assessment exists via
 * assessmentExists() for a fast 404 path, but this function still
 * re-checks inside the transaction (and returns `not_found` if the
 * row disappeared between the two calls) rather than assuming.
 *
 * PHX-BACKEND-007: accepts an optional trailing `externalClient` (see
 * db/transaction.ts's withTransaction()). When provided, this
 * function does NOT issue its own BEGIN/COMMIT/ROLLBACK — it trusts
 * the caller to manage the transaction boundary (routes/assessments.ts's
 * POST /assessments/:assessmentId/submit handler wraps the update,
 * the activity_logs insert, and the audit_records insert in one
 * withTransaction() call) — but the row lock (SELECT ... FOR UPDATE)
 * is still taken either way, so the double-submit protection is
 * unchanged. When `externalClient` is omitted, this function manages
 * its own connection/transaction exactly as it did in PHX-BACKEND-005/
 * 006 — every pre-existing call site (none call this directly outside
 * routes/assessments.ts today, but the self-managed path is kept for
 * any future standalone/test caller) keeps working unmodified.
 */
export async function submitAssessment(
  assessmentId: string,
  externalClient?: PoolClient
): Promise<SubmitAssessmentResult> {
  const pool = getDatabasePool();
  const client = externalClient ?? (await pool.connect());
  const ownsTransaction = externalClient === undefined;

  try {
    if (ownsTransaction) {
      await client.query('BEGIN');
    }

    const lockResult = await client.query<{ status: string }>(
      `SELECT status FROM assessments WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [assessmentId]
    );

    const currentRow = lockResult.rows[0];
    if (!currentRow) {
      if (ownsTransaction) await client.query('ROLLBACK');
      return { outcome: 'not_found' };
    }

    if (!(SUBMITTABLE_STATUSES as readonly string[]).includes(currentRow.status)) {
      if (ownsTransaction) await client.query('ROLLBACK');
      return { outcome: 'invalid_transition', currentStatus: currentRow.status };
    }

    const updateResult = await client.query<AssessmentDetailRow>(
      `UPDATE assessments
       SET status = 'Submitted', submitted_at = now(), updated_at = now()
       WHERE id = $1
       RETURNING
         id, workspace_id, asset_id, asset_version_id, status,
         requested_by_user_id, assigned_reviewer_user_id,
         submitted_at, decided_at, decision_notes, score_id,
         created_at, updated_at`,
      [assessmentId]
    );

    if (ownsTransaction) {
      await client.query('COMMIT');
    }

    const row = updateResult.rows[0];
    return {
      outcome: 'submitted',
      assessment: {
        id: row.id,
        workspaceId: row.workspace_id,
        assetId: row.asset_id,
        assetVersionId: row.asset_version_id,
        status: row.status,
        requestedByUserId: row.requested_by_user_id,
        assignedReviewerUserId: row.assigned_reviewer_user_id,
        submittedAt: row.submitted_at,
        decidedAt: row.decided_at,
        decisionNotes: row.decision_notes,
        scoreId: row.score_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
    };
  } catch (err) {
    if (ownsTransaction) {
      await client.query('ROLLBACK').catch(() => undefined);
    }
    throw err;
  } finally {
    if (ownsTransaction) {
      client.release();
    }
  }
}
