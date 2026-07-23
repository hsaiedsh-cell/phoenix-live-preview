// ============================================================
// Phoenix Backend — Reports Repository
// PHX-REPORTS-003 — Report Request API & State Model
// PHX-REPORTS-003-R1 — adds report_version/version; see below.
// ------------------------------------------------------------
// Thin, explicit, parameterized-SQL-only functions against `reports`
// and `report_templates`. No ORM, no string interpolation with user
// input. This sprint only ever INSERTs a `reports` row in `Requested`
// status — no generation, no PDF/export, no status transitions. The
// live read path for these same two tables (previewGetReports() in
// apps/platform/src/lib/preview-api-client.server.ts, PHX-REPORTS-001)
// is untouched by this file — that remains the
// vercel-supabase-preview-only direct-Postgres read; this file is the
// real-dev/production-auth Express write path, reached through
// routes/reports.ts's POST /api/workspaces/:workspaceId/reports.
//
// ---- Schema reality vs. the task brief's suggested field list -------
// Confirmed by inspection (db/migrations/0001_initial_schema.sql) and
// cross-checked against @phoenix/core's Report contract
// (packages/core/src/contracts/report.ts) and PHX-REPORTS-001's own
// documented finding (see real-api-client.ts's BackendReport doc
// comment) before writing this file:
//   - There is NO `assessment_id` column on `reports` — a report is
//     scoped to an optional `asset_id` (present only when the
//     template's scope is 'SingleAsset'), never to an assessment
//     directly. The brief's suggested `assessmentId` response field is
//     therefore not produced anywhere in this module.
//
// ---- R1 correction: report_version / version ------------------------
// R0 omitted a `version` field/column entirely, reasoning that no such
// column existed in the pre-existing `reports` schema or in
// @phoenix/core's Report contract. ChatGPT architecture/QA review
// correctly rejected that reasoning: PHX-REPORTS-002's approved
// architecture explicitly proposed
// `reports.report_version INTEGER NOT NULL DEFAULT 1`, and the
// PHX-REPORTS-003 execution brief explicitly required version in the
// minimum persisted state, in validation, and in the API response —
// the column's absence from the pre-existing baseline was the exact
// gap this sprint's migration was supposed to close, not a reason to
// skip it. Migration 0004_report_version.sql adds
// `report_version INTEGER NOT NULL DEFAULT 1`. This file maps it to
// `version` at the ReportRequestRecord boundary (see mapReportRow()
// below) — the column name stays `report_version` (matching the
// approved architecture's exact wording) while every application-layer
// type/response uses `version`, matching the brief's exact wording.
// createReportRequest()'s INSERT never includes report_version in its
// column list — every row gets version 1 purely from the column's
// DEFAULT, never from anything client-supplied. See
// validation/schemas/report.schemas.ts's header for how a client
// attempting to send a `version` field is rejected before this
// function is ever reached.
// ============================================================

import type { Pool, PoolClient } from 'pg';
import { getDatabasePool } from '../db/client';

type Queryable = Pool | PoolClient;

// ---- report_templates read (existence + scope/format validation) ------

export interface ReportTemplateRecord {
  id: string;
  key: string;
  name: string;
  scope: 'SingleAsset' | 'Workspace' | 'CertificationPortfolio';
  outputFormats: string[];
}

interface ReportTemplateRow {
  id: string;
  key: string;
  name: string;
  scope: 'SingleAsset' | 'Workspace' | 'CertificationPortfolio';
  output_formats: string[];
}

/**
 * Fetches a single, non-deleted report_templates row by id. Returns
 * null if the template does not exist or has been soft-deleted — the
 * route layer maps that to 404 NOT_FOUND ("Report template not
 * found."), matching how assessments.ts's assetBelongsToWorkspace()/
 * assetVersionExists() checks are used.
 */
export async function reportTemplateById(templateId: string): Promise<ReportTemplateRecord | null> {
  const pool = getDatabasePool();
  const result = await pool.query<ReportTemplateRow>(
    `SELECT id, key, name, scope, output_formats
     FROM report_templates
     WHERE id = $1 AND deleted_at IS NULL
     LIMIT 1`,
    [templateId]
  );

  const row = result.rows[0];
  if (!row) return null;

  return {
    id: row.id,
    key: row.key,
    name: row.name,
    scope: row.scope,
    outputFormats: row.output_formats,
  };
}

// ---- Duplicate active request check -------------------------------------

/** Statuses per DATA_LIFECYCLE_PHX_PLATFORM_002.md §5 from which a report is still "in flight". This sprint only ever creates 'Requested' rows, but 'Generating' is included so this check remains correct once a later sprint adds generation. */
const ACTIVE_REPORT_STATUSES = ['Requested', 'Generating'] as const;

/**
 * True if an active (Requested/Generating), non-deleted report already
 * exists for this exact (workspaceId, templateId, assetId) combination.
 * `assetId` is compared with IS NOT DISTINCT FROM so two
 * Workspace/CertificationPortfolio-scope requests (assetId both NULL)
 * for the same template correctly collide, matching the partial unique
 * index added by migration 0003_report_request_constraints.sql — this
 * function is the same check performed at the application layer, ahead
 * of the insert, so the route can return a clear 409 CONFLICT instead
 * of a raw unique-violation database error on the common path. The
 * migration's index remains the authoritative, concurrency-safe
 * guarantee; this is a pre-check for a better error message only.
 */
export async function findActiveReportRequest(
  workspaceId: string,
  templateId: string,
  assetId: string | null
): Promise<{ id: string; status: string } | null> {
  const pool = getDatabasePool();
  const result = await pool.query<{ id: string; status: string }>(
    `SELECT id, status
     FROM reports
     WHERE workspace_id = $1
       AND template_id = $2
       AND asset_id IS NOT DISTINCT FROM $3
       AND status = ANY($4::text[])
       AND deleted_at IS NULL
     LIMIT 1`,
    [workspaceId, templateId, assetId, ACTIVE_REPORT_STATUSES as unknown as string[]]
  );

  return result.rows[0] ?? null;
}

// ---- Create report request ----------------------------------------------

export interface CreateReportRequestInput {
  workspaceId: string;
  templateId: string;
  /** Denormalized from report_templates.name at request time — see Report contract's `name` doc comment. */
  templateName: string;
  /** Present only when the template's scope is 'SingleAsset'; null otherwise. */
  assetId: string | null;
  requestedByUserId: string;
  format: string;
}

export interface ReportRequestRecord {
  id: string;
  workspaceId: string;
  templateId: string;
  name: string;
  status: string;
  assetId: string | null;
  requestedByUserId: string;
  requestedAt: string;
  generatedAt: string | null;
  fileUrl: string | null;
  format: string;
  expiresAt: string | null;
  failureReason: string | null;
  /** Maps report_version. Always 1 for every row this sprint's code creates — server/database-controlled via the column's DEFAULT 1, never client-supplied. See migration 0004_report_version.sql. */
  version: number;
  createdAt: string;
  updatedAt: string;
}

interface ReportRow {
  id: string;
  workspace_id: string;
  template_id: string;
  name: string;
  status: string;
  asset_id: string | null;
  requested_by_user_id: string;
  requested_at: string;
  generated_at: string | null;
  file_url: string | null;
  format: string;
  expires_at: string | null;
  failure_reason: string | null;
  report_version: number;
  created_at: string;
  updated_at: string;
}

function mapReportRow(row: ReportRow): ReportRequestRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    templateId: row.template_id,
    name: row.name,
    status: row.status,
    assetId: row.asset_id,
    requestedByUserId: row.requested_by_user_id,
    requestedAt: row.requested_at,
    generatedAt: row.generated_at,
    fileUrl: row.file_url,
    format: row.format,
    expiresAt: row.expires_at,
    failureReason: row.failure_reason,
    version: row.report_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Inserts one `reports` row in 'Requested' status. Callers must have
 * already validated (workspaceId, templateId, assetId) via
 * reportTemplateById() + assetBelongsToWorkspace()
 * (repositories/assessments.repository.ts) + findActiveReportRequest()
 * — this function performs only the insert, no re-validation. Accepts
 * an optional trailing `client` (db/transaction.ts's withTransaction())
 * so routes/reports.ts's POST handler can insert this row, its
 * activity_logs row, and its audit_records row inside one transaction,
 * exactly the same pattern as createAssessment() in
 * assessments.repository.ts.
 */
export async function createReportRequest(input: CreateReportRequestInput, client?: PoolClient): Promise<ReportRequestRecord> {
  const db: Queryable = client ?? getDatabasePool();

  // NOTE: report_version is deliberately absent from the INSERT column
  // list/VALUES below — it is never client-supplied or code-supplied
  // here. Every row gets version 1 purely from the column's own
  // DEFAULT 1 (migration 0004_report_version.sql). Do not add
  // report_version to this INSERT without a corresponding, deliberate
  // reason to let this code choose a version — doing so would defeat
  // the "server/database controlled" guarantee this was built for.
  const result = await db.query<ReportRow>(
    `INSERT INTO reports (
       workspace_id, template_id, name, status, asset_id,
       requested_by_user_id, requested_at, format
     )
     VALUES ($1, $2, $3, 'Requested', $4, $5, now(), $6)
     RETURNING
       id, workspace_id, template_id, name, status, asset_id,
       requested_by_user_id, requested_at, generated_at, file_url,
       format, expires_at, failure_reason, report_version, created_at,
       updated_at`,
    [input.workspaceId, input.templateId, input.templateName, input.assetId, input.requestedByUserId, input.format]
  );

  return mapReportRow(result.rows[0]);
}
