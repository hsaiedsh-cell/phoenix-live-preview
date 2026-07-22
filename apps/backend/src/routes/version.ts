// ============================================================
// Phoenix Backend — Version Route
// PHX-BACKEND-001 — Backend Foundation & Database Skeleton
// ============================================================

import { Router } from 'express';
import { asyncHandler, getRequestId } from '../lib/http';
import { success } from '../contracts/api-response';
import { getBackendEnv } from '../config/env';

export const versionRouter = Router();

// GET /api/version
versionRouter.get(
  '/version',
  asyncHandler(async (_req, res) => {
    const env = getBackendEnv();
    res.status(200).json(
      success(
        {
          service: 'phoenix-backend' as const,
          version: env.apiVersion,
          apiContract: 'PHX-PLATFORM-002' as const,
          runtime: 'backend-foundation' as const,
        },
        getRequestId(res)
      )
    );
  })
);
