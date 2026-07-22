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
import { listWorkspaceActivity } from '../repositories/activity.repository';
import { parseActivityListQuery, parseWorkspaceId } from '../validation/route-params';
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

// ---- Task 7: assessment-scoped activity endpoint — deferred ----------
// GET /api/assessments/:assessmentId/activity is NOT implemented this
// sprint. The task brief marks it optional ("only if low-risk") and
// instructs "if not implemented: leave as 501 or not present... do not
// add if it complicates route structure." No stub route existed for
// this path before this sprint (it was never part of the
// PHX-BACKEND-001 stub surface), so nothing is added here — see
// docs/backend/PHX_BACKEND_008_IMPLEMENTATION_REPORT.md
// §"Optional assessment-scoped endpoints — deferred" for the documented
// future path.
