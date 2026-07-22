// ============================================================
// Phoenix Backend — Workspaces Routes
// PHX-BACKEND-001 — Backend Foundation & Database Skeleton
// PHX-BACKEND-003 — Read-Only Workspace & Assessment Endpoints
// PHX-BACKEND-004 — Request Validation & API Error Hardening
// PHX-BACKEND-006 — Auth Session Foundation & Permission Boundary
// ------------------------------------------------------------
// GET /api/workspaces/:workspaceId is implemented against the real
// PostgreSQL schema (read-only). Every other route in this module
// remains a documented NOT_IMPLEMENTED stub.
//
// Endpoint surface from API_CONTRACT_PHX_PLATFORM_002.md §1–2:
//   GET   /api/workspaces                                    — STUB (501)
//   GET   /api/workspaces/:workspaceId                       — IMPLEMENTED, requires actor + workspace.read
//   PATCH /api/workspaces/:workspaceId                       — STUB (501, write)
//   GET   /api/workspaces/:workspaceId/users                 — STUB (501)
//   GET   /api/workspaces/:workspaceId/dashboard-summary      — STUB (501; optional
//                                                                per PHX-BACKEND-003 scope,
//                                                                deferred to a future sprint)
//
// PHX-BACKEND-004: workspaceId is validated as a UUID BEFORE the
// database availability check, so malformed input returns 400
// VALIDATION_ERROR even when the database is down.
//
// PHX-BACKEND-006: GET /api/workspaces/:workspaceId now requires a
// development-only request actor (x-phoenix-user-id header) with
// workspace.read permission. Ordering, per
// docs/backend/PHX_BACKEND_006_IMPLEMENTATION_REPORT.md:
//   1. workspaceId path param validated (400)
//   2. x-phoenix-user-id header validated for presence/shape (401/400) —
//      BEFORE any database call, so a missing/malformed header never
//      depends on database availability
//   3. requireDatabase() (503)
//   4. workspace existence checked directly (404) — a workspace that
//      does not exist is reported as 404 even to an authenticated
//      actor, before any permission check runs
//   5. requirePermission() resolves the actor for this workspace and
//      enforces workspace.read (401 unknown user / 403 no membership,
//      non-Active membership, or role lacking the permission)
//   6. the actual read
// The still-stub routes below (GET /workspaces, PATCH
// /workspaces/:workspaceId, etc.) are NOT gated by an actor in this
// sprint — they return 501 NOT_IMPLEMENTED regardless of headers,
// matching the task brief's scope (only the five existing read
// endpoints and five write endpoints require actor enforcement this
// sprint).
// ============================================================

import { Router } from 'express';
import { asyncHandler, getRequestId } from '../lib/http';
import { ApiErrorCodes, failure, success } from '../contracts/api-response';
import { requireDatabase } from '../middleware/database-required';
import { getWorkspaceById } from '../repositories/workspaces.repository';
import { parseWorkspaceId } from '../validation/route-params';
import { getRequestUserId, requirePermission } from '../auth/request-actor';

export const workspacesRouter = Router();

function notImplemented(routeLabel: string) {
  return asyncHandler(async (_req, res) => {
    res
      .status(501)
      .json(
        failure(
          ApiErrorCodes.NOT_IMPLEMENTED,
          `${routeLabel} is not implemented in this backend sprint (PHX-BACKEND-003).`,
          getRequestId(res)
        )
      );
  });
}

// GET /api/workspaces/:workspaceId
workspacesRouter.get(
  '/workspaces/:workspaceId',
  asyncHandler(async (req, res) => {
    const workspaceId = parseWorkspaceId(req, res);
    if (workspaceId === null) return;

    // Validate the actor source (header or, in oidc-jwt mode, bearer token) before any database
    // call — see file header ordering note.
    if ((await getRequestUserId(req, res)) === null) return;

    if (!(await requireDatabase(res))) return;

    const workspace = await getWorkspaceById(workspaceId);

    if (!workspace) {
      res
        .status(404)
        .json(failure(ApiErrorCodes.NOT_FOUND, 'Workspace not found.', getRequestId(res)));
      return;
    }

    const actor = await requirePermission(req, res, workspaceId, 'workspace.read');
    if (!actor) return;

    res.status(200).json(success(workspace, getRequestId(res)));
  })
);

workspacesRouter.get('/workspaces', notImplemented('GET /api/workspaces'));
workspacesRouter.patch('/workspaces/:workspaceId', notImplemented('PATCH /api/workspaces/:workspaceId'));
workspacesRouter.get('/workspaces/:workspaceId/users', notImplemented('GET /api/workspaces/:workspaceId/users'));
workspacesRouter.get(
  '/workspaces/:workspaceId/dashboard-summary',
  notImplemented('GET /api/workspaces/:workspaceId/dashboard-summary')
);
