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
import { withTransaction } from '../db/transaction';
import { createReportJob } from './report-jobs.repository';
import { recordAudit, buildFieldChange, type AuditAction } from './audit.repository';

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

// ============================================================
// PHX-REPORTS-004 — Report Generation Lifecycle & Secure Artifact
// Delivery Foundation
// ------------------------------------------------------------
// Everything below this line is new for PHX-REPORTS-004. Nothing above
// this line was modified. Still parameterized-SQL-only, still no ORM.
//
// ---- Canonical report read model --------------------------------------
// CanonicalReportListItem is the ONE shape both list and detail return
// (task brief §4.11: "the canonical report read model must consistently
// expose..."). Deliberately mirrors BackendReport's field set
// (apps/platform/src/lib/real-api-client.ts) plus `version` — the same
// join shape (report_templates for templateName, users for
// requestedByDisplayName, a LEFT JOIN to assets for assetName) that
// previewGetReports() already uses for the vercel-supabase-preview
// direct-SQL read, kept consistent between the two paths.
//
// storage_key and any raw artifact-integrity field (sha256, etc.) are
// NEVER selected into this shape — see task brief §4.11, "storage key
// must never be part of public API responses". fileUrl is the internal
// authenticated download path (/api/reports/:id/download), set only
// once a report becomes Available (see completeReportGeneration()
// below) — never a raw storage key or filesystem path.
// ============================================================

export interface CanonicalReportListItem {
  id: string;
  workspaceId: string;
  templateId: string;
  templateName: string;
  name: string;
  status: string;
  assetId: string | null;
  assetName: string | null;
  requestedByUserId: string;
  requestedByDisplayName: string;
  requestedAt: string;
  generatedAt: string | null;
  fileUrl: string | null;
  format: string;
  expiresAt: string | null;
  failureReason: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

interface CanonicalReportRow {
  id: string;
  workspace_id: string;
  template_id: string;
  template_name: string;
  name: string;
  status: string;
  asset_id: string | null;
  asset_name: string | null;
  requested_by_user_id: string;
  requested_by_display_name: string;
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

function mapCanonicalReportRow(row: CanonicalReportRow): CanonicalReportListItem {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    templateId: row.template_id,
    templateName: row.template_name,
    name: row.name,
    status: row.status,
    assetId: row.asset_id,
    assetName: row.asset_name,
    requestedByUserId: row.requested_by_user_id,
    requestedByDisplayName: row.requested_by_display_name,
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

const CANONICAL_REPORT_SELECT = `
  SELECT
    r.id                     AS id,
    r.workspace_id           AS workspace_id,
    r.template_id            AS template_id,
    tpl.name                 AS template_name,
    r.name                   AS name,
    r.status                 AS status,
    r.asset_id               AS asset_id,
    ast.name                 AS asset_name,
    r.requested_by_user_id   AS requested_by_user_id,
    u.display_name           AS requested_by_display_name,
    r.requested_at           AS requested_at,
    r.generated_at           AS generated_at,
    r.file_url               AS file_url,
    r.format                 AS format,
    r.expires_at             AS expires_at,
    r.failure_reason         AS failure_reason,
    r.report_version         AS report_version,
    r.created_at             AS created_at,
    r.updated_at             AS updated_at
  FROM reports r
  JOIN report_templates tpl ON tpl.id = r.template_id
  JOIN users u ON u.id = r.requested_by_user_id
  LEFT JOIN assets ast ON ast.id = r.asset_id
`;

const REPORT_STATUSES = ['Requested', 'Generating', 'Available', 'Expired', 'Failed'] as const;
export type ReportStatusFilter = (typeof REPORT_STATUSES)[number];

function clampReportLimit(limit: number): number {
  if (!Number.isFinite(limit) || !Number.isInteger(limit)) return 25;
  if (limit < 1) return 1;
  if (limit > 100) return 100;
  return limit;
}

export interface ListReportsOptions {
  status?: ReportStatusFilter;
  limit: number;
}

/**
 * Lists reports for one workspace, newest first with a deterministic ID
 * tie-break (task brief §4.1), excluding soft-deleted rows. Callers MUST
 * call normalizeWorkspaceReportExpiry() (below) for this workspace
 * BEFORE calling this function, and apply any `status` filter only
 * AFTER that normalization has run — see routes/reports.ts's list
 * handler, which does exactly that in that order (Phase 1 Addendum A
 * §8: "status filter applied after normalization").
 */
export async function listReportsByWorkspace(
  workspaceId: string,
  options: ListReportsOptions
): Promise<{ items: CanonicalReportListItem[]; total: number }> {
  const pool = getDatabasePool();
  const limit = clampReportLimit(options.limit);

  const params: unknown[] = [workspaceId];
  const conditions = ['r.workspace_id = $1', 'r.deleted_at IS NULL'];

  if (options.status) {
    params.push(options.status);
    conditions.push(`r.status = $${params.length}`);
  }

  params.push(limit);
  const limitParamIndex = params.length;

  const result = await pool.query<CanonicalReportRow>(
    `${CANONICAL_REPORT_SELECT}
     WHERE ${conditions.join(' AND ')}
     ORDER BY r.created_at DESC, r.id DESC
     LIMIT $${limitParamIndex}`,
    params
  );

  const items = result.rows.map(mapCanonicalReportRow);
  return { items, total: items.length };
}

/**
 * Fetches one report by id in the canonical read model, or null if it
 * does not exist / is soft-deleted. Callers MUST call
 * normalizeSingleReportExpiry() for this report id BEFORE calling this
 * function (see routes/reports.ts's detail/download handlers).
 */
export async function getReportById(reportId: string): Promise<CanonicalReportListItem | null> {
  const pool = getDatabasePool();
  const result = await pool.query<CanonicalReportRow>(
    `${CANONICAL_REPORT_SELECT}
     WHERE r.id = $1 AND r.deleted_at IS NULL
     LIMIT 1`,
    [reportId]
  );
  const row = result.rows[0];
  return row ? mapCanonicalReportRow(row) : null;
}

/**
 * Minimal ownership-context read for the report-generate route's
 * pre-transaction permission/ownership check (see
 * auth/ownership.ts's ReportOwnershipContext). This is a plain,
 * non-locking read used ONLY to decide whether to attempt the
 * transition at all — the actual, authoritative status check happens
 * inside transitionReportToGenerating()'s own `SELECT ... FOR UPDATE`
 * in the same transaction as the write. requestedByUserId never changes
 * for a report row regardless of status, so a stale pre-check read never
 * produces an incorrect ownership decision.
 */
export async function getReportOwnershipContext(
  reportId: string
): Promise<{ reportId: string; workspaceId: string; requestedByUserId: string; status: string } | null> {
  const pool = getDatabasePool();
  const result = await pool.query<{ id: string; workspace_id: string; requested_by_user_id: string; status: string }>(
    `SELECT id, workspace_id, requested_by_user_id, status
     FROM reports
     WHERE id = $1 AND deleted_at IS NULL
     LIMIT 1`,
    [reportId]
  );
  const row = result.rows[0];
  if (!row) return null;
  return { reportId: row.id, workspaceId: row.workspace_id, requestedByUserId: row.requested_by_user_id, status: row.status };
}

// ---- Lazy expiry (Phase 1 Addendum A §8) ---------------------------------

/**
 * Normalizes every Available -> Expired transition for an entire
 * workspace in ONE batched statement (a single UPDATE ... RETURNING
 * piped into a single INSERT ... SELECT for the audit rows), run
 * unconditionally before the list endpoint's paginated SELECT —
 * regardless of whether the caller passed a `status` filter. This is
 * deliberately NOT one transaction per affected row, and NOT one
 * transaction per listed row — a single round-trip pair, regardless of
 * how many reports in the workspace actually expired on this call.
 * actor_user_id is NULL (system/automatic transition, not
 * request-triggered) per Phase 1 Addendum A §2.
 */
export async function normalizeWorkspaceReportExpiry(workspaceId: string): Promise<void> {
  await withTransaction(async (client) => {
    await client.query(
      `WITH expired AS (
         UPDATE reports
         SET status = 'Expired', updated_at = now()
         WHERE workspace_id = $1
           AND status = 'Available'
           AND expires_at <= now()
           AND deleted_at IS NULL
         RETURNING id
       )
       INSERT INTO audit_records (workspace_id, actor_user_id, action, entity_type, entity_id, changes, context)
       SELECT $1, NULL, 'report.expired', 'Report', expired.id,
              '{"status": ["Available", "Expired"]}'::jsonb, NULL
       FROM expired`,
      [workspaceId]
    );
  });
}

/** Single-report version of normalizeWorkspaceReportExpiry() — used by detail/download, which are inherently single-row (trivially "a batch of one"). Same audit shape, same NULL system actor. */
export async function normalizeSingleReportExpiry(reportId: string): Promise<void> {
  await withTransaction(async (client) => {
    await client.query(
      `WITH expired AS (
         UPDATE reports
         SET status = 'Expired', updated_at = now()
         WHERE id = $1
           AND status = 'Available'
           AND expires_at <= now()
           AND deleted_at IS NULL
         RETURNING id, workspace_id
       )
       INSERT INTO audit_records (workspace_id, actor_user_id, action, entity_type, entity_id, changes, context)
       SELECT expired.workspace_id, NULL, 'report.expired', 'Report', expired.id,
              '{"status": ["Available", "Expired"]}'::jsonb, NULL
       FROM expired`,
      [reportId]
    );
  });
}

// ---- Generate / retry / regenerate transition ----------------------------

export type GenerateTransitionOutcome =
  | { outcome: 'started'; version: number }
  | { outcome: 'retried'; version: number }
  | { outcome: 'regenerated'; version: number }
  | { outcome: 'conflict'; currentStatus: string }
  | { outcome: 'not-found' };

/**
 * Performs the Requested/Failed/Expired -> Generating transition plus
 * the matching report_generation_jobs insert, inside ONE transaction
 * (task brief §4.2: "transition and job creation must be atomic in one
 * transaction"). Locks the report row with `SELECT ... FOR UPDATE`
 * first, so two concurrent calls for the same report serialize — the
 * second sees the already-updated status and returns 'conflict', never
 * creating a second job (migration 0005's partial unique index is the
 * second, independent guarantee).
 *
 * Callers (routes/reports.ts) must have already resolved+checked the
 * actor's permission AND ownership (via requirePermission() +
 * requireReportOwnership()) before calling this — this function
 * performs only the transition itself, no auth.
 */
export async function transitionReportToGenerating(
  reportId: string,
  actorUserId: string
): Promise<GenerateTransitionOutcome> {
  return withTransaction(async (client) => {
    const lockedResult = await client.query<{
      id: string;
      workspace_id: string;
      status: string;
      report_version: number;
    }>(`SELECT id, workspace_id, status, report_version FROM reports WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, [reportId]);

    const locked = lockedResult.rows[0];
    if (!locked) return { outcome: 'not-found' };

    if (locked.status === 'Generating' || locked.status === 'Available') {
      return { outcome: 'conflict', currentStatus: locked.status };
    }

    if (locked.status !== 'Requested' && locked.status !== 'Failed' && locked.status !== 'Expired') {
      // Defensive — no other status value exists in this lifecycle, but
      // this branch keeps the function total rather than assuming.
      return { outcome: 'conflict', currentStatus: locked.status };
    }

    const isInitialStart = locked.status === 'Requested';
    const newVersion = isInitialStart ? locked.report_version : locked.report_version + 1;

    await client.query(
      `UPDATE reports
       SET status = 'Generating',
           report_version = $2,
           failure_reason = NULL,
           generated_at = NULL,
           file_url = NULL,
           expires_at = NULL,
           updated_at = now()
       WHERE id = $1`,
      [reportId, newVersion]
    );

    await createReportJob({ reportId, reportVersion: newVersion }, client);

    const auditAction: AuditAction = isInitialStart
      ? 'report.generation.started'
      : locked.status === 'Failed'
        ? 'report.generation.retried'
        : 'report.regenerated';

    await recordAudit(
      {
        workspaceId: locked.workspace_id,
        actorUserId,
        action: auditAction,
        entityType: 'Report',
        entityId: reportId,
        changes: {
          status: [locked.status, 'Generating'],
          ...(isInitialStart ? {} : buildFieldChange('version', locked.report_version, newVersion)),
        },
      },
      client
    );

    if (isInitialStart) return { outcome: 'started', version: newVersion };
    return { outcome: locked.status === 'Failed' ? 'retried' : 'regenerated', version: newVersion };
  });
}

// ---- Integrity-failure self-healing transition (Phase 1 Addendum B §3/§4) --

export type IntegrityFailureTransitionOutcome = 'transitioned' | 'already-changed';

/**
 * Atomically transitions a report from Available -> Failed when its
 * stored artifact is found to be missing, size-mismatched, or
 * checksum-invalid (only ever called from the download endpoint, which
 * is the only place artifact bytes are actually read — see task brief
 * §4.9 and Phase 1 Addendum B §3's documented scope decision). Fenced
 * by `report_version` so a concurrent state change (e.g. the report was
 * already retried by another request) is never silently overwritten —
 * per execution control #9, a zero-row result means another process
 * already changed the report; this function reports that back as
 * 'already-changed' rather than raising an error, and the caller must
 * reload current state and send no artifact bytes either way.
 *
 * `sanitizedReason` must never include the storage key, filesystem
 * path, expected/actual size, or expected/actual checksum — see the
 * call site in routes/reports.ts for the exact fixed string used.
 */
export async function transitionAvailableReportToIntegrityFailure(
  reportId: string,
  expectedVersion: number,
  sanitizedReason: string
): Promise<IntegrityFailureTransitionOutcome> {
  return withTransaction(async (client) => {
    const result = await client.query<{ workspace_id: string }>(
      `UPDATE reports
       SET status = 'Failed', failure_reason = $3, updated_at = now()
       WHERE id = $1 AND status = 'Available' AND report_version = $2
       RETURNING workspace_id`,
      [reportId, expectedVersion, sanitizedReason]
    );

    const row = result.rows[0];
    if (!row) return 'already-changed';

    await recordAudit(
      {
        workspaceId: row.workspace_id,
        actorUserId: null,
        action: 'report.generation.failed',
        entityType: 'Report',
        entityId: reportId,
        changes: { status: ['Available', 'Failed'] },
        context: 'Artifact integrity verification failed at download time.',
      },
      client
    );

    return 'transitioned';
  });
}

// ---- Worker-facing generation context + fenced completion/failure -------

export interface ReportGenerationContext {
  id: string;
  workspaceId: string;
  templateKey: string;
  assetId: string | null;
  format: 'pdf' | 'html' | 'csv';
  name: string;
  reportVersion: number;
  requestedByUserId: string;
}

/** Minimal fields the generation service needs to render + store a report's artifact. Not the public canonical read model (that's CanonicalReportListItem above) — this is a worker-internal shape. */
export async function getReportGenerationContext(reportId: string): Promise<ReportGenerationContext | null> {
  const pool = getDatabasePool();
  const result = await pool.query<{
    id: string;
    workspace_id: string;
    template_key: string;
    asset_id: string | null;
    format: 'pdf' | 'html' | 'csv';
    name: string;
    report_version: number;
    requested_by_user_id: string;
  }>(
    `SELECT r.id, r.workspace_id, tpl.key AS template_key, r.asset_id, r.format, r.name, r.report_version, r.requested_by_user_id
     FROM reports r
     JOIN report_templates tpl ON tpl.id = r.template_id
     WHERE r.id = $1 AND r.deleted_at IS NULL
     LIMIT 1`,
    [reportId]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    templateKey: row.template_key,
    assetId: row.asset_id,
    format: row.format,
    name: row.name,
    reportVersion: row.report_version,
    requestedByUserId: row.requested_by_user_id,
  };
}

/**
 * Fenced Generating -> Available transition, called by the generation
 * service ONLY after artifact bytes have already been durably stored
 * (task brief §4.7's ordering) and BEFORE the artifact_metadata insert
 * within the same transaction (see services/report-generation.service.ts)
 * — fenced by report_version so a lease-lost/duplicate worker can never
 * mark a report Available out from under a newer generation attempt.
 * Returns null if the fencing condition did not match (report already
 * changed) — caller must then roll back and treat this as a lost race
 * (Phase 1 Addendum A §3), never proceeding to the artifact-metadata
 * insert or job-completion write.
 */
export async function completeReportGeneration(
  client: PoolClient,
  input: { reportId: string; expectedVersion: number; retentionSeconds: number }
): Promise<{ workspaceId: string } | null> {
  const result = await client.query<{ workspace_id: string }>(
    `UPDATE reports
     SET status = 'Available',
         generated_at = now(),
         file_url = '/api/reports/' || id || '/download',
         expires_at = now() + ($3 * interval '1 second'),
         updated_at = now()
     WHERE id = $1 AND status = 'Generating' AND report_version = $2
     RETURNING workspace_id`,
    [input.reportId, input.expectedVersion, input.retentionSeconds]
  );
  const row = result.rows[0];
  return row ? { workspaceId: row.workspace_id } : null;
}

/**
 * Fenced Generating -> Failed transition for a TERMINAL worker failure
 * (attempts exhausted through the normal render/store failure path —
 * distinct from finalizeExhaustedStaleJob()'s stale-lease path in
 * report-jobs.repository.ts, though both end at the same report state).
 * Returns null if the fencing condition did not match (report already
 * changed) — caller must not then write a false audit row for a
 * transition that did not happen.
 */
export async function failReportGeneration(
  client: PoolClient,
  input: { reportId: string; expectedVersion: number; sanitizedReason: string }
): Promise<{ workspaceId: string } | null> {
  const result = await client.query<{ workspace_id: string }>(
    `UPDATE reports
     SET status = 'Failed', failure_reason = $3, updated_at = now()
     WHERE id = $1 AND status = 'Generating' AND report_version = $2
     RETURNING workspace_id`,
    [input.reportId, input.expectedVersion, input.sanitizedReason]
  );
  const row = result.rows[0];
  return row ? { workspaceId: row.workspace_id } : null;
}
