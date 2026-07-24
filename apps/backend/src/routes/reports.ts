// ============================================================
// Phoenix Backend — Reports Routes
// PHX-BACKEND-001 — Backend Foundation & Database Skeleton
// PHX-REPORTS-003 — Report Request API & State Model
// PHX-REPORTS-003-R1 — adds report_version/version to the created-row
// response (migration 0004_report_version.sql); no route-level change
// beyond that was required — see reports.repository.ts's ReportRequestRecord.
// ------------------------------------------------------------
// GET .../reports, GET/POST .../reports/:reportId(/generate|/download)
// remain the PHX-BACKEND-001 501 stubs — this sprint does not touch
// them (per task brief: "Do not expand the sprint to reimplement live
// reports read"; the live read for GET .../reports is
// previewGetReports() in apps/platform/src/lib/preview-api-client.
// server.ts, vercel-supabase-preview mode only, PHX-REPORTS-001 —
// unrelated to this Express route, which stays a stub in every mode).
//
// POST /api/workspaces/:workspaceId/reports is the one route this
// sprint implements for real: the first production write endpoint for
// Phoenix Reports. Creates one `reports` row in 'Requested' status.
// No queue, no worker, no PDF/export, no other status is ever written
// by this route — see repositories/reports.repository.ts's file
// header for the full schema-vs-brief field mapping.
//
// ---- Ordering (same contract as routes/assessments.ts's POST
//      .../assessments, PHX-BACKEND-006/007) --------------------------
//   1. path params validated (400)
//   2. x-phoenix-user-id header validated for presence/shape (401/400)
//      — before any database call
//   3. request body validated with Zod (400) — also before any
//      database call
//   4. requireDatabase() (503)
//   5. workspace existence checked (404)
//   6. requirePermission() — resolves the actor for this workspace and
//      enforces reports.generate (401/403)
//   7. report template existence checked (404)
//   8. template scope vs. assetId business rule enforced (400) — see
//      "Scope vs. assetId" below
//   9. asset existence/workspace-membership checked, when assetId is
//      present (404)
//  10. format resolved/validated against the template's supported
//      output formats (400 invalid / 409 template has none)
//  11. duplicate active request checked (409 CONFLICT)
//  12. the actual insert, plus an activity_logs row and an
//      audit_records row, wrapped in one database transaction via
//      db/transaction.ts's withTransaction() — same pattern as
//      routes/assessments.ts's POST .../assessments
//
// ---- Scope vs. assetId --------------------------------------------
// report_templates.scope is 'SingleAsset' | 'Workspace' |
// 'CertificationPortfolio' (db/migrations/0001_initial_schema.sql).
// Per the Report contract's doc comment ("assetId — Present when
// scope is SingleAsset"), this route requires assetId when the
// resolved template's scope is 'SingleAsset', and rejects it (400)
// when the scope is 'Workspace' or 'CertificationPortfolio' — this
// is a business rule that needs the template row from the database,
// so it is enforced here, not in validation/schemas/report.schemas.ts
// (which only validates assetId's shape, since it's optional at the
// shape level — see that file's header).
//
// ---- reports.generate permission — activity + audit pairing -------
// The task brief's Audit section only asks for a `report.requested`
// audit_records row. This route also writes an activity_logs row
// (`ReportRequested`, matching the system event name in
// docs/platform/DATA_LIFECYCLE_PHX_PLATFORM_002.md §5's Report
// Lifecycle table) — an addition beyond the brief's literal listing,
// made to match the established, unbroken invariant every other write
// route in this backend follows (assessments.ts's create/submit,
// evidence add/update/delete all pair activity + audit inside one
// transaction). Without it, report requests would be the only write
// in this backend invisible to the Activity feed. No new
// infrastructure was needed for this — recordActivity() already
// exists and is called exactly as every other write route calls it.
// ============================================================

import { Router } from 'express';
import { asyncHandler, getRequestId } from '../lib/http';
import { ApiErrorCodes, failure, success } from '../contracts/api-response';
import { requireDatabase } from '../middleware/database-required';
import { workspaceExists } from '../repositories/workspaces.repository';
import { assetBelongsToWorkspace } from '../repositories/assessments.repository';
import {
  createReportRequest,
  findActiveReportRequest,
  reportTemplateById,
  getReportById,
  getReportOwnershipContext,
  listReportsByWorkspace,
  normalizeSingleReportExpiry,
  normalizeWorkspaceReportExpiry,
  transitionAvailableReportToIntegrityFailure,
  transitionReportToGenerating,
  type ReportRequestRecord,
} from '../repositories/reports.repository';
import { getReportArtifact } from '../repositories/report-artifacts.repository';
import { getReportArtifactStore } from '../storage/report-artifact-store';
import { getReportWorkerConfig } from '../config/report-worker-env';
import { withTransaction } from '../db/transaction';
import { recordActivity } from '../repositories/activity.repository';
import { buildFieldChange, recordAudit } from '../repositories/audit.repository';
import { parseWorkspaceId, parseReportId, parseReportListQuery } from '../validation/route-params';
import { parseBodyWithSchema } from '../validation/zod-response';
import { sendValidationError } from '../validation/validation-response';
import { CreateReportRequestBodySchema } from '../validation/schemas/report.schemas';
import { getRequestUserId, requirePermission } from '../auth/request-actor';
import { requireReportOwnership } from '../auth/ownership-guards';

/** True if `err` is a `pg` unique-violation error (SQLSTATE 23505) — see the try/catch around withTransaction() below. */
function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}

export const reportsRouter = Router();

// ============================================================
// GET /api/workspaces/:workspaceId/reports
// PHX-REPORTS-004 — real implementation, replacing the PHX-BACKEND-001
// stub. Active workspace membership required; all six roles may read
// (task brief §4.1 — there is no dedicated report-read permission,
// matching how every other universally-readable resource in this
// backend is gated: resolveRequestActor()'s active-membership check
// alone, same as e.g. assessment reads' effective behavior for a role
// that carries assessment.read, which every role does).
//
// Lazy expiry (Phase 1 Addendum A §8): normalizeWorkspaceReportExpiry()
// runs UNCONDITIONALLY before the paginated read, regardless of
// whether `status` was supplied — so a report that expires as part of
// THIS request is correctly reflected in whichever status the caller
// filtered by, never based on a stale pre-normalization snapshot.
// ============================================================
reportsRouter.get(
  '/workspaces/:workspaceId/reports',
  asyncHandler(async (req, res) => {
    const workspaceId = parseWorkspaceId(req, res);
    if (workspaceId === null) return;

    if ((await getRequestUserId(req, res)) === null) return;

    const query = parseReportListQuery(req, res);
    if (query === null) return;

    if (!(await requireDatabase(res))) return;

    if (!(await workspaceExists(workspaceId))) {
      res.status(404).json(failure(ApiErrorCodes.NOT_FOUND, 'Workspace not found.', getRequestId(res)));
      return;
    }

    // 'workspace.read' — every role carries this (see
    // auth/permissions.ts) — matches "all six workspace roles may
    // read" exactly; there is no reports-specific read permission.
    const actor = await requirePermission(req, res, workspaceId, 'workspace.read');
    if (!actor) return;

    await normalizeWorkspaceReportExpiry(workspaceId);

    const { items, total } = await listReportsByWorkspace(workspaceId, {
      status: query.status as never,
      limit: query.limit,
    });

    res.status(200).json(success({ items, total, cursor: null }, getRequestId(res)));
  })
);

// POST /api/workspaces/:workspaceId/reports
// PHX-REPORTS-003: requires actor + reports.generate. actor.userId is
// used as requestedByUserId unconditionally — there is no
// client-supplied "requestedByUserId" field in
// CreateReportRequestBodySchema at all (unlike the PHX-BACKEND-005-era
// assessment/evidence schemas' now-vestigial optional
// requestedByUserId/uploadedByUserId fields) — this sprint has a real
// actor from the start, so that placeholder pattern was never
// introduced here.
reportsRouter.post(
  '/workspaces/:workspaceId/reports',
  asyncHandler(async (req, res) => {
    const workspaceId = parseWorkspaceId(req, res);
    if (workspaceId === null) return;

    if ((await getRequestUserId(req, res)) === null) return;

    const body = parseBodyWithSchema(CreateReportRequestBodySchema, req.body, res);
    if (body === null) return;

    if (!(await requireDatabase(res))) return;

    if (!(await workspaceExists(workspaceId))) {
      res.status(404).json(failure(ApiErrorCodes.NOT_FOUND, 'Workspace not found.', getRequestId(res)));
      return;
    }

    const actor = await requirePermission(req, res, workspaceId, 'reports.generate');
    if (!actor) return;

    const template = await reportTemplateById(body.templateId);
    if (!template) {
      res
        .status(404)
        .json(failure(ApiErrorCodes.NOT_FOUND, 'Report template not found.', getRequestId(res)));
      return;
    }

    // ---- Scope vs. assetId (see file header) ----
    if (template.scope === 'SingleAsset') {
      if (!body.assetId) {
        sendValidationError(res, {
          field: 'assetId',
          code: 'required',
          message: `Report template "${template.key}" has scope SingleAsset and requires assetId.`,
        });
        return;
      }

      if (!(await assetBelongsToWorkspace(body.assetId, workspaceId))) {
        res
          .status(404)
          .json(failure(ApiErrorCodes.NOT_FOUND, 'Asset not found in this workspace.', getRequestId(res)));
        return;
      }
    } else if (body.assetId) {
      sendValidationError(res, {
        field: 'assetId',
        code: 'not_allowed',
        message: `Report template "${template.key}" has scope ${template.scope} and does not accept assetId.`,
      });
      return;
    }

    const assetId = template.scope === 'SingleAsset' ? (body.assetId as string) : null;

    // ---- Format resolution/validation ----
    if (template.outputFormats.length === 0) {
      res
        .status(409)
        .json(
          failure(
            ApiErrorCodes.CONFLICT,
            `Report template "${template.key}" has no supported output formats configured.`,
            getRequestId(res)
          )
        );
      return;
    }

    if (body.format && !template.outputFormats.includes(body.format)) {
      sendValidationError(res, {
        field: 'format',
        code: 'invalid_enum_value',
        message: `Report template "${template.key}" does not support format "${body.format}". Supported: ${template.outputFormats.join(', ')}.`,
      });
      return;
    }

    const format = body.format ?? template.outputFormats[0];

    // ---- Duplicate active request ----
    const existingActive = await findActiveReportRequest(workspaceId, body.templateId, assetId);
    if (existingActive) {
      res
        .status(409)
        .json(
          failure(
            ApiErrorCodes.CONFLICT,
            'An active report request already exists for this template and asset.',
            getRequestId(res),
            { existingReportId: existingActive.id, existingStatus: existingActive.status }
          )
        );
      return;
    }

    let created: ReportRequestRecord;
    try {
      created = await withTransaction(async (client) => {
        const report = await createReportRequest(
          {
            workspaceId,
            templateId: body.templateId,
            templateName: template.name,
            assetId,
            requestedByUserId: actor.userId,
            format,
          },
          client
        );

        await recordActivity(
          {
            workspaceId,
            actorUserId: actor.userId,
            actorDisplayName: actor.name,
            type: 'ReportRequested',
            summary: `Requested report "${template.name}".`,
            relatedEntityType: 'Report',
            relatedEntityId: report.id,
          },
          client
        );

        await recordAudit(
          {
            workspaceId,
            actorUserId: actor.userId,
            action: 'report.requested',
            entityType: 'Report',
            entityId: report.id,
            changes: buildFieldChange('status', null, report.status),
          },
          client
        );

        return report;
      });
    } catch (err) {
      // Rare race: a second concurrent request for the same
      // (workspace, template, asset) passed the findActiveReportRequest()
      // pre-check above before this one committed. migration
      // 0003_report_request_constraints.sql's uq_reports_active_request
      // partial unique index is the actual guarantee here — the
      // pre-check only gives a clean error message on the common,
      // non-racing path. Postgres reports this as error code 23505
      // (unique_violation); anything else is rethrown and handled by
      // asyncHandler's default 500 path, unchanged.
      if (isUniqueViolation(err)) {
        res
          .status(409)
          .json(
            failure(
              ApiErrorCodes.CONFLICT,
              'An active report request already exists for this template and asset.',
              getRequestId(res)
            )
          );
        return;
      }
      throw err;
    }

    res.status(201).json(success(created, getRequestId(res)));
  })
);

// ============================================================
// GET /api/reports/:reportId
// PHX-REPORTS-004 — real implementation. Report -> workspace resolved
// FIRST (never trusting a path-supplied report id alone without
// resolving workspace membership — task brief §6), then
// requirePermission() is checked against THAT workspace, exactly
// matching routes/assessments.ts's GET /api/assessments/:assessmentId
// pattern. Lazy expiry (single-report batch, Phase 1 Addendum A §8)
// runs before the read.
// ============================================================
reportsRouter.get(
  '/reports/:reportId',
  asyncHandler(async (req, res) => {
    const reportId = parseReportId(req, res);
    if (reportId === null) return;

    if ((await getRequestUserId(req, res)) === null) return;

    if (!(await requireDatabase(res))) return;

    const ownership = await getReportOwnershipContext(reportId);
    if (!ownership) {
      res.status(404).json(failure(ApiErrorCodes.NOT_FOUND, 'Report not found.', getRequestId(res)));
      return;
    }

    const actor = await requirePermission(req, res, ownership.workspaceId, 'workspace.read');
    if (!actor) return;

    await normalizeSingleReportExpiry(reportId);

    const report = await getReportById(reportId);
    if (!report) {
      res.status(404).json(failure(ApiErrorCodes.NOT_FOUND, 'Report not found.', getRequestId(res)));
      return;
    }

    res.status(200).json(success(report, getRequestId(res)));
  })
);

// ============================================================
// POST /api/reports/:reportId/generate
// PHX-REPORTS-004 — starts, retries, or regenerates a report
// (Requested/Failed/Expired -> Generating), creating a database-backed
// generation job in the same transaction as the status transition
// (task brief §4.2).
//
// Ordering: requirePermission('reports.generate') FIRST (rejects
// Viewer/Auditor before any ownership check — matches
// ownership-guards.ts's established contract), THEN
// requireReportOwnership() — Contributor own-only for ALL THREE
// transitions (Phase 1 Addendum A §1's correction; NOT just
// retry/regenerate).
//
// Client may not supply version/status/storage/timestamp fields — this
// endpoint takes no request body at all, so there is nothing to
// validate/reject at the schema level; the transition/version is
// entirely server-resolved inside transitionReportToGenerating().
// ============================================================
reportsRouter.post(
  '/reports/:reportId/generate',
  asyncHandler(async (req, res) => {
    const reportId = parseReportId(req, res);
    if (reportId === null) return;

    if ((await getRequestUserId(req, res)) === null) return;

    if (!(await requireDatabase(res))) return;

    const ownership = await getReportOwnershipContext(reportId);
    if (!ownership) {
      res.status(404).json(failure(ApiErrorCodes.NOT_FOUND, 'Report not found.', getRequestId(res)));
      return;
    }

    const actor = await requirePermission(req, res, ownership.workspaceId, 'reports.generate');
    if (!actor) return;

    if (!requireReportOwnership(actor, ownership, res)) return;

    const outcome = await transitionReportToGenerating(reportId, actor.userId);

    if (outcome.outcome === 'not-found') {
      res.status(404).json(failure(ApiErrorCodes.NOT_FOUND, 'Report not found.', getRequestId(res)));
      return;
    }

    if (outcome.outcome === 'conflict') {
      res
        .status(409)
        .json(
          failure(
            ApiErrorCodes.CONFLICT,
            `Report cannot be generated from its current status (${outcome.currentStatus}).`,
            getRequestId(res)
          )
        );
      return;
    }

    const report = await getReportById(reportId);
    res.status(202).json(success(report, getRequestId(res)));
  })
);

// ============================================================
// GET /api/reports/:reportId/download
// PHX-REPORTS-004 — authenticated, integrity-verified artifact
// delivery. Never exposes a raw storage key or filesystem path.
//
// Order (Phase 1 Addendum B §4, corrected sequence):
//   1. Resolve + normalize expiry, confirm status is Available
//      (otherwise the existing 409 fires, per task brief §4.9, before
//      any artifact I/O).
//   2. Load report_artifacts metadata.
//   3. Read the full (already size-bounded) artifact into memory.
//   4. Verify size_bytes, then SHA-256.
//   5. On ANY failure from 2-4: transitionAvailableReportToIntegrityFailure()
//      (Available -> Failed, sanitized reason, actor null, audited) and
//      respond with the SAME sanitized 409 the brief already defines
//      for a non-Available report — accurate, since the report's status
//      genuinely is Failed by the time this response is written. No
//      artifact bytes are ever sent in this path.
//   6. Only if every check passes: build and send the actual download
//      response.
//
// Execution control #9: if the integrity-failure transition itself
// affects zero report rows (another process already changed the report
// concurrently — e.g. it was already retried), this handler reloads
// current state and sends no artifact bytes either way, rather than
// overwriting whatever the newer state is.
// ============================================================
reportsRouter.get(
  '/reports/:reportId/download',
  asyncHandler(async (req, res) => {
    const reportId = parseReportId(req, res);
    if (reportId === null) return;

    if ((await getRequestUserId(req, res)) === null) return;

    if (!(await requireDatabase(res))) return;

    const ownership = await getReportOwnershipContext(reportId);
    if (!ownership) {
      res.status(404).json(failure(ApiErrorCodes.NOT_FOUND, 'Report not found.', getRequestId(res)));
      return;
    }

    const actor = await requirePermission(req, res, ownership.workspaceId, 'workspace.read');
    if (!actor) return;

    await normalizeSingleReportExpiry(reportId);

    const report = await getReportById(reportId);
    if (!report) {
      res.status(404).json(failure(ApiErrorCodes.NOT_FOUND, 'Report not found.', getRequestId(res)));
      return;
    }

    if (report.status !== 'Available') {
      res
        .status(409)
        .json(
          failure(
            ApiErrorCodes.CONFLICT,
            `Report is not available for download (status: ${report.status}).`,
            getRequestId(res)
          )
        );
      return;
    }

    async function sendIntegrityFailureAndReload(sanitizedReason: string): Promise<void> {
      await transitionAvailableReportToIntegrityFailure(reportId as string, report!.version, sanitizedReason);
      // Execution control #9 — reload current state and send no
      // artifact bytes, regardless of whether the transition above
      // actually applied (it may have found the report already changed
      // by a concurrent process; either way, the CURRENT state is what
      // this response must reflect, never the state from before this
      // request started).
      const current = await getReportById(reportId as string);
      const currentStatus = current?.status ?? 'Failed';
      res
        .status(409)
        .json(
          failure(
            ApiErrorCodes.CONFLICT,
            `Report is not available for download (status: ${currentStatus}).`,
            getRequestId(res)
          )
        );
    }

    const artifact = await getReportArtifact(reportId, report.version);
    if (!artifact) {
      await sendIntegrityFailureAndReload(
        'The stored report file could not be found and generation has been marked as failed. Please retry.'
      );
      return;
    }

    const { maxArtifactBytes } = getReportWorkerConfig();
    const store = getReportArtifactStore();

    let bytes: Buffer;
    try {
      bytes = await store.readAll({ key: artifact.storageKey, maxBytes: maxArtifactBytes });
    } catch {
      await sendIntegrityFailureAndReload(
        'The stored report file could not be read and generation has been marked as failed. Please retry.'
      );
      return;
    }

    if (bytes.byteLength !== artifact.sizeBytes) {
      await sendIntegrityFailureAndReload(
        'The stored report file size could not be verified and generation has been marked as failed. Please retry.'
      );
      return;
    }

    const { createHash } = await import('node:crypto');
    const actualSha256 = createHash('sha256').update(bytes).digest('hex');
    if (actualSha256 !== artifact.sha256) {
      await sendIntegrityFailureAndReload(
        'The stored report file integrity could not be verified and generation has been marked as failed. Please retry.'
      );
      return;
    }

    // Every verification passed — build and send the actual response.
    // Filename is sanitized (no path separators, no raw user input —
    // derived entirely from server-controlled report name/format).
    const safeBaseName = report.name.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80) || 'report';
    const filename = `${safeBaseName}.${report.format}`;

    res.status(200);
    res.setHeader('Content-Type', artifact.contentType);
    res.setHeader('Content-Length', String(bytes.byteLength));
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(bytes);
  })
);
// PHX-REPORTS-003: requires actor + reports.generate. actor.userId is
// used as requestedByUserId unconditionally — there is no
// client-supplied "requestedByUserId" field in
// CreateReportRequestBodySchema at all (unlike the PHX-BACKEND-005-era
// assessment/evidence schemas' now-vestigial optional
// requestedByUserId/uploadedByUserId fields) — this sprint has a real
// actor from the start, so that placeholder pattern was never
// introduced here.
reportsRouter.post(
  '/workspaces/:workspaceId/reports',
  asyncHandler(async (req, res) => {
    const workspaceId = parseWorkspaceId(req, res);
    if (workspaceId === null) return;

    if ((await getRequestUserId(req, res)) === null) return;

    const body = parseBodyWithSchema(CreateReportRequestBodySchema, req.body, res);
    if (body === null) return;

    if (!(await requireDatabase(res))) return;

    if (!(await workspaceExists(workspaceId))) {
      res.status(404).json(failure(ApiErrorCodes.NOT_FOUND, 'Workspace not found.', getRequestId(res)));
      return;
    }

    const actor = await requirePermission(req, res, workspaceId, 'reports.generate');
    if (!actor) return;

    const template = await reportTemplateById(body.templateId);
    if (!template) {
      res
        .status(404)
        .json(failure(ApiErrorCodes.NOT_FOUND, 'Report template not found.', getRequestId(res)));
      return;
    }

    // ---- Scope vs. assetId (see file header) ----
    if (template.scope === 'SingleAsset') {
      if (!body.assetId) {
        sendValidationError(res, {
          field: 'assetId',
          code: 'required',
          message: `Report template "${template.key}" has scope SingleAsset and requires assetId.`,
        });
        return;
      }

      if (!(await assetBelongsToWorkspace(body.assetId, workspaceId))) {
        res
          .status(404)
          .json(failure(ApiErrorCodes.NOT_FOUND, 'Asset not found in this workspace.', getRequestId(res)));
        return;
      }
    } else if (body.assetId) {
      sendValidationError(res, {
        field: 'assetId',
        code: 'not_allowed',
        message: `Report template "${template.key}" has scope ${template.scope} and does not accept assetId.`,
      });
      return;
    }

    const assetId = template.scope === 'SingleAsset' ? (body.assetId as string) : null;

    // ---- Format resolution/validation ----
    if (template.outputFormats.length === 0) {
      res
        .status(409)
        .json(
          failure(
            ApiErrorCodes.CONFLICT,
            `Report template "${template.key}" has no supported output formats configured.`,
            getRequestId(res)
          )
        );
      return;
    }

    if (body.format && !template.outputFormats.includes(body.format)) {
      sendValidationError(res, {
        field: 'format',
        code: 'invalid_enum_value',
        message: `Report template "${template.key}" does not support format "${body.format}". Supported: ${template.outputFormats.join(', ')}.`,
      });
      return;
    }

    const format = body.format ?? template.outputFormats[0];

    // ---- Duplicate active request ----
    const existingActive = await findActiveReportRequest(workspaceId, body.templateId, assetId);
    if (existingActive) {
      res
        .status(409)
        .json(
          failure(
            ApiErrorCodes.CONFLICT,
            'An active report request already exists for this template and asset.',
            getRequestId(res),
            { existingReportId: existingActive.id, existingStatus: existingActive.status }
          )
        );
      return;
    }

    let created: ReportRequestRecord;
    try {
      created = await withTransaction(async (client) => {
        const report = await createReportRequest(
          {
            workspaceId,
            templateId: body.templateId,
            templateName: template.name,
            assetId,
            requestedByUserId: actor.userId,
            format,
          },
          client
        );

        await recordActivity(
          {
            workspaceId,
            actorUserId: actor.userId,
            actorDisplayName: actor.name,
            type: 'ReportRequested',
            summary: `Requested report "${template.name}".`,
            relatedEntityType: 'Report',
            relatedEntityId: report.id,
          },
          client
        );

        await recordAudit(
          {
            workspaceId,
            actorUserId: actor.userId,
            action: 'report.requested',
            entityType: 'Report',
            entityId: report.id,
            changes: buildFieldChange('status', null, report.status),
          },
          client
        );

        return report;
      });
    } catch (err) {
      // Rare race: a second concurrent request for the same
      // (workspace, template, asset) passed the findActiveReportRequest()
      // pre-check above before this one committed. migration
      // 0003_report_request_constraints.sql's uq_reports_active_request
      // partial unique index is the actual guarantee here — the
      // pre-check only gives a clean error message on the common,
      // non-racing path. Postgres reports this as error code 23505
      // (unique_violation); anything else is rethrown and handled by
      // asyncHandler's default 500 path, unchanged.
      if (isUniqueViolation(err)) {
        res
          .status(409)
          .json(
            failure(
              ApiErrorCodes.CONFLICT,
              'An active report request already exists for this template and asset.',
              getRequestId(res)
            )
          );
        return;
      }
      throw err;
    }

    res.status(201).json(success(created, getRequestId(res)));
  })
);
