// ============================================================
// Phoenix Backend — Actor Resolver Abstraction
// PHX-BACKEND-009 — Production Auth Preparation
// PHX-AUTH-002 — Hosted Auth Vendor Decision & Production Resolver
// PHX-AUTH-002-R1 — OIDC Missing Config Fail-Closed Fix
// ------------------------------------------------------------
// Introduces an explicit seam between "how do we figure out who is
// calling?" and everything downstream that depends on the answer
// (database membership lookup, permission checks, ownership checks —
// all unchanged by this sprint). Before this sprint,
// src/auth/request-actor.ts read the x-phoenix-user-id header directly
// and was the only possible source of a request actor. That header
// remains exactly as trusted as before in dev-header mode — nothing
// about its validation, error messages, or ordering changes — but it
// is no longer the only path the code is written to expect. A future
// sprint implementing real production auth replaces
// ProductionDisabledActorResolver (or adds a fourth resolver) without
// touching route files, permissions.ts, ownership.ts, or the
// RequestActor shape.
//
// No OAuth, JWT, session, cookie, or password logic exists in the
// dev-header/production-disabled/token-placeholder resolvers below.
// TokenPlaceholderActorResolver in particular never parses, decodes,
// or verifies a bearer token — it only notes whether an Authorization
// header happens to be present, for debugging context, and always
// fails with AUTH_NOT_IMPLEMENTED regardless.
//
// PHX-AUTH-002 adds OidcJwtActorResolver, which DOES perform real JWT/
// JWKS verification (see src/auth/token-verifier.ts) and DOES need
// real I/O (fetching/caching the provider's JWKS document). That is
// exactly why ActorResolver.resolveUserId(req) has always returned
// Promise<AuthResolution> — see PHX-BACKEND-009's original design note
// this replaces below.
//
// ---- Sync pre-check resolved (PHX-AUTH-002, Task 6) -------------------
// PHX-BACKEND-009 originally kept a parallel synchronous entry point
// (resolveActorUserIdSync()) because every route's pre-check call
// (`if (getRequestUserId(req, res) === null) return;`) was written
// synchronously, and none of that sprint's three resolvers needed real
// I/O. OidcJwtActorResolver breaks that assumption — JWKS verification
// cannot be done synchronously — so this sprint takes the task brief's
// preferred Option B: src/auth/request-actor.ts's getRequestUserId() is
// now itself async and calls getActorResolver().resolveUserId(req)
// directly, exactly like resolveRequestActor() does. Every route call
// site was updated to `await` it (see routes/activity.ts,
// routes/audit.ts, routes/workspaces.ts, routes/assessments.ts) — all
// of them already run inside an async handler, so this is a same-shape
// `await` addition, not a control-flow change. resolveActorUserIdSync()
// and the standalone resolveDevHeaderUserId()-style pure functions are
// removed as dead code now that both entry points share one async
// path — see docs/auth/PHX_AUTH_002_IMPLEMENTATION_REPORT.md §"Sync
// pre-check resolution" for the full before/after.
// ============================================================

import type { Request } from 'express';
import { ApiErrorCodes } from '../contracts/api-response';
import { getBackendEnv, isOidcConfigured, type PhoenixAuthMode } from '../config/env';
import { isUuid } from '../validation/validators';
import { extractBearerToken, verifyBearerToken } from './token-verifier';
import { resolveUserIdForIdentity } from '../repositories/auth-identity.repository';

export const USER_ID_HEADER = 'x-phoenix-user-id';

/**
 * Result of attempting to resolve *just* the caller's user id (not yet
 * a full RequestActor — no database lookup happens here). `source`
 * distinguishes where an eventual real actor's identity came from,
 * for any future logging/audit use — 'dev-header' is the only value
 * ever produced by this sprint's resolvers; 'token' is reserved for a
 * future real token verifier.
 */
export type AuthResolution =
  | { ok: true; userId: string; source: 'dev-header' | 'token' }
  | { ok: false; status: number; code: string; message: string; details?: unknown };

export interface ActorResolver {
  resolveUserId(req: Request): Promise<AuthResolution>;
}

// ============================================================
// dev-header — identical behavior to pre-PHX-BACKEND-009
// ============================================================

const DEV_HEADER_MISSING_MESSAGE =
  `Missing required ${USER_ID_HEADER} header. This backend uses a development-only ` +
  'actor header in place of production authentication — see ' +
  'docs/backend/PHX_BACKEND_006_IMPLEMENTATION_REPORT.md.';

/**
 * Pure, synchronous dev-header resolution — no database call. Exact
 * behavior carried over from the pre-PHX-BACKEND-009
 * request-actor.ts's getRequestUserId(): missing header → 401
 * AUTH_REQUIRED; present but not a syntactically valid UUID → 400
 * VALIDATION_ERROR (same issues[] shape sendValidationError() would
 * have produced); valid UUID → ok.
 */
export function resolveDevHeaderUserId(req: Request): AuthResolution {
  const raw = req.header(USER_ID_HEADER);

  if (raw === undefined || raw.trim().length === 0) {
    return {
      ok: false,
      status: 401,
      code: ApiErrorCodes.AUTH_REQUIRED,
      message: DEV_HEADER_MISSING_MESSAGE,
    };
  }

  const value = raw.trim();

  if (!isUuid(value)) {
    return {
      ok: false,
      status: 400,
      code: ApiErrorCodes.VALIDATION_ERROR,
      message: 'Invalid request parameters.',
      details: {
        issues: [
          {
            field: USER_ID_HEADER,
            code: 'INVALID_UUID',
            message: `${USER_ID_HEADER} must be a valid UUID.`,
            received: value,
          },
        ],
      },
    };
  }

  return { ok: true, userId: value, source: 'dev-header' };
}

export class DevHeaderActorResolver implements ActorResolver {
  async resolveUserId(req: Request): Promise<AuthResolution> {
    return resolveDevHeaderUserId(req);
  }
}

// ============================================================
// production-disabled — fails closed, trusts nothing
// ============================================================

const PRODUCTION_DISABLED_MESSAGE = 'Production authentication is not configured for this backend.';

/**
 * Always rejects — no header, cookie, or token is ever inspected or
 * trusted. This is the safe default for NODE_ENV=production until a
 * real auth provider exists.
 */
export function resolveProductionDisabled(): AuthResolution {
  return {
    ok: false,
    status: 401,
    code: ApiErrorCodes.AUTH_NOT_CONFIGURED,
    message: PRODUCTION_DISABLED_MESSAGE,
  };
}

export class ProductionDisabledActorResolver implements ActorResolver {
  async resolveUserId(_req: Request): Promise<AuthResolution> {
    return resolveProductionDisabled();
  }
}

// ============================================================
// token-placeholder — non-functional future seam
// ============================================================

const TOKEN_NOT_IMPLEMENTED_MESSAGE = 'Token authentication is not implemented in this release.';

/**
 * Always rejects with 501 AUTH_NOT_IMPLEMENTED. Notes only whether an
 * Authorization header happens to be present (boolean, for debugging
 * context) — the header's value is never read, parsed, decoded, or
 * verified. No JWT/OAuth logic of any kind exists here or anywhere
 * else in this sprint.
 */
export function resolveTokenPlaceholder(req: Request): AuthResolution {
  const authorizationHeaderPresent = Boolean(req.header('authorization'));
  return {
    ok: false,
    status: 501,
    code: ApiErrorCodes.AUTH_NOT_IMPLEMENTED,
    message: TOKEN_NOT_IMPLEMENTED_MESSAGE,
    details: { authorizationHeaderPresent },
  };
}

export class TokenPlaceholderActorResolver implements ActorResolver {
  async resolveUserId(req: Request): Promise<AuthResolution> {
    return resolveTokenPlaceholder(req);
  }
}

// ============================================================
// oidc-jwt — PHX-AUTH-002: real production auth
// ============================================================

const OIDC_NOT_CONFIGURED_MESSAGE =
  'Production authentication (oidc-jwt) is not fully configured for this backend.';
const OIDC_MISSING_TOKEN_MESSAGE = 'Missing required Authorization: Bearer <token> header.';
const OIDC_INVALID_TOKEN_MESSAGE = 'The provided bearer token is invalid.';
const OIDC_NO_LINKED_USER_MESSAGE = 'No Phoenix user is linked to this authenticated identity.';

/**
 * Verifies a bearer token (see token-verifier.ts) and maps the
 * resulting VerifiedExternalIdentity to a Phoenix userId (see
 * repositories/auth-identity.repository.ts). This is the only resolver
 * in this file that performs real I/O (JWKS fetch + a database
 * lookup), which is why it — unlike dev-header/production-disabled/
 * token-placeholder — has no synchronous counterpart; see this file's
 * header, "Sync pre-check resolved".
 *
 * Never trusts a role, workspace, or organization claim from the
 * token: on success this returns only `{ ok: true, userId, source:
 * 'token' }` — resolveRequestActor() in request-actor.ts performs the
 * exact same getUserById() → getActorForWorkspace() → Active-status →
 * hasPermission() sequence it always has, entirely DB-derived.
 *
 * ---- PHX-AUTH-002-R1: the isOidcConfigured() check below is load-bearing ----
 * This resolver is reached whenever PHOENIX_AUTH_MODE=oidc-jwt was
 * explicitly selected — including when its required config
 * (issuer/audience/JWKS URI/provider) is incomplete. src/config/env.ts's
 * resolveAuthMode() no longer substitutes a different PhoenixAuthMode
 * (and, critically, never dev-header) for an incomplete oidc-jwt
 * config — it always honors the explicit 'oidc-jwt' selection. That
 * means the isOidcConfigured(oidc) check immediately below is this
 * mode's ENTIRE fail-closed mechanism, not a defensive belt-and-braces
 * check for an unreachable state: every request in this state — with
 * or without an x-phoenix-user-id header, with or without a bearer
 * token — hits this branch first and is rejected with 401
 * AUTH_NOT_CONFIGURED before any header is read, any token is parsed,
 * or any JWKS fetch is attempted. See
 * docs/auth/PHX_AUTH_002_R1_IMPLEMENTATION_REPORT.md for the full
 * before/after.
 */
export class OidcJwtActorResolver implements ActorResolver {
  async resolveUserId(req: Request): Promise<AuthResolution> {
    const { oidc } = getBackendEnv();

    if (!isOidcConfigured(oidc)) {
      return {
        ok: false,
        status: 401,
        code: ApiErrorCodes.AUTH_NOT_CONFIGURED,
        message: OIDC_NOT_CONFIGURED_MESSAGE,
      };
    }

    const token = extractBearerToken(req.header('authorization'));
    if (!token) {
      return {
        ok: false,
        status: 401,
        code: ApiErrorCodes.AUTH_REQUIRED,
        message: OIDC_MISSING_TOKEN_MESSAGE,
      };
    }

    const verification = await verifyBearerToken(token, oidc);
    if (!verification.ok) {
      // Every verification failure (bad signature, wrong issuer/
      // audience, expired, disallowed algorithm, malformed, missing/
      // unverified email) maps to the same 401 AUTH_INVALID — the
      // specific reason is never returned to the client (see
      // token-verifier.ts's file header on not exposing token
      // internals), only logged server-side for debugging if the
      // caller chooses to.
      return {
        ok: false,
        status: 401,
        code: ApiErrorCodes.AUTH_INVALID,
        message: OIDC_INVALID_TOKEN_MESSAGE,
        details: { reason: verification.reason },
      };
    }

    const mapping = await resolveUserIdForIdentity(verification.identity);
    if (!mapping.ok) {
      // Both 'no_matching_user' and 'ambiguous_match' fail closed with
      // the same 401 AUTH_REQUIRED — per PHX-AUTH-001 Identity Model
      // rule 6, a verified-but-unlinked identity is treated the same
      // as "unauthenticated", not auto-provisioned into a new user.
      return {
        ok: false,
        status: 401,
        code: ApiErrorCodes.AUTH_REQUIRED,
        message: OIDC_NO_LINKED_USER_MESSAGE,
      };
    }

    return { ok: true, userId: mapping.userId, source: 'token' };
  }
}

// ============================================================
// Factory
// ============================================================

/**
 * Returns the ActorResolver matching the backend's current
 * PHOENIX_AUTH_MODE (see src/config/env.ts). This is the abstraction
 * src/auth/request-actor.ts's resolveRequestActor() and
 * getRequestUserId() both depend on instead of reading
 * x-phoenix-user-id (or an Authorization header) directly.
 */
export function getActorResolver(): ActorResolver {
  const { authMode } = getBackendEnv();
  return resolverForMode(authMode);
}

function resolverForMode(mode: PhoenixAuthMode): ActorResolver {
  switch (mode) {
    case 'dev-header':
      return new DevHeaderActorResolver();
    case 'production-disabled':
      return new ProductionDisabledActorResolver();
    case 'token-placeholder':
      return new TokenPlaceholderActorResolver();
    case 'oidc-jwt':
      return new OidcJwtActorResolver();
    /* istanbul ignore next -- exhaustiveness guard, unreachable given PhoenixAuthMode's union */
    default: {
      const _exhaustive: never = mode;
      return _exhaustive;
    }
  }
}
