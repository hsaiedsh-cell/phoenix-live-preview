// ============================================================
// Phoenix Backend — Development-Only CORS Middleware
// PHX-LIVE-001 — Platform Live Integration Readiness
// ------------------------------------------------------------
// PHX-DEPLOY-003 note: retained for local single-origin dev convenience
// and for reference, but NOT wired into server.ts as of this sprint.
// server.ts now registers middleware/cors.ts's productionCorsMiddleware
// unconditionally instead, which is a strict superset for hosted/
// production use (explicit multi-origin allowlist, never a wildcard,
// safe under NODE_ENV=production). Wiring both middlewares together
// would risk duplicate/conflicting CORS headers, so only one is
// registered. A future sprint may retire this file entirely once local
// dev workflows have migrated to PHOENIX_ALLOWED_ORIGINS; that decision
// is out of scope here — see PHX_DEPLOY_003_CORS_SECURITY_DESIGN.md.
// ------------------------------------------------------------
// Minimal, explicit-origin CORS support so a local Phoenix Platform
// dev server (default http://localhost:3000) can call this backend
// (default http://localhost:4000) directly from the browser in
// real-dev mode. NOT enabled by default and NEVER a wildcard —
// see getCorsConfig() below for the exact enablement rule.
//
// This is not a security feature and makes no auth claim: it only
// controls which browser origins receive CORS response headers.
// The dev-only actor header (x-phoenix-user-id) remains the only
// thing standing in for auth in this backend, exactly as documented
// in src/auth/request-actor.ts — this middleware does not change
// that in any way.
// ============================================================

import type { NextFunction, Request, Response } from 'express';
import { getBackendEnv } from '../config/env';

const DEFAULT_DEV_ALLOWED_ORIGIN = 'http://localhost:3000';

export interface DevCorsConfig {
  enabled: boolean;
  allowedOrigin: string;
}

/**
 * Resolves whether dev CORS should be active. Enabled when either:
 *   - NODE_ENV is not 'production', OR
 *   - PHOENIX_ENABLE_DEV_CORS=true is explicitly set (lets a
 *     production-like environment opt in deliberately, e.g. a staging
 *     box still running without a real auth layer).
 * The allowed origin is always a single, explicit origin from
 * PHOENIX_DEV_ALLOWED_ORIGIN — never '*'.
 */
export function getDevCorsConfig(): DevCorsConfig {
  const env = getBackendEnv();
  const explicitFlag = (process.env.PHOENIX_ENABLE_DEV_CORS ?? '').toLowerCase();
  const explicitlyEnabled = explicitFlag === 'true' || explicitFlag === '1' || explicitFlag === 'yes';
  const enabled = env.nodeEnv !== 'production' || explicitlyEnabled;

  const allowedOrigin =
    process.env.PHOENIX_DEV_ALLOWED_ORIGIN?.trim() || DEFAULT_DEV_ALLOWED_ORIGIN;

  return { enabled, allowedOrigin };
}

/**
 * Express middleware — sets Access-Control-Allow-Origin to the single
 * configured allowedOrigin (never '*') and handles the OPTIONS preflight,
 * only when getDevCorsConfig().enabled is true. A no-op pass-through
 * otherwise, so production behavior (no CORS headers at all) is
 * unchanged unless explicitly opted into.
 */
export function devCorsMiddleware() {
  const config = getDevCorsConfig();

  return function (req: Request, res: Response, next: NextFunction): void {
    if (!config.enabled) {
      next();
      return;
    }

    res.setHeader('Access-Control-Allow-Origin', config.allowedOrigin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'content-type, x-phoenix-user-id');
    // No Access-Control-Allow-Credentials header is set — this backend
    // uses no cookies, so browsers never need credentialed CORS mode.

    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }

    next();
  };
}
