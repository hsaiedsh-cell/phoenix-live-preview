// ============================================================
// Phoenix Backend — Server (Express App Factory)
// PHX-BACKEND-001 — Backend Foundation & Database Skeleton
// PHX-DEPLOY-003 — Hosted Preview Blocker Resolution (production CORS)
// ------------------------------------------------------------
// Builds the Express application. Does not listen on a port itself (see
// index.ts) so it can also be imported directly by tests or tooling.
// Boots without any database connection or auth secret.
//
// PHX-DEPLOY-003: registers productionCorsMiddleware (explicit
// PHOENIX_ALLOWED_ORIGINS allowlist, no wildcard, safe under
// NODE_ENV=production) before route registration. This runs
// unconditionally in every environment — see middleware/cors.ts for
// the full security contract.
// ============================================================

import express, { type Express } from 'express';
import { requestIdMiddleware } from './middleware/request-id';
import { globalErrorHandler, notFoundHandler } from './middleware/error-handler';
import { productionCorsMiddleware } from './middleware/cors';
import { registerRoutes } from './routes';

export function createServer(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(productionCorsMiddleware);
  app.use(express.json({ limit: '1mb' }));
  app.use(requestIdMiddleware);

  registerRoutes(app);

  // 404 handler — must come after all registered routes.
  app.use(notFoundHandler);

  // Global error handler — must be registered last, with 4 args, for
  // Express to recognize it as an error-handling middleware.
  app.use(globalErrorHandler);

  return app;
}
