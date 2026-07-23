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
  type ReportRequestRecord,
} from '../repositories/reports.repository';
import { withTransaction } from '../db/transaction';
import { recordActivity } from '../repositories/activity.repository';
import { buildFieldChange, recordAudit } from '../repositories/audit.repository';
import { parseWorkspaceId } from '../validation/route-params';
import { parseBodyWithSchema } from '../validation/zod-response';
import { sendValidationError } from '../validation/validation-response';
import { CreateReportRequestBodySchema } from '../validation/schemas/report.schemas';
import { getRequestUserId, requirePermission } from '../auth/request-actor';

/** True if `err` is a `pg` unique-violation error (SQLSTATE 23505) — see the try/catch around withTransaction() below. */
function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}

export const reportsRouter = Router();

function notImplemented(routeLabel: string) {
  return asyncHandler(async (_req, res) => {
    res
      .status(501)
      .json(
        failure(
          ApiErrorCodes.NOT_IMPLEMENTED,
          `${routeLabel} is not implemented in this backend foundation sprint (PHX-BACKEND-001).`,
          getRequestId(res)
        )
      );
  });
}

reportsRouter.get('/workspaces/:workspaceId/reports', notImplemented('GET /api/workspaces/:workspaceId/reports'));

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

reportsRouter.get('/reports/:reportId', notImplemented('GET /api/reports/:reportId'));
reportsRouter.post('/reports/:reportId/generate', notImplemented('POST /api/reports/:reportId/generate'));
reportsRouter.get('/reports/:reportId/download', notImplemented('GET /api/reports/:reportId/download'));
