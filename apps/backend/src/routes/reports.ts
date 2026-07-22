// ============================================================
// Phoenix Backend — Reports Routes (STUB)
// PHX-BACKEND-001 — Backend Foundation & Database Skeleton
// ------------------------------------------------------------
// Placeholder module only. No business logic, no persistence, no file
// generation. Documents the future endpoint surface from
// API_CONTRACT_PHX_PLATFORM_002.md §9.
//
// Future endpoints this module will implement:
//   GET  /api/workspaces/:workspaceId/reports
//   POST /api/workspaces/:workspaceId/reports
//   GET  /api/reports/:reportId
//   POST /api/reports/:reportId/generate
//   GET  /api/reports/:reportId/download
// ============================================================

import { Router } from 'express';
import { asyncHandler, getRequestId } from '../lib/http';
import { ApiErrorCodes, failure } from '../contracts/api-response';

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
reportsRouter.post(
  '/workspaces/:workspaceId/reports',
  notImplemented('POST /api/workspaces/:workspaceId/reports')
);
reportsRouter.get('/reports/:reportId', notImplemented('GET /api/reports/:reportId'));
reportsRouter.post('/reports/:reportId/generate', notImplemented('POST /api/reports/:reportId/generate'));
reportsRouter.get('/reports/:reportId/download', notImplemented('GET /api/reports/:reportId/download'));
