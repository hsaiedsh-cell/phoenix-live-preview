// ============================================================
// Phoenix Platform — Preview API Client (vercel-supabase-preview mode)
// PHX-DEPLOY-004C — Vercel + Supabase Free Preview Adapter
// ------------------------------------------------------------
// Server Component / server-only read functions for
// vercel-supabase-preview mode — the counterpart to
// real-api-client.server.ts (real-dev / production-auth, which reads
// the Express backend over HTTP). This file has NO HTTP call in it at
// all: every function resolves the Clerk session, maps it to a Phoenix
// user, resolves that user's workspace role, enforces the exact same
// permission as the matching backend route would, and then runs a
// parameterized SQL query directly against Supabase/Postgres — see
// lib/auth/preview-auth.server.ts and lib/db/preview-db.server.ts.
//
// Every function below returns the SAME `Backend*` shapes
// (real-api-client.ts) and throws the SAME typed errors
// (RealApiConfigError / RealApiAuthRequiredError / RealApiError) that
// real-api-client.server.ts's realGet* functions throw — this is what
// lets platform-data-source.ts's errorToLiveResult() and every
// migrated page work UNCHANGED for this mode; only
// platform-data-source.ts's mode branch needs to pick this file's
// functions instead of real-api-client.server.ts's.
//
// SQL below is copied/mirrored (not imported — different app/runtime)
// from the matching apps/backend/src/repositories/*.ts functions, kept
// column-for-column identical so the returned shape matches
// real-api-client.ts's Backend* types exactly. See each function's
// comment for which backend repository function it mirrors.
//
// This file MUST NOT be imported from any 'use client' component — it
// transitively imports preview-db.server.ts (raw `pg`) and dynamically
// imports '@clerk/nextjs/server'. Only lib/platform-data-source.ts
// imports this file, and only from its vercel-supabase-preview branch.
// ============================================================

import { getPreviewDatabasePool } from './db/preview-db.server';
import {
  getPreviewAuthConfigStatus,
  resolvePreviewSessionState,
  resolvePreviewUserId,
  resolvePreviewActor,
  previewHasPermission,
  type Permission,
} from './auth/preview-auth.server';
import { getPhoenixApiConfig } from './api-config';
import {
  RealApiError,
  RealApiConfigError,
  RealApiAuthRequiredError,
  type BackendPaginatedResult,
  type BackendAssessment,
  type BackendAssessmentDetail,
  type BackendEvidenceItem,
  type BackendScore,
  type BackendActivityItem,
  type BackendAuditRecord,
  type BackendPassport,
  type BackendCertification,
} from './real-api-client';

// ---------------------------------------------------------------------------
// Shared preflight: config → Clerk session → Phoenix user mapping.
// Every exported read function below calls this first. Mirrors the
// backend's getRequestUserId() ordering: config-missing before any
// Clerk/DB call, then signed-out, then "no linked Phoenix user."
// ---------------------------------------------------------------------------

async function resolvePreviewUserOrThrow(): Promise<{ userId: string; email: string | null }> {
  const status = getPreviewAuthConfigStatus();
  if (!status.fullyConfigured) {
    throw new RealApiConfigError(
      `vercel-supabase-preview mode requires: ${status.missing.join(', ')}. This mode does not fall back to mock or real-dev.`
    );
  }

  const session = await resolvePreviewSessionState();
  if (session.mode === 'config-missing') {
    throw new RealApiConfigError(`Clerk is not fully configured. Missing: ${session.missing.join(', ')}.`);
  }
  if (session.mode !== 'signed-in') {
    // 'signed-out' or the unreachable 'not-applicable' (this function is
    // only ever called in vercel-supabase-preview mode).
    throw new RealApiAuthRequiredError();
  }

  const mapping = await resolvePreviewUserId(session.clerkUserId, session.email, session.emailVerified);
  if (!mapping.ok) {
    // Same treatment as the backend's "no user found for this header" —
    // an unmatched identity is unauthenticated from Phoenix's point of
    // view, not a 404. Per task brief: never auto-provision a user here.
    throw new RealApiError(
      401,
      'AUTH_REQUIRED',
      `No Phoenix user is linked to this Clerk identity (${mapping.reason}). Ask a Phoenix Owner/Admin to invite this email address, or sign in with an already-linked account.`
    );
  }

  return { userId: mapping.userId, email: session.email };
}

/** Resolves the actor for `workspaceId` and enforces `permission`, mirroring request-actor.ts's requirePermission(). */
async function requirePreviewPermission(workspaceId: string, permission: Permission) {
  const { userId } = await resolvePreviewUserOrThrow();

  const actor = await resolvePreviewActor(userId, workspaceId);
  if (!actor || actor.membershipStatus !== 'Active') {
    throw new RealApiError(
      403,
      'PERMISSION_DENIED',
      actor
        ? `User membership in this workspace is not Active (status: ${actor.membershipStatus}).`
        : 'User is not a member of this workspace.'
    );
  }

  if (!previewHasPermission(actor.role, permission)) {
    throw new RealApiError(403, 'PERMISSION_DENIED', `Role "${actor.role}" does not have permission "${permission}".`);
  }

  return actor;
}

async function workspaceExists(workspaceId: string): Promise<boolean> {
  const pool = getPreviewDatabasePool();
  const result = await pool.query(`SELECT 1 FROM workspaces WHERE id = $1 AND deleted_at IS NULL LIMIT 1`, [
    workspaceId,
  ]);
  return (result.rowCount ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Assessments list — mirrors repositories/assessments.repository.ts's
// listAssessmentsByWorkspace(). Requires 'assessment.read' (same
// permission GET /api/workspaces/:workspaceId/assessments enforces).
// ---------------------------------------------------------------------------

export async function previewGetAssessments(workspaceId: string): Promise<BackendPaginatedResult<BackendAssessment>> {
  if (!(await workspaceExists(workspaceId))) {
    throw new RealApiError(404, 'NOT_FOUND', 'Workspace not found.');
  }
  await requirePreviewPermission(workspaceId, 'assessment.read');

  const pool = getPreviewDatabasePool();
  const result = await pool.query<{
    id: string;
    asset_id: string;
    asset_name: string;
    asset_type: string;
    status: string;
    created_at: string;
    updated_at: string;
    score_summary: { overall?: number; grade?: string; riskLevel?: string } | null;
  }>(
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
       AND a.deleted_at IS NULL
     ORDER BY a.created_at DESC
     LIMIT 100`,
    [workspaceId]
  );

  const items: BackendAssessment[] = result.rows.map((row) => ({
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

  return { items, total: items.length, cursor: null };
}

// ---------------------------------------------------------------------------
// Assessment detail — mirrors assessments.repository.ts's getAssessmentById().
// Workspace scope for the permission check is resolved from the
// assessment row itself (assessments.workspace_id), exactly like
// routes/assessments.ts's GET /api/assessments/:assessmentId handler
// (getWorkspaceIdForAssessment()).
// ---------------------------------------------------------------------------

export async function previewGetAssessmentDetail(assessmentId: string): Promise<BackendAssessmentDetail> {
  const pool = getPreviewDatabasePool();

  const detailResult = await pool.query<{
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
    workspace_name: string;
    workspace_slug: string;
  }>(
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
  if (!row) {
    // Preflight the actor/config check even on a not-found path, so a
    // signed-out or unmapped caller still gets auth-required/config-missing
    // rather than leaking "not found" to an unauthenticated request.
    await resolvePreviewUserOrThrow();
    throw new RealApiError(404, 'NOT_FOUND', 'Assessment not found.');
  }

  await requirePreviewPermission(row.workspace_id, 'assessment.read');

  const score = await previewGetAssessmentScore(assessmentId);

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
      department: '',
      status: '',
    },
    workspace: {
      id: row.workspace_id,
      name: row.workspace_name,
      slug: row.workspace_slug,
    },
    score,
    steps: [],
  };
}

// ---------------------------------------------------------------------------
// Evidence — mirrors assessments.repository.ts's getEvidenceByAssessmentId().
// Requires 'evidence.read', scoped to the assessment's workspace.
// ---------------------------------------------------------------------------

export async function previewGetAssessmentEvidence(
  assessmentId: string
): Promise<BackendPaginatedResult<BackendEvidenceItem>> {
  const pool = getPreviewDatabasePool();

  const workspaceResult = await pool.query<{ workspace_id: string }>(
    `SELECT workspace_id FROM assessments WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
    [assessmentId]
  );
  const workspaceId = workspaceResult.rows[0]?.workspace_id;
  if (!workspaceId) {
    await resolvePreviewUserOrThrow();
    throw new RealApiError(404, 'NOT_FOUND', 'Assessment not found.');
  }

  await requirePreviewPermission(workspaceId, 'evidence.read');

  const result = await pool.query<{
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
  }>(
    `SELECT id, assessment_id, type, title, note, file_url, external_url,
            uploaded_by_user_id, related_dimension, created_at, updated_at
     FROM evidence_items
     WHERE assessment_id = $1 AND deleted_at IS NULL
     ORDER BY created_at ASC`,
    [assessmentId]
  );

  const items: BackendEvidenceItem[] = result.rows.map((row) => ({
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

  return { items, total: items.length, cursor: null };
}

// ---------------------------------------------------------------------------
// Score — mirrors assessments.repository.ts's getScoreByAssessmentId().
// Returns null (not an error) when the assessment has not been scored
// yet, same as the backend route. Requires 'assessment.read'.
// ---------------------------------------------------------------------------

export async function previewGetAssessmentScore(assessmentId: string): Promise<BackendScore | null> {
  const pool = getPreviewDatabasePool();

  const workspaceResult = await pool.query<{ workspace_id: string }>(
    `SELECT workspace_id FROM assessments WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
    [assessmentId]
  );
  const workspaceId = workspaceResult.rows[0]?.workspace_id;
  if (!workspaceId) {
    await resolvePreviewUserOrThrow();
    throw new RealApiError(404, 'NOT_FOUND', 'Assessment not found.');
  }

  await requirePreviewPermission(workspaceId, 'assessment.read');

  const scoreResult = await pool.query<{
    id: string;
    assessment_id: string;
    summary: BackendScore['summary'];
    has_overrides: boolean;
    scoring_method: string;
    scored_by_user_id: string | null;
    created_at: string;
    updated_at: string;
  }>(
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
    pool.query<{ dimension: string; value: string; evidence_ids: string[]; is_overridden: boolean; override_reason: string | null }>(
      `SELECT dimension, value, evidence_ids, is_overridden, override_reason
       FROM pbrs_dimension_scores
       WHERE score_id = $1 AND deleted_at IS NULL
       ORDER BY dimension ASC`,
      [scoreRow.id]
    ),
    pool.query<{ key: string; value_text: string | null; value_numeric: string | null }>(
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

// ---------------------------------------------------------------------------
// Workspace activity — mirrors activity.repository.ts's listWorkspaceActivity().
// Requires 'audit.read', exactly like GET /api/workspaces/:workspaceId/activity.
// ---------------------------------------------------------------------------

export async function previewGetWorkspaceActivity(
  workspaceId: string
): Promise<BackendPaginatedResult<BackendActivityItem>> {
  if (!(await workspaceExists(workspaceId))) {
    throw new RealApiError(404, 'NOT_FOUND', 'Workspace not found.');
  }
  await requirePreviewPermission(workspaceId, 'audit.read');

  const pool = getPreviewDatabasePool();
  const result = await pool.query<{
    id: string;
    workspace_id: string;
    type: string;
    actor_user_id: string | null;
    actor_display_name: string;
    summary: string;
    related_entity_type: string | null;
    related_entity_id: string | null;
    created_at: string;
  }>(
    `SELECT
       id, workspace_id, type, actor_user_id, actor_display_name, summary,
       related_entity_type, related_entity_id, created_at
     FROM activity_logs
     WHERE workspace_id = $1 AND deleted_at IS NULL
     ORDER BY created_at DESC
     LIMIT 25`,
    [workspaceId]
  );

  const items: BackendActivityItem[] = result.rows.map((row) => ({
    id: row.id,
    workspaceId: row.workspace_id,
    type: row.type,
    actorUserId: row.actor_user_id,
    actorDisplayName: row.actor_display_name,
    summary: row.summary,
    relatedEntityType: row.related_entity_type,
    relatedEntityId: row.related_entity_id,
    createdAt: row.created_at,
  }));

  return { items, total: items.length, cursor: null };
}

// ---------------------------------------------------------------------------
// Audit records — mirrors audit.repository.ts's listWorkspaceAuditRecords().
// Requires 'audit.read', exactly like GET /api/workspaces/:workspaceId/audit-records.
// ---------------------------------------------------------------------------

export async function previewGetWorkspaceAuditRecords(
  workspaceId: string
): Promise<BackendPaginatedResult<BackendAuditRecord>> {
  if (!(await workspaceExists(workspaceId))) {
    throw new RealApiError(404, 'NOT_FOUND', 'Workspace not found.');
  }
  await requirePreviewPermission(workspaceId, 'audit.read');

  const pool = getPreviewDatabasePool();
  const result = await pool.query<{
    id: string;
    workspace_id: string;
    actor_user_id: string | null;
    action: string;
    entity_type: string;
    entity_id: string;
    changes: Record<string, [unknown, unknown]>;
    context: string | null;
    created_at: string;
  }>(
    `SELECT
       id, workspace_id, actor_user_id, action, entity_type, entity_id,
       changes, context, created_at
     FROM audit_records
     WHERE workspace_id = $1
     ORDER BY created_at DESC
     LIMIT 25`,
    [workspaceId]
  );

  const items: BackendAuditRecord[] = result.rows.map((row) => ({
    id: row.id,
    workspaceId: row.workspace_id,
    actorUserId: row.actor_user_id,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    changes: row.changes,
    context: row.context,
    createdAt: row.created_at,
  }));

  return { items, total: items.length, cursor: null };
}

// ---------------------------------------------------------------------------
// Passports — PHX-PASSPORTS-001. No backend repository exists to mirror
// (apps/backend/src/routes/passports.ts is still a PHX-BACKEND-001 stub —
// every route returns 501), so this queries pbrs_passports directly against
// the documented schema (apps/backend/db/migrations/0001_initial_schema.sql).
//
// Permission: there is no dedicated 'passport.read' entry in the permission
// matrix (lib/auth/preview-auth.server.ts's Permission type only has
// 'passport.issue' for the write path). Passports are read-only artifacts
// derived from an already-readable Assessment, so this deliberately gates on
// 'assessment.read' — the same permission every role that can view an
// assessment already holds (Owner/Admin/Reviewer/Contributor/Viewer/
// Auditor). Documented here as an explicit, deliberate assumption per this
// sprint's task brief ("If a migration is required, document it explicitly" /
// "any deliberate deviation... must be documented") — a future sprint adding
// a real backend passports endpoint should confirm this matches whatever
// permission that endpoint ends up enforcing.
//
// Certification join: LEFT JOIN LATERAL picks the single most recent
// non-deleted pbrs_certifications row for the passport, if any — a passport
// with no certification row at all is "Pending Certification" (mirrors
// sample-data.ts's mock PhoenixPassport.certificationStatus semantics).
// `certificationLevel` (PBRS Foundation/Practitioner/Enterprise) is NOT
// computed here — see BackendPassport's doc comment; callers derive it from
// `scoreSnapshot` via certification-levels.ts's certificationLevelFromScore().
// ---------------------------------------------------------------------------

export async function previewGetPassports(workspaceId: string): Promise<BackendPaginatedResult<BackendPassport>> {
  if (!(await workspaceExists(workspaceId))) {
    throw new RealApiError(404, 'NOT_FOUND', 'Workspace not found.');
  }
  await requirePreviewPermission(workspaceId, 'assessment.read');

  const pool = getPreviewDatabasePool();
  const result = await pool.query<{
    id: string;
    passport_id: string;
    asset_id: string;
    asset_name: string;
    assessment_id: string;
    status: string;
    score_snapshot: string;
    grade_snapshot: string;
    valid_from: string | null;
    valid_until: string | null;
    record_hash: string;
    issued_at: string | null;
    revoked_at: string | null;
    created_at: string;
    updated_at: string;
    certification_tier: string | null;
    certification_status: string | null;
  }>(
    `SELECT
       p.id                  AS id,
       p.passport_id         AS passport_id,
       p.asset_id            AS asset_id,
       ast.name              AS asset_name,
       p.assessment_id       AS assessment_id,
       p.status              AS status,
       p.score_snapshot      AS score_snapshot,
       p.grade_snapshot      AS grade_snapshot,
       p.valid_from          AS valid_from,
       p.valid_until         AS valid_until,
       p.record_hash         AS record_hash,
       p.issued_at           AS issued_at,
       p.revoked_at          AS revoked_at,
       p.created_at          AS created_at,
       p.updated_at          AS updated_at,
       cert.tier             AS certification_tier,
       cert.status           AS certification_status
     FROM pbrs_passports p
     JOIN assets ast ON ast.id = p.asset_id
     LEFT JOIN LATERAL (
       SELECT c.tier, c.status
       FROM pbrs_certifications c
       WHERE c.passport_id = p.id AND c.deleted_at IS NULL
       ORDER BY c.created_at DESC
       LIMIT 1
     ) cert ON true
     WHERE p.workspace_id = $1
       AND p.deleted_at IS NULL
     ORDER BY p.created_at DESC
     LIMIT 100`,
    [workspaceId]
  );

  const items: BackendPassport[] = result.rows.map((row) => ({
    id: row.id,
    passportId: row.passport_id,
    assetId: row.asset_id,
    assetName: row.asset_name,
    assessmentId: row.assessment_id,
    status: row.status,
    scoreSnapshot: Number(row.score_snapshot),
    gradeSnapshot: row.grade_snapshot,
    validFrom: row.valid_from,
    validUntil: row.valid_until,
    recordHash: row.record_hash,
    issuedAt: row.issued_at,
    revokedAt: row.revoked_at,
    certificationTier: row.certification_tier,
    certificationStatus: row.certification_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));

  return { items, total: items.length, cursor: null };
}

// ---------------------------------------------------------------------------
// Certifications list (PHX-CERTIFICATIONS-001) — mirrors
// previewGetPassports() immediately above, column-for-column and
// structurally identical: same workspaceExists() 404 check, same
// 'assessment.read' permission (there is no dedicated
// certification.read permission — see apps/backend/src/auth/
// permissions.ts; 'assessment.read' is granted to every role, matching
// the Certifications page's "visible to every signed-in workspace
// member" access), same single bounded read with no pagination cursor.
// Joins pbrs_certifications -> pbrs_passports (for assessment_id) ->
// assets (for display name), soft-deleted rows excluded. No
// Certification Level / Internal Tier THRESHOLD logic here — this
// returns the certification record exactly as already persisted; see
// certification-levels.ts, which remains the sole source of truth for
// deriving a Certification Level from `scoreSnapshot`.
// ---------------------------------------------------------------------------

export async function previewGetCertifications(
  workspaceId: string
): Promise<BackendPaginatedResult<BackendCertification>> {
  if (!(await workspaceExists(workspaceId))) {
    throw new RealApiError(404, 'NOT_FOUND', 'Workspace not found.');
  }
  await requirePreviewPermission(workspaceId, 'assessment.read');

  const pool = getPreviewDatabasePool();
  const result = await pool.query<{
    id: string;
    certification_id: string;
    passport_id: string;
    asset_id: string;
    asset_name: string;
    assessment_id: string;
    tier: string;
    status: string;
    score_snapshot: string;
    issued_date: string | null;
    expiry_date: string | null;
    created_at: string;
    updated_at: string;
  }>(
    `SELECT
       c.id                AS id,
       c.certification_id  AS certification_id,
       c.passport_id       AS passport_id,
       p.asset_id          AS asset_id,
       ast.name            AS asset_name,
       p.assessment_id     AS assessment_id,
       c.tier              AS tier,
       c.status            AS status,
       c.score_snapshot    AS score_snapshot,
       c.issued_date       AS issued_date,
       c.expiry_date       AS expiry_date,
       c.created_at        AS created_at,
       c.updated_at        AS updated_at
     FROM pbrs_certifications c
     JOIN pbrs_passports p ON p.id = c.passport_id
     JOIN assets ast ON ast.id = p.asset_id
     WHERE c.workspace_id = $1
       AND c.deleted_at IS NULL
     ORDER BY c.created_at DESC
     LIMIT 100`,
    [workspaceId]
  );

  const items: BackendCertification[] = result.rows.map((row) => ({
    id: row.id,
    certificationId: row.certification_id,
    passportId: row.passport_id,
    assetId: row.asset_id,
    assetName: row.asset_name,
    assessmentId: row.assessment_id,
    tier: row.tier,
    status: row.status,
    scoreSnapshot: Number(row.score_snapshot),
    issuedDate: row.issued_date,
    expiryDate: row.expiry_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));

  return { items, total: items.length, cursor: null };
}

/** Re-export so platform-data-source.ts's mode branch can pass the active mode's baseUrl-free config through without a second import of api-config.ts. */
export function getPreviewModeActive(): boolean {
  return getPhoenixApiConfig().mode === 'vercel-supabase-preview';
}
