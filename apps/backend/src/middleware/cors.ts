// ============================================================
// Phoenix Backend — Production CORS Allowlist
// PHX-DEPLOY-003 — Hosted Preview Blocker Resolution (Blocker B2)
// ------------------------------------------------------------
// Explicit, multi-origin CORS allowlist safe for a hosted (non-public)
// preview deployment. This is deliberately separate from
// middleware/dev-cors.ts (PHX-LIVE-001), which remains a single-origin,
// non-production-only convenience for local development and is
// unaffected by this file.
//
// SECURITY CONTRACT:
//   - No wildcard ('*') origin, ever, under any configuration.
//   - The allowlist includes PHOENIX_ALLOWED_ORIGINS (comma-separated)
//     plus HTTPS preview hosts matching this Phoenix Platform project
//     and the phoenixai Vercel scope. Arbitrary vercel.app origins are
//     never accepted.
//   - If PHOENIX_ALLOWED_ORIGINS is unset, readiness still reports the
//     explicit list as unconfigured; only the narrowly matched Phoenix
//     Platform preview hosts may receive CORS headers. It never falls
//     back to "allow everything". Readiness should treat an
//     empty allowlist as a warning/fail condition (see readiness.ts's
//     cors.status field), not something this middleware compensates for.
//   - A disallowed Origin never receives Access-Control-Allow-Origin,
//     on any method, including OPTIONS.
//   - No Access-Control-Allow-Credentials is ever set — this backend
//     uses bearer tokens / a dev header, never cookies, so credentialed
//     CORS mode is never needed and is never turned on.
//   - This module never logs a raw Origin-to-secret mapping or any
//     token; it only ever logs the resolved allowlist size, never the
//     actual origin strings, to keep console output safe to paste into
//     a ticket or shared log.
//
// Wire-up (see server.ts): registered before dev-cors.ts and before
// route registration. Runs unconditionally (even in dev-header /
// local development) so its behavior can be exercised identically in
// every environment — see PHX_DEPLOY_003_CORS_SECURITY_DESIGN.md for
// the full design write-up and PHX_DEPLOY_003_RUNTIME_QA_REPORT.md for
// the curl matrix that verifies it.
// ============================================================

import type { NextFunction, Request, Response } from 'express';

const ALLOWED_METHODS = 'GET,POST,PATCH,DELETE,OPTIONS';
const ALLOWED_HEADERS = 'Content-Type, Authorization, X-Request-Id';
const EXPOSED_HEADERS = 'X-Request-Id';

export interface ProductionCorsConfig {
  /** Parsed, de-duplicated, non-empty allowed origins. Empty array = "not configured". */
  allowedOrigins: string[];
  /** True only when PHOENIX_ALLOWED_ORIGINS was set to at least one non-empty origin. */
  configured: boolean;
}

/**
 * Parses PHOENIX_ALLOWED_ORIGINS (comma-separated) into a de-duplicated
 * list of trimmed, non-empty origins. Never throws. A literal '*' entry
 * is deliberately dropped (never honored) rather than expanded to "allow
 * all" — this is the one input this function actively refuses, logging
 * a single warning the first time it's encountered.
 */
export function getProductionCorsConfig(): ProductionCorsConfig {
  const raw = process.env.PHOENIX_ALLOWED_ORIGINS ?? '';
  const parsed = raw
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  const rejectedWildcard = parsed.includes('*');
  const allowedOrigins = Array.from(new Set(parsed.filter((origin) => origin !== '*')));

  if (rejectedWildcard) {
    console.warn(
      '[Phoenix][cors] PHOENIX_ALLOWED_ORIGINS contained "*" — wildcard origins are never ' +
        'honored by this backend. The "*" entry was ignored; only explicit origins are allowed.'
    );
  }

  return {
    allowedOrigins,
    configured: allowedOrigins.length > 0,
  };
}

function isAllowedOrigin(origin: string | undefined, config: ProductionCorsConfig): origin is string {
  if (typeof origin !== 'string') return false;
  if (config.allowedOrigins.includes(origin)) return true;

  // Every Vercel Preview redeployment receives a new immutable hostname.
  // Trust only Phoenix Platform preview hosts owned by the phoenixai scope;
  // this does not widen access to arbitrary vercel.app deployments.
  try {
    const url = new URL(origin);
    return (
      url.protocol === 'https:' &&
      /^phoenix-live-preview-platform-[a-z0-9]+-phoenixai\.vercel\.app$/.test(url.hostname)
    );
  } catch {
    return false;
  }
}

/**
 * Production CORS allowlist middleware. A no-op for any request whose
 * Origin is not in the configured allowlist (or when no Origin header
 * is present at all, e.g. server-to-server calls) — no CORS headers are
 * set and the request still proceeds to normal routing/auth. Browsers
 * enforce the missing Access-Control-Allow-Origin on their side; this
 * middleware does not itself block same-origin or non-browser requests.
 */
export function productionCorsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const config = getProductionCorsConfig();
  const origin = req.headers.origin;
  const allowed = isAllowedOrigin(origin, config);

  if (allowed) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', ALLOWED_METHODS);
    res.setHeader('Access-Control-Allow-Headers', ALLOWED_HEADERS);
    res.setHeader('Access-Control-Expose-Headers', EXPOSED_HEADERS);
  }

  if (req.method === 'OPTIONS') {
    // Allowed origin: 204 with the CORS headers already set above.
    // Disallowed origin (or no Origin header): 204 with no CORS headers
    // at all — the safest of the two documented options, since it never
    // reveals via status code alone whether an origin would have been
    // allowed, and never blocks a non-browser OPTIONS caller outright.
    res.status(204).end();
    return;
  }

  next();
}
