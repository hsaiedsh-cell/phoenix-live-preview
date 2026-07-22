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
import { listWorkspaceAuditRecords } from '../repositories/audit.repository';
import { parseAuditListQuery, parseWorkspaceId } from '../validation/route-params';
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

// ---- Task 7: assessment-scoped audit endpoint — deferred --------------
// GET /api/assessments/:assessmentId/audit-records is NOT implemented
// this sprint — same rationale as routes/activity.ts's deferred
// assessment-scoped endpoint. See
// docs/backend/PHX_BACKEND_008_IMPLEMENTATION_REPORT.md
// §"Optional assessment-scoped endpoints — deferred".
