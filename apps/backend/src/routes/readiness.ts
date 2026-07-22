// ============================================================
// Phoenix Backend — Readiness Route
// PHX-BACKEND-001 — Backend Foundation & Database Skeleton
// PHX-BACKEND-002 — Local PostgreSQL + Migration Execution
// PHX-BACKEND-009 — Production Auth Preparation
// PHX-AUTH-002 — Hosted Auth Vendor Decision & Production Resolver
// PHX-AUTH-002-R1 — OIDC Missing Config Fail-Closed Fix
// ------------------------------------------------------------
// Reports whether optional subsystems (database, auth) are configured
// and, for the database, actually reachable. PHX-BACKEND-002 replaces
// the PHX-BACKEND-001 placeholder ("configured_not_connected", which
// never attempted a connection) with a real check via
// db/client.ts's checkDatabaseConnection().
//
// HTTP status decision (Alpha behavior, documented per task instructions):
// This route always returns 200, including when database.status is
// "connection_failed" — the JSON body's `ok` field is false in that
// case. This avoids crashing local smoke tests / CI that expect a 2xx
// from a foundation-stage readiness probe. A future production sprint
// may switch to 503 for connection_failed; that is a deliberate,
// separate decision — see
// docs/backend/PHX_BACKEND_002_IMPLEMENTATION_REPORT.md.
//
// ---- PHX-BACKEND-009 / PHX-AUTH-002: auth block ------------------------
// `auth` reflects the real PHOENIX_AUTH_MODE (see src/config/env.ts).
// Never exposes a secret, JWKS URI, user id, or any request-specific
// data — only the backend's static configuration for this mode:
//   - mode:  'dev-header' | 'production-disabled' | 'token-placeholder' | 'oidc-jwt'
//   - status: 'enabled' (dev-header actually resolves actors, or
//             oidc-jwt is fully configured) | 'disabled'
//             (production-disabled — no actor ever resolves) |
//             'not_implemented' (token-placeholder) | 'misconfigured'
//             (oidc-jwt selected/attempted but required config is
//             incomplete — see src/config/env.ts's isOidcConfigured())
//   - productionSafe: true only for production-disabled, or for
//     oidc-jwt when fully configured. dev-header is never
//     production-safe (it trusts a caller-supplied header).
//     token-placeholder is also NOT marked production-safe — despite
//     failing closed like production-disabled, it exists only as a
//     seam for code that isn't written yet; a deployment relying on it
//     has no real authentication in place, so it doesn't get a "safe"
//     signal either. See docs/backend/PHX_BACKEND_009_IMPLEMENTATION_REPORT.md
//     § "Readiness auth status" for the full rationale on both choices.
//   - provider: the configured PHOENIX_AUTH_PROVIDER value (e.g.
//     "clerk") when oidc-jwt is the active mode and a provider value
//     is set; omitted for every other mode. Never the issuer or JWKS
//     URI themselves — presence of a provider name is enough signal
//     for an operator dashboard without exposing anything sensitive.
// ============================================================

import { Router } from 'express';
import { asyncHandler, getRequestId } from '../lib/http';
import { success } from '../contracts/api-response';
import { checkDatabaseConnection } from '../db/client';
import { getBackendEnv, isOidcConfigured, type PhoenixAuthMode } from '../config/env';
import { getProductionCorsConfig } from '../middleware/cors';

export const readinessRouter = Router();

type AuthStatus = 'enabled' | 'disabled' | 'not_implemented' | 'misconfigured';

function authStatusForMode(mode: PhoenixAuthMode, oidcConfigured: boolean): AuthStatus {
  switch (mode) {
    case 'dev-header':
      return 'enabled';
    case 'production-disabled':
      return 'disabled';
    case 'token-placeholder':
      return 'not_implemented';
    case 'oidc-jwt':
      // PHX-AUTH-002-R1: authMode resolves to 'oidc-jwt' whenever it was
      // explicitly selected, regardless of whether its required config
      // is complete (see src/config/env.ts's resolveAuthMode() —
      // updated in R1 to stop substituting a different mode, including
      // dev-header, for an incomplete oidc-jwt config). This branch is
      // therefore genuinely reachable in both the configured and
      // misconfigured cases, and both are reported accurately here.
      return oidcConfigured ? 'enabled' : 'misconfigured';
  }
}

function productionSafeForMode(mode: PhoenixAuthMode, oidcConfigured: boolean): boolean {
  switch (mode) {
    case 'dev-header':
      return false;
    case 'production-disabled':
      return true;
    case 'token-placeholder':
      return false;
    case 'oidc-jwt':
      return oidcConfigured;
  }
}

// GET /api/readiness
readinessRouter.get(
  '/readiness',
  asyncHandler(async (_req, res) => {
    const database = await checkDatabaseConnection();
    const ok = database.status !== 'connection_failed';
    const env = getBackendEnv();
    const oidcConfigured = isOidcConfigured(env.oidc);
    const cors = getProductionCorsConfig();

    res.status(200).json(
      success(
        {
          ok,
          database,
          auth: {
            mode: env.authMode,
            status: authStatusForMode(env.authMode, oidcConfigured),
            productionSafe: productionSafeForMode(env.authMode, oidcConfigured),
            ...(env.authMode === 'oidc-jwt' && env.oidc.provider
              ? { provider: env.oidc.provider }
              : {}),
          },
          // PHX-DEPLOY-003 — Blocker B2. Deliberately exposes only a
          // count and a wildcard flag (always false), never the actual
          // configured origin strings — an operator dashboard needs to
          // know "is this configured at all", not the preview URLs
          // themselves, which this endpoint treats as sensitive enough
          // to omit. See PHX_DEPLOY_003_CORS_SECURITY_DESIGN.md.
          cors: {
            status: cors.configured ? ('configured' as const) : ('not_configured' as const),
            allowedOriginsCount: cors.allowedOrigins.length,
            wildcardAllowed: false as const,
          },
          mode: 'foundation' as const,
        },
        getRequestId(res)
      )
    );
  })
);
