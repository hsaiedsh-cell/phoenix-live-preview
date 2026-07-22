// ============================================================
// Phoenix Backend — Request ID Middleware
// PHX-BACKEND-001 — Backend Foundation & Database Skeleton
// ------------------------------------------------------------
// Assigns a lightweight correlation id to every incoming request so every
// ApiResponse (success or failure) can include a requestId. No external
// logging/tracing dependency — uses Node's built-in crypto.randomUUID().
//
// Stored on res.locals.requestId (rather than augmenting the Express
// Request type) so this works regardless of how pnpm's isolated
// node_modules resolves @types/express-serve-static-core across
// workspace packages. See lib/http.ts's getRequestId() helper for the
// single read path every route/middleware should use.
// ============================================================

import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header('x-request-id');
  const requestId = incoming && incoming.trim().length > 0 ? incoming.trim() : randomUUID();
  res.locals.requestId = requestId;
  res.setHeader('x-request-id', requestId);
  next();
}
