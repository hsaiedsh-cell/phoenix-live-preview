// ============================================================
// Phoenix Backend — HTTP Helpers
// PHX-BACKEND-001 — Backend Foundation & Database Skeleton
// ------------------------------------------------------------
// Small helpers shared by route modules. Kept minimal — no extra HTTP
// framework abstraction beyond what Express already provides.
// ============================================================

import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Wraps an async Express handler so a rejected promise is forwarded to
 * next(err) instead of crashing the process or hanging the request. Every
 * route in this backend should be wrapped with this.
 */
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<void>
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}

/**
 * Single read path for the correlation id set by requestIdMiddleware
 * (see middleware/request-id.ts). Falls back to 'unknown' only if called
 * outside that middleware's chain, which should not happen in practice.
 */
export function getRequestId(res: Response): string {
  const value = res.locals.requestId;
  return typeof value === 'string' && value.length > 0 ? value : 'unknown';
}
