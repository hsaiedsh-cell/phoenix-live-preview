// ============================================================
// Phoenix Backend — Activity Routes
// PHX-BACKEND-001 — Backend Foundation & Database Skeleton
// PHX-BACKEND-008 — Activity & Audit Read Endpoints
// ------------------------------------------------------------
// GET /api/workspaces/:workspaceId/activity is now implemented,
// read-only, against the real `activity_logs` table written by
// PHX-BACKEND-007's recordActivity(). No write endpoints exist in this
// module, and none are added here.
//
// ---- Route placement decision (Task 1) -------------------------------
// This endpoint was already stubbed here (routes/activity.ts), not in
// routes/workspaces.ts — see the original PHX-BACKEND-001 stub this
// file replaces. The task brief's preference ("if stubbed in
// workspaces.ts, implement it there") does not apply; its fallback
// ("if activity.ts/audit.ts are mounted separately, use the existing
// route structure only if it does not change public paths") does.
// This file keeps the exact same public path
// (GET /api/workspaces/:workspaceId/activity, mounted under '/api' by
// routes/index.ts) and the same router export name (activityRouter) —
// no path change, no route-module consolidation.
//
// ---- Permission decision (Task 4) -------------------------------------
// Uses `audit.read` (Owner/Admin/Auditor only) for this endpoint too,
// per the task brief's explicit "preferred: use audit.read permission
// for now for both activity and audit, to be conservative" — no new
// `activity.read` permission is introduced. Reviewer/Contributor/
// Viewer receive 403 FORBIDDEN, matching audit.read's existing matrix
// in src/auth/permissions.ts (unchanged by this sprint).
//
// ---- Ordering (Task 5) — mirrors every other read route in this
//      backend (workspaces.ts's GET /api/workspaces/:workspaceId,
//      assessments.ts's read routes):
//   1. workspaceId path param validated (400)
//   2. query params (limit/entityType/entityId/type) validated (400)
//   3. x-phoenix-user-id header validated for presence/shape (401/400)
//      — BEFORE any database call
//   4. requireDatabase() (503)
//   5. workspace existence checked directly (404) — before the
//      permission check, matching workspaces.ts's documented ordering
//   6. requirePermission() enforces audit.read (401 unknown user / 403
//      no membership / 403 role lacking permission)
//   7. the actual read
// ============================================================

import { Router } from 'express';
import { asyncHandler, getRequestId } from '../lib/http';
import { ApiErrorCodes, failure, success } from '../contracts/api-response';
import { requireDatabase } from '../middleware/database-required';
import { workspaceExists } from '../repositories/workspaces.repository';
import { listWorkspaceActivity, listAssessmentActivity } from '../repositories/activity.repository';
import { assessmentExists, getWorkspaceIdForAssessment } from '../repositories/assessments.repository';
import {
  parseActivityListQuery,
  parseAssessmentId,
  parseAssessmentScopedListQuery,
  parseWorkspaceId,
} from '../validation/route-params';
import { getRequestUserId, requirePermission } from '../auth/request-actor';

export const activityRouter = Router();

// GET /api/workspaces/:workspaceId/activity
activityRouter.get(
  '/workspaces/:workspaceId/activity',
  asyncHandler(async (req, res) => {
    const workspaceId = parseWorkspaceId(req, res);
    if (workspaceId === null) return;

    const query = parseActivityListQuery(req, res);
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

    const { items, total } = await listWorkspaceActivity({
      workspaceId,
      limit: query.limit,
      entityType: query.entityType,
      entityId: query.entityId,
      type: query.type,
    });

    res.status(200).json(success({ items, total, cursor: null }, getRequestId(res)));
  })
);

// ============================================================
// PHX-BACKEND-009B — Assessment-Scoped Activity & Audit Read Endpoints
// ------------------------------------------------------------
// GET /api/assessments/:assessmentId/activity — the assessment-scoped
// counterpart to the workspace-level route above, deferred by
// PHX-BACKEND-008 (see the removed comment this replaces). Returns
// activity for the target Assessment plus its child Evidence items
// (see repositories/activity.repository.ts's listAssessmentActivity()
// for the exact scope-match rule).
//
// ---- Permission decision -----------------------------------------------
// Uses `assessment.read` (approved per task brief §3.6), NOT
// `audit.read` — deliberately different from the workspace-level
// Activity route above. `assessment.read` is granted to all six roles
// (Owner/Admin/Reviewer/Contributor/Viewer/Auditor — see
// auth/permissions.ts), matching the approved Activity role matrix
// exactly. This does not change the workspace-level route's own
// audit.read requirement.
//
// ---- Query scope --------------------------------------------------------
// Only `?limit=` is accepted (parseAssessmentScopedListQuery()) — no
// client-controlled entityType/entityId/workspaceId, per task brief
// §3.2. The workspace scope is derived exclusively from the path
// assessmentId via getWorkspaceIdForAssessment(), never trusted from
// the client.
//
// ---- Request-processing order (identical shape to every route in this
//      backend, and to the exact order specified in the task brief):
//   1. assessmentId path param validated (400)
//   2. limit query param validated (400)
//   3. actor source validated (401/400/501/503) — BEFORE any DB call
//   4. requireDatabase() (503)
//   5. assessmentExists() — 404 if the Assessment does not exist
//   6. getWorkspaceIdForAssessment() — 404 on the race where the
//      Assessment was soft-deleted between step 5 and here (identical
//      two-call pattern already used by the existing
//      POST /api/assessments/:assessmentId/submit route)
//   7. requirePermission() enforces assessment.read in the RESOLVED
//      workspace (401 unknown user / 403 no membership / 403 role
//      lacking permission) — never a client-supplied workspace id
//   8. the scoped read
//   9. the existing success envelope ({ items, total, cursor: null })
// ============================================================

// GET /api/assessments/:assessmentId/activity
activityRouter.get(
  '/assessments/:assessmentId/activity',
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

    const actor = await requirePermission(req, res, workspaceId, 'assessment.read');
    if (!actor) return;

    const { items, total } = await listAssessmentActivity({
      workspaceId,
      assessmentId,
      limit: query.limit,
    });

    res.status(200).json(success({ items, total, cursor: null }, getRequestId(res)));
  })
);
