// ============================================================
// Phoenix Backend — Error Handling
// PHX-BACKEND-001 — Backend Foundation & Database Skeleton
// ------------------------------------------------------------
// Global 404 handler and error handler. Never exposes stack traces in
// responses (they are only written to the server console, and only
// outside production). Every response is a structured ApiFailure with a
// requestId.
// ============================================================

import type { NextFunction, Request, Response } from 'express';
import { ApiErrorCodes, failure } from '../contracts/api-response';
import { getBackendEnv } from '../config/env';
import { getRequestId } from '../lib/http';

export function notFoundHandler(req: Request, res: Response): void {
  const requestId = getRequestId(res);
  res.status(404).json(
    failure(ApiErrorCodes.NOT_FOUND, 'Route not found.', requestId, {
      method: req.method,
      path: req.originalUrl,
    })
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function globalErrorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  const env = getBackendEnv();
  const requestId = getRequestId(res);

  if (env.nodeEnv !== 'production') {
    // eslint-disable-next-line no-console
    console.error(`[phoenix-backend] Unhandled error (requestId=${requestId}):`, err);
  } else {
    // eslint-disable-next-line no-console
    console.error(`[phoenix-backend] Unhandled error (requestId=${requestId})`);
  }

  res.status(500).json(
    failure(ApiErrorCodes.INTERNAL_ERROR, 'An unexpected backend error occurred.', requestId)
  );
}
