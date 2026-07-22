// ============================================================
// Phoenix Backend — Passports Routes (STUB)
// PHX-BACKEND-001 — Backend Foundation & Database Skeleton
// ------------------------------------------------------------
// Placeholder module only. No business logic, no persistence. Documents
// the future endpoint surface from API_CONTRACT_PHX_PLATFORM_002.md §7.
//
// Future endpoints this module will implement:
//   GET   /api/workspaces/:workspaceId/passports
//   POST  /api/assessments/:assessmentId/passport
//   GET   /api/passports/:passportId
//   PATCH /api/passports/:passportId
//   POST  /api/passports/:passportId/verify
// ============================================================

import { Router } from 'express';
import { asyncHandler, getRequestId } from '../lib/http';
import { ApiErrorCodes, failure } from '../contracts/api-response';

export const passportsRouter = Router();

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

passportsRouter.get(
  '/workspaces/:workspaceId/passports',
  notImplemented('GET /api/workspaces/:workspaceId/passports')
);
passportsRouter.post(
  '/assessments/:assessmentId/passport',
  notImplemented('POST /api/assessments/:assessmentId/passport')
);
passportsRouter.get('/passports/:passportId', notImplemented('GET /api/passports/:passportId'));
passportsRouter.patch('/passports/:passportId', notImplemented('PATCH /api/passports/:passportId'));
passportsRouter.post(
  '/passports/:passportId/verify',
  notImplemented('POST /api/passports/:passportId/verify')
);
