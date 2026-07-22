// ============================================================
// Phoenix Backend — Evidence Repository
// PHX-BACKEND-005 — Assessment Write Endpoints Foundation
// ------------------------------------------------------------
// Thin, explicit, parameterized-SQL-only write functions against
// `evidence_items`. No ORM, no string interpolation with user input,
// no PBRS scoring logic — this module only inserts/updates/soft-
// deletes evidence rows; it never touches pbrs_scores,
// pbrs_dimension_scores, or derived_signals.
//
// Read functions for evidence already exist in
// assessments.repository.ts (getEvidenceByAssessmentId, used by the
// PHX-BACKEND-003 list endpoint) — that function already filters
// `deleted_at IS NULL`, so soft-deleting a row here automatically
// excludes it from that list with no further change needed.
//
// evidenceId is validated as a UUID at the route layer
// (validation/route-params.ts's parseEvidenceId()) before any
// function here is called, but every query below still binds it as a
// parameter rather than interpolating it into SQL text.
// ============================================================

import type { PoolClient } from 'pg';
import { getDatabasePool } from '../db/client';
import { getDefaultActorUserIdForAssessment } from './workspaces.repository';
import type { EvidenceItemRecord } from './assessments.repository';

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

function mapEvidenceRow(row: EvidenceItemRow): EvidenceItemRecord {
  return {
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
  };
}

// ---- Existence ---------------------------------------------------

/**
 * True only for a non-soft-deleted evidence row. A soft-deleted or
 * missing evidenceId both resolve to `false` — callers use this (or
 * getEvidenceItemById()) to decide between 404 and proceeding.
 */
export async function evidenceExists(evidenceId: string): Promise<boolean> {
  const pool = getDatabasePool();
  const result = await pool.query(
    `SELECT 1 FROM evidence_items WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
    [evidenceId]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function getEvidenceItemById(evidenceId: string): Promise<EvidenceItemRecord | null> {
  const pool = getDatabasePool();
  const result = await pool.query<EvidenceItemRow>(
    `SELECT id, assessment_id, type, title, note, file_url, external_url,
            uploaded_by_user_id, related_dimension, created_at, updated_at
     FROM evidence_items
     WHERE id = $1 AND deleted_at IS NULL
     LIMIT 1`,
    [evidenceId]
  );

  const row = result.rows[0];
  return row ? mapEvidenceRow(row) : null;
}

// ---- PHX-BACKEND-006: workspace context resolution ----------------------

/**
 * Resolves the workspaceId that an evidence item's parent assessment
 * belongs to, via evidence_items → assessments (one join, no assets/
 * workspaces join needed since assessments.workspace_id is already
 * denormalized). Returns null if the evidence item does not exist, is
 * soft-deleted, or its parent assessment is soft-deleted. Used by
 * src/auth/request-actor.ts to resolve permission-check context for
 * the evidenceId-only routes (PATCH/DELETE /api/evidence/:evidenceId).
 */
export async function getWorkspaceIdForEvidence(evidenceId: string): Promise<string | null> {
  const pool = getDatabasePool();
  const result = await pool.query<{ workspace_id: string }>(
    `SELECT a.workspace_id AS workspace_id
     FROM evidence_items e
     JOIN assessments a ON a.id = e.assessment_id AND a.deleted_at IS NULL
     WHERE e.id = $1 AND e.deleted_at IS NULL
     LIMIT 1`,
    [evidenceId]
  );
  return result.rows[0]?.workspace_id ?? null;
}

/**
 * Resolves the assessmentId (and, transitively via
 * assessments.repository.ts's getAssessmentStatus(), its status) for
 * an evidence item — used by the evidence-immutability check in
 * routes/assessments.ts's PATCH/DELETE /api/evidence/:evidenceId
 * handlers.
 */
export async function getAssessmentIdForEvidence(evidenceId: string): Promise<string | null> {
  const pool = getDatabasePool();
  const result = await pool.query<{ assessment_id: string }>(
    `SELECT assessment_id FROM evidence_items WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
    [evidenceId]
  );
  return result.rows[0]?.assessment_id ?? null;
}

// ---- PHX-BACKEND-007: ownership context resolution -----------------

/**
 * The minimal set of fields src/auth/ownership.ts's canManageEvidence()
 * needs — the evidence item's own uploader plus its parent assessment's
 * ownership fields, resolved in a single joined query. Mirrors
 * src/auth/ownership.ts's EvidenceOwnershipContext type exactly (kept
 * in sync by hand, same rationale as
 * assessments.repository.ts's AssessmentOwnershipRow).
 */
export interface EvidenceOwnershipRow {
  evidenceId: string;
  assessmentId: string;
  workspaceId: string;
  uploadedByUserId: string;
  assessmentRequestedByUserId: string;
  assessmentAssignedReviewerUserId: string | null;
  assessmentStatus: string;
  deletedAt: string | null;
}

/**
 * Resolves the ownership-relevant fields for an evidence item AND its
 * parent assessment in one joined query, INCLUDING soft-deleted
 * evidence/assessment rows (unlike evidenceExists(), which filters
 * deleted_at IS NULL on both) — callers that need to distinguish "not
 * found" from "found but soft-deleted" can inspect the returned
 * `deletedAt` field. Returns null only if no evidence row with this id
 * exists at all, or its parent assessment row is missing entirely (a
 * data-integrity situation the FK constraint should prevent, but
 * handled defensively rather than throwing).
 */
export async function getEvidenceOwnershipContext(
  evidenceId: string
): Promise<EvidenceOwnershipRow | null> {
  const pool = getDatabasePool();
  const result = await pool.query<{
    evidence_id: string;
    assessment_id: string;
    workspace_id: string;
    uploaded_by_user_id: string;
    assessment_requested_by_user_id: string;
    assessment_assigned_reviewer_user_id: string | null;
    assessment_status: string;
    deleted_at: string | null;
  }>(
    `SELECT
       e.id                          AS evidence_id,
       e.assessment_id               AS assessment_id,
       a.workspace_id                AS workspace_id,
       e.uploaded_by_user_id         AS uploaded_by_user_id,
       a.requested_by_user_id        AS assessment_requested_by_user_id,
       a.assigned_reviewer_user_id   AS assessment_assigned_reviewer_user_id,
       a.status                      AS assessment_status,
       e.deleted_at                  AS deleted_at
     FROM evidence_items e
     JOIN assessments a ON a.id = e.assessment_id
     WHERE e.id = $1
     LIMIT 1`,
    [evidenceId]
  );

  const row = result.rows[0];
  if (!row) return null;

  return {
    evidenceId: row.evidence_id,
    assessmentId: row.assessment_id,
    workspaceId: row.workspace_id,
    uploadedByUserId: row.uploaded_by_user_id,
    assessmentRequestedByUserId: row.assessment_requested_by_user_id,
    assessmentAssignedReviewerUserId: row.assessment_assigned_reviewer_user_id,
    assessmentStatus: row.assessment_status,
    deletedAt: row.deleted_at,
  };
}

// ---- Create ---------------------------------------------------------

export interface AddEvidenceInput {
  type: string;
  title: string;
  note?: string | null;
  fileUrl?: string | null;
  externalUrl?: string | null;
  relatedDimension?: string | null;
  uploadedByUserId?: string;
}

export type AddEvidenceResult =
  | { outcome: 'created'; evidence: EvidenceItemRecord }
  | { outcome: 'no_actor_available' };

/**
 * Inserts a new evidence item on an assessment. `uploadedByUserId`
 * falls back to getDefaultActorUserIdForAssessment() when not
 * supplied by the caller — see workspaces.repository.ts and
 * docs/backend/PHX_BACKEND_005_IMPLEMENTATION_REPORT.md
 * §"requestedByUserId / uploadedByUserId placeholder actor decision"
 * for why. Returns `{ outcome: 'no_actor_available' }` (never
 * attempts an insert that would violate the NOT NULL FK) if the
 * assessment's workspace has no Active member at all.
 *
 * Callers must have already confirmed the assessment exists (via
 * assessmentExists()) before calling this.
 *
 * PHX-BACKEND-007: accepts an optional trailing `client` (see
 * db/transaction.ts's withTransaction()) so
 * POST /api/assessments/:assessmentId/evidence can insert this row,
 * its activity_logs row, and its audit_records row inside one
 * transaction. Falls back to the shared pool when omitted.
 */
export async function addEvidenceItem(
  assessmentId: string,
  input: AddEvidenceInput,
  client?: PoolClient
): Promise<AddEvidenceResult> {
  const db = client ?? getDatabasePool();

  const uploadedByUserId =
    input.uploadedByUserId ?? (await getDefaultActorUserIdForAssessment(assessmentId));

  if (!uploadedByUserId) {
    return { outcome: 'no_actor_available' };
  }

  const result = await db.query<EvidenceItemRow>(
    `INSERT INTO evidence_items (
       assessment_id, type, title, note, file_url, external_url,
       uploaded_by_user_id, related_dimension
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING
       id, assessment_id, type, title, note, file_url, external_url,
       uploaded_by_user_id, related_dimension, created_at, updated_at`,
    [
      assessmentId,
      input.type,
      input.title,
      input.note ?? null,
      input.fileUrl ?? null,
      input.externalUrl ?? null,
      uploadedByUserId,
      input.relatedDimension ?? null,
    ]
  );

  return { outcome: 'created', evidence: mapEvidenceRow(result.rows[0]) };
}

// ---- Update -----------------------------------------------------------

export interface UpdateEvidenceInput {
  title?: string;
  note?: string | null;
  fileUrl?: string | null;
  externalUrl?: string | null;
  relatedDimension?: string | null;
}

/**
 * Updates only the fields present in `input` (an UpdateEvidenceBody
 * that has already passed Zod's "at least one field" refinement at
 * the route layer). Builds a parameterized, dynamic SET clause —
 * every value is still bound as a placeholder, never interpolated;
 * only column *names* (a fixed, hardcoded allow-list below, never
 * derived from client input) are assembled into the SQL text.
 * Returns null if the row does not exist or is soft-deleted.
 *
 * PHX-BACKEND-007: accepts an optional trailing `client` (see
 * db/transaction.ts's withTransaction()) so
 * PATCH /api/evidence/:evidenceId can update this row, insert its
 * activity_logs row, and insert its audit_records row (with the
 * before/after values the route captured beforehand) inside one
 * transaction. Falls back to the shared pool when omitted.
 */
export async function updateEvidenceItem(
  evidenceId: string,
  input: UpdateEvidenceInput,
  client?: PoolClient
): Promise<EvidenceItemRecord | null> {
  const db = client ?? getDatabasePool();

  const setClauses: string[] = [];
  const params: unknown[] = [];

  // Fixed, hardcoded column list — never derived from client-supplied
  // keys, so this cannot become a column-injection vector even though
  // the clause list is built dynamically.
  if (input.title !== undefined) {
    params.push(input.title);
    setClauses.push(`title = $${params.length}`);
  }
  if (input.note !== undefined) {
    params.push(input.note);
    setClauses.push(`note = $${params.length}`);
  }
  if (input.fileUrl !== undefined) {
    params.push(input.fileUrl);
    setClauses.push(`file_url = $${params.length}`);
  }
  if (input.externalUrl !== undefined) {
    params.push(input.externalUrl);
    setClauses.push(`external_url = $${params.length}`);
  }
  if (input.relatedDimension !== undefined) {
    params.push(input.relatedDimension);
    setClauses.push(`related_dimension = $${params.length}`);
  }

  if (setClauses.length === 0) {
    // Defense in depth — the route/Zod layer should never let an
    // empty patch reach here (UpdateEvidenceBodySchema's refine()
    // rejects it with 400 first), but this function does not trust
    // that alone.
    const row = await db.query<EvidenceItemRow>(
      `SELECT id, assessment_id, type, title, note, file_url, external_url,
              uploaded_by_user_id, related_dimension, created_at, updated_at
       FROM evidence_items
       WHERE id = $1 AND deleted_at IS NULL
       LIMIT 1`,
      [evidenceId]
    );
    return row.rows[0] ? mapEvidenceRow(row.rows[0]) : null;
  }

  setClauses.push(`updated_at = now()`);
  params.push(evidenceId);
  const idParamIndex = params.length;

  const result = await db.query<EvidenceItemRow>(
    `UPDATE evidence_items
     SET ${setClauses.join(', ')}
     WHERE id = $${idParamIndex} AND deleted_at IS NULL
     RETURNING
       id, assessment_id, type, title, note, file_url, external_url,
       uploaded_by_user_id, related_dimension, created_at, updated_at`,
    params
  );

  const row = result.rows[0];
  return row ? mapEvidenceRow(row) : null;
}

// ---- Soft delete -----------------------------------------------------

/**
 * Soft-deletes an evidence item by setting deleted_at. Returns true if
 * a row was updated (i.e. it existed and was not already deleted),
 * false otherwise — callers map `false` to 404.
 *
 * PHX-BACKEND-007: accepts an optional trailing `client` (see
 * db/transaction.ts's withTransaction()) so
 * DELETE /api/evidence/:evidenceId can soft-delete this row, insert
 * its activity_logs row, and insert its audit_records row inside one
 * transaction. Falls back to the shared pool when omitted.
 */
export async function softDeleteEvidenceItem(evidenceId: string, client?: PoolClient): Promise<boolean> {
  const db = client ?? getDatabasePool();
  const result = await db.query(
    `UPDATE evidence_items
     SET deleted_at = now(), updated_at = now()
     WHERE id = $1 AND deleted_at IS NULL`,
    [evidenceId]
  );
  return (result.rowCount ?? 0) > 0;
}
