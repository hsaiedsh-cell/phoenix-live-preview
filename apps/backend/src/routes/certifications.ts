// ============================================================
// Phoenix Backend — Certifications Routes (STUB)
// PHX-BACKEND-001 — Backend Foundation & Database Skeleton
// ------------------------------------------------------------
// Placeholder module only. No business logic, no persistence. Documents
// the future endpoint surface from API_CONTRACT_PHX_PLATFORM_002.md §8.
// Certification Level / Internal Tier thresholds are NOT implemented or
// altered here — see certification-levels.ts and
// PBRS_CERTIFICATION_THRESHOLD_ADDENDUM_PHX_CERT_003.md, which remain the
// sole source of truth for threshold logic.
//
// Future endpoints this module will implement:
//   GET  /api/workspaces/:workspaceId/certifications
//   POST /api/passports/:passportId/certification
//   GET  /api/certifications/:certificationId
//   PATCH /api/certifications/:certificationId
//   POST /api/certifications/:certificationId/revoke
// ============================================================

import { Router } from 'express';
import { asyncHandler, getRequestId } from '../lib/http';
import { ApiErrorCodes, failure } from '../contracts/api-response';

export const certificationsRouter = Router();

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

certificationsRouter.get(
  '/workspaces/:workspaceId/certifications',
  notImplemented('GET /api/workspaces/:workspaceId/certifications')
);
certificationsRouter.post(
  '/passports/:passportId/certification',
  notImplemented('POST /api/passports/:passportId/certification')
);
certificationsRouter.get(
  '/certifications/:certificationId',
  notImplemented('GET /api/certifications/:certificationId')
);
certificationsRouter.patch(
  '/certifications/:certificationId',
  notImplemented('PATCH /api/certifications/:certificationId')
);
certificationsRouter.post(
  '/certifications/:certificationId/revoke',
  notImplemented('POST /api/certifications/:certificationId/revoke')
);
