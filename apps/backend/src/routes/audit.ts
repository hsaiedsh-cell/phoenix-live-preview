// ============================================================
// Phoenix Backend — Audit Routes
// PHX-BACKEND-001 — Backend Foundation & Database Skeleton
// PHX-BACKEND-008 — Activity & Audit Read Endpoints
// ------------------------------------------------------------
// GET /api/workspaces/:workspaceId/audit-records is now implemented,
// read-only, against the real `audit_records` table written by
// PHX-BACKEND-007's recordAudit(). Still no write endpoints in this
// module — audit_records remains append-only, written exclusively by
// routes/assessments.ts's transactional write handlers.
//
// ---- Route placement decision (Task 1) -------------------------------
// Same reasoning as routes/activity.ts: this endpoint was already
// stubbed here (routes/audit.ts), not in routes/workspaces.ts, so it
// stays here. Same public path
// (GET /api/workspaces/:workspaceId/audit-records) and same router
// export name (auditRouter).
//
// ---- Permission decision (Task 4/6) ------------------------------------
// Requires `audit.read` — Owner/Admin/Auditor only, per
// docs/platform/PHX_PLATFORM_006_ACCESS_CONTROL_MATRIX.md's
// `canViewAuditTrail` row and src/auth/permissions.ts's existing
// matrix (unchanged by this sprint; audit.read already carried exactly
// this Owner/Admin/Auditor set as of PHX-BACKEND-006). Reviewer/
// Contributor/Viewer receive 403 FORBIDDEN.
//
// ---- Ordering (Task 6) — identical structure to routes/activity.ts:
//   1. workspaceId path param validated (400)
//   2. query params (limit/entityType/entityId/action) validated (400)
//   3. x-phoenix-user-id header validated for presence/shape (401/400)
//      — BEFORE any database call
//   4. requireDatabase() (503)
//   5. workspace existence checked directly (404)
//   6. requirePermission() enforces audit.read (401/403)
//   7. the actual read
// ============================================================

import { Router } from 'express';
import { asyncHandler, getRequestId } from '../lib/http';
import { ApiErrorCodes, failure, success } from '../contracts/api-response';
import { requireDatabase } from '../middleware/database-required';
import { workspaceExists } from '../repositories/workspaces.repository';
import { listWorkspaceAuditRecords, listAssessmentAuditRecords } from '../repositories/audit.repository';
import { assessmentExists, getWorkspaceIdForAssessment } from '../repositories/assessments.repository';
import {
  parseAssessmentId,
  parseAssessmentScopedListQuery,
  parseAuditListQuery,
  parseWorkspaceId,
} from '../validation/route-params';
import { getRequestUserId, requirePermission } from '../auth/request-actor';

export const auditRouter = Router();

// GET /api/workspaces/:workspaceId/audit-records
auditRouter.get(
  '/workspaces/:workspaceId/audit-records',
  asyncHandler(async (req, res) => {
    const workspaceId = parseWorkspaceId(req, res);
    if (workspaceId === null) return;

    const query = parseAuditListQuery(req, res);
    if (query === null) return;

    // Validate the actor source (header or, in oidc-jwt mode, bearer token) before any database
    // call — see file header ordering note.
    if ((await getRequestUserId(req, res)) === null) return;

    if (!(await requireDatabase(res))) return;

    if (!(await workspaceExists(workspaceId))) {
      res
        .status(404)
        .json(failure(ApiErrorCodes.NOT_FOUND, 'Workspace not found.', getRequestId(res)));
      return;
    }

    const actor = await requirePermission(req, res, workspaceId, 'audit.read');
    if (!actor) return;

    const { items, total } = await listWorkspaceAuditRecords({
      workspaceId,
      limit: query.limit,
      entityType: query.entityType,
      entityId: query.entityId,
      action: query.action,
    });

    res.status(200).json(success({ items, total, cursor: null }, getRequestId(res)));
  })
);

// ============================================================
// PHX-BACKEND-009B — Assessment-Scoped Activity & Audit Read Endpoints
// ------------------------------------------------------------
// GET /api/assessments/:assessmentId/audit-records — the
// assessment-scoped counterpart to the workspace-level route above,
// deferred by PHX-BACKEND-008 (see the removed comment this replaces).
// Returns audit history for the target Assessment plus its child
// Evidence items (see repositories/audit.repository.ts's
// listAssessmentAuditRecords() for the exact scope-match rule).
//
// ---- Permission decision -----------------------------------------------
// Uses `audit.read` — Owner/Admin/Auditor only, identical to the
// workspace-level Audit route above and to the approved Audit role
// matrix (Reviewer/Contributor/Viewer denied with the existing
// 403 FORBIDDEN standard — no new error code is introduced).
//
// ---- Query scope / request-processing order — identical to
//      routes/activity.ts's new assessment-scoped route above (see
//      that file's matching comment for the full step-by-step
//      rationale); only the permission (audit.read vs. assessment.read)
//      and the repository call differ.
// ============================================================

// GET /api/assessments/:assessmentId/audit-records
auditRouter.get(
  '/assessments/:assessmentId/audit-records',
  asyncHandler(async (req, res) => {
    const assessmentId = parseAssessmentId(req, res);
    if (assessmentId === null) return;

    const query = parseAssessmentScopedListQuery(req, res);
    if (query === null) return;

    if ((await getRequestUserId(req, res)) === null) return;

    if (!(await requireDatabase(res))) return;

    if (!(await assessmentExists(assessmentId))) {
      res
        .status(404)
        .json(failure(ApiErrorCodes.NOT_FOUND, 'Assessment not found.', getRequestId(res)));
      return;
    }

    const workspaceId = await getWorkspaceIdForAssessment(assessmentId);
    if (!workspaceId) {
      // Race: soft-deleted between the existence check above and here.
      res
        .status(404)
        .json(failure(ApiErrorCodes.NOT_FOUND, 'Assessment not found.', getRequestId(res)));
      return;
    }

    const actor = await requirePermission(req, res, workspaceId, 'audit.read');
    if (!actor) return;

    const { items, total } = await listAssessmentAuditRecords({
      workspaceId,
      assessmentId,
      limit: query.limit,
    });

    res.status(200).json(success({ items, total, cursor: null }, getRequestId(res)));
  })
);
