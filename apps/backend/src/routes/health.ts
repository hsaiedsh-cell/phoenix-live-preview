// ============================================================
// Phoenix Backend — Health Route
// PHX-BACKEND-001 — Backend Foundation & Database Skeleton
// ============================================================

import { Router } from 'express';
import { asyncHandler, getRequestId } from '../lib/http';
import { success } from '../contracts/api-response';

interface HealthPayload {
  ok: true;
  service: 'phoenix-backend';
  status: 'healthy';
}

function buildHealthPayload(): HealthPayload {
  return { ok: true, service: 'phoenix-backend', status: 'healthy' };
}

export const plainHealthRouter = Router();

// GET /health — unwrapped shape, matches the task's literal spec.
plainHealthRouter.get(
  '/health',
  asyncHandler(async (_req, res) => {
    res.status(200).json(buildHealthPayload());
  })
);

export const apiHealthRouter = Router();

// GET /api/health — same payload, wrapped in the standard ApiResponse envelope.
apiHealthRouter.get(
  '/health',
  asyncHandler(async (_req, res) => {
    res.status(200).json(success(buildHealthPayload(), getRequestId(res)));
  })
);
