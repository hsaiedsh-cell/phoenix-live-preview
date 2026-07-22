// ============================================================
// Phoenix Backend — Environment Contract
// PHX-BACKEND-001 — Backend Foundation & Database Skeleton
// PHX-BACKEND-009 — Production Auth Preparation
// PHX-AUTH-002 — Hosted Auth Vendor Decision & Production Resolver
// PHX-AUTH-002-R1 — OIDC Missing Config Fail-Closed Fix
// ------------------------------------------------------------
// Safe, boot-tolerant environment handling. The backend MUST be able to
// start without DATABASE_URL, without any auth secret, and without any
// paid/hosted service configured. Nothing in this module throws — every
// value has a safe default, and optional integrations (database) resolve
// to an explicit "disabled" state rather than crashing the process.
//
// This module does not implement authentication, does not implement a
// database connection, and does not read any secret required for the
// server to boot. See docs/backend/PHX_BACKEND_001_IMPLEMENTATION_REPORT.md
// for the full contract this file implements.
//
// ---- PHX-BACKEND-009: PHOENIX_AUTH_MODE ------------------------------
// getBackendEnv() now also resolves an explicit auth mode (see
// PhoenixAuthMode below) that src/auth/actor-resolver.ts's
// getActorResolver() reads to decide how (or whether) a request actor
// may be resolved at all. Resolving the mode here is still entirely
// non-throwing, preserving this file's "never throws" contract. The
// one place PHOENIX_AUTH_MODE can legitimately abort the process — a
// production boot with dev-header still selected — is deliberately
// NOT here; see assertAuthModeSafeToBoot() below and its doc comment
// for why that check lives in a separate, explicitly-invoked function
// rather than inside getBackendEnv().
// ============================================================

export type NodeEnv = 'development' | 'production' | 'test';

/**
 * How this backend resolves the current request's actor:
 *   - 'dev-header'          — trusts x-phoenix-user-id (local/dev only,
 *                             see src/auth/request-actor.ts). Never
 *                             permitted in production (see
 *                             assertAuthModeSafeToBoot()).
 *   - 'production-disabled' — no actor can ever be resolved; every
 *                             protected route fails closed with 401
 *                             AUTH_NOT_CONFIGURED. The safe default for
 *                             NODE_ENV=production until a real auth
 *                             provider is implemented.
 *   - 'token-placeholder'   — a non-functional seam for a future bearer
 *                             token / OAuth / JWT verifier. Never
 *                             verifies, decodes, or trusts any token —
 *                             every protected route returns 501
 *                             AUTH_NOT_IMPLEMENTED.
 *   - 'oidc-jwt'            — PHX-AUTH-002: real production auth.
 *                             Verifies a bearer token's signature via
 *                             the configured provider's JWKS endpoint
 *                             (see src/auth/token-verifier.ts) and maps
 *                             the verified external identity to a
 *                             Phoenix user (see
 *                             src/repositories/auth-identity.repository.ts).
 *                             Only ever selected when its full required
 *                             config (issuer/audience/JWKS URI/provider)
 *                             is present — see resolveAuthMode() below.
 *                             Missing/partial config never silently
 *                             activates this mode.
 */
export type PhoenixAuthMode = 'dev-header' | 'production-disabled' | 'token-placeholder' | 'oidc-jwt';

const VALID_AUTH_MODES: readonly PhoenixAuthMode[] = [
  'dev-header',
  'production-disabled',
  'token-placeholder',
  'oidc-jwt',
];

/**
 * PHX-AUTH-002 — required OIDC/JWT configuration for 'oidc-jwt' mode.
 * All four fields must be present for the mode to be considered
 * configured; see isOidcConfigured() / resolveAuthMode() below. Never
 * throws to obtain — absent values simply mean "not configured".
 */
export interface PhoenixOidcConfig {
  issuer: string | undefined;
  audience: string | undefined;
  jwksUri: string | undefined;
  provider: string | undefined;
  emailClaim: string;
  emailVerifiedClaim: string;
  displayNameClaim: string;
  clockSkewSeconds: number;
}

export interface PhoenixBackendEnv {
  nodeEnv: NodeEnv;
  port: number;
  apiVersion: string;
  /** Present only if DATABASE_URL was set. Never logged or echoed back to clients. */
  databaseUrl: string | undefined;
  /** Explicit opt-in flag. Database access stays disabled unless this is true AND databaseUrl is set. */
  databaseEnabled: boolean;
  /** PHX-BACKEND-009 — see PhoenixAuthMode above. */
  authMode: PhoenixAuthMode;
  /** PHX-AUTH-002 — resolved OIDC/JWT config, regardless of whether authMode is 'oidc-jwt'. */
  oidc: PhoenixOidcConfig;
}

function readEnvVar(name: string): string | undefined {
  const value = process.env[name];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function readBooleanEnvVar(name: string, fallback = false): boolean {
  const raw = readEnvVar(name)?.toLowerCase();
  if (raw === undefined) return fallback;
  return raw === 'true' || raw === '1' || raw === 'yes';
}

function resolveNodeEnv(): NodeEnv {
  const raw = readEnvVar('NODE_ENV')?.toLowerCase();
  if (raw === 'production' || raw === 'test') return raw;
  return 'development';
}

function resolvePort(): number {
  const raw = readEnvVar('PORT') ?? readEnvVar('BACKEND_PORT');
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  if (Number.isInteger(parsed) && parsed > 0 && parsed < 65536) {
    return parsed;
  }
  return 4000;
}

/**
 * Resolves PHX-AUTH-002's OIDC/JWT config from env vars. Never throws;
 * a missing var simply resolves to undefined. This function alone does
 * NOT mean 'oidc-jwt' mode is active — see isOidcConfigured() and
 * resolveAuthMode() below for the "fully configured" gate.
 */
function resolveOidcConfig(): PhoenixOidcConfig {
  return {
    issuer: readEnvVar('PHOENIX_AUTH_ISSUER'),
    audience: readEnvVar('PHOENIX_AUTH_AUDIENCE'),
    jwksUri: readEnvVar('PHOENIX_AUTH_JWKS_URI'),
    provider: readEnvVar('PHOENIX_AUTH_PROVIDER'),
    emailClaim: readEnvVar('PHOENIX_AUTH_EMAIL_CLAIM') ?? 'email',
    emailVerifiedClaim: readEnvVar('PHOENIX_AUTH_EMAIL_VERIFIED_CLAIM') ?? 'email_verified',
    displayNameClaim: readEnvVar('PHOENIX_AUTH_DISPLAY_NAME_CLAIM') ?? 'name',
    clockSkewSeconds: (() => {
      const raw = readEnvVar('PHOENIX_AUTH_CLOCK_SKEW_SECONDS');
      const parsed = raw ? Number.parseInt(raw, 10) : NaN;
      return Number.isInteger(parsed) && parsed >= 0 ? parsed : 60;
    })(),
  };
}

/**
 * True only when every required 'oidc-jwt' env var (issuer, audience,
 * JWKS URI, provider) is present. This is the single gate that decides
 * whether 'oidc-jwt' is allowed to activate — see resolveAuthMode()
 * below. A partially-configured oidc block (e.g. issuer set but no
 * JWKS URI) is treated identically to "not configured at all": it
 * never activates 'oidc-jwt', and never falls back to 'dev-header'.
 */
export function isOidcConfigured(oidc: PhoenixOidcConfig): boolean {
  return Boolean(oidc.issuer && oidc.audience && oidc.jwksUri && oidc.provider);
}

/**
 * Resolves PHOENIX_AUTH_MODE. An explicit, recognized value always wins,
 * INCLUDING 'oidc-jwt' when its required config is incomplete — see
 * PHX-AUTH-002-R1's fix note below. With no explicit value (or an
 * unrecognized one — treated the same as unset, never as an error, per
 * this module's non-throwing contract):
 *   - NODE_ENV=production  → 'production-disabled' (fail closed by default)
 *   - anything else        → 'dev-header' (matches every pre-PHX-BACKEND-009
 *     local/dev/test behavior exactly — no default-behavior change for
 *     existing local preview / test setups that never set this var).
 *
 * ---- PHX-AUTH-002-R1 fix: explicit oidc-jwt never falls back to dev-header ----
 * PHX-AUTH-002 originally had this function fall through to `fallback`
 * (dev-header outside production) when PHOENIX_AUTH_MODE=oidc-jwt was
 * explicitly set but isOidcConfigured(oidc) was false. That violated the
 * program's own acceptance rule ("missing required OIDC config must fail
 * closed; do not fall back to dev-header") — an operator who explicitly
 * opted into oidc-jwt but forgot one env var would have silently gotten
 * the dev-only trusted-header mode instead, in any non-production
 * environment. This function now always returns 'oidc-jwt' when that is
 * the explicit, recognized value — regardless of whether its config is
 * complete. The "is it actually usable" question is answered separately,
 * by isOidcConfigured() at the point of use (OidcJwtActorResolver and
 * the /api/readiness route both call it directly) — never by silently
 * resolving to a different PhoenixAuthMode. This mirrors how every other
 * explicit mode value is already handled here: 'production-disabled' and
 * 'token-placeholder' are honored as-is with no config precondition, and
 * 'oidc-jwt' now is too — the mode you asked for is the mode you get; a
 * misconfigured oidc-jwt fails closed as oidc-jwt-misconfigured, not as
 * some other mode. See
 * docs/auth/PHX_AUTH_002_R1_IMPLEMENTATION_REPORT.md for the full
 * before/after and the QA that confirms this.
 */
function resolveAuthMode(nodeEnv: NodeEnv): PhoenixAuthMode {
  const raw = readEnvVar('PHOENIX_AUTH_MODE')?.toLowerCase();
  const fallback = nodeEnv === 'production' ? 'production-disabled' : 'dev-header';

  if (raw && (VALID_AUTH_MODES as readonly string[]).includes(raw)) {
    return raw as PhoenixAuthMode;
  }

  return fallback;
}

/**
 * Resolves the backend's environment configuration. Safe to call at any
 * time — never throws, never requires secrets, never requires a database.
 */
export function getBackendEnv(): PhoenixBackendEnv {
  const databaseUrl = readEnvVar('DATABASE_URL');
  // Database is disabled by default. Both the flag AND a connection string
  // must be present for "enabled" to be true — but even then, this
  // foundation sprint never opens a connection (see readiness.ts route).
  const databaseEnabled = readBooleanEnvVar('PHOENIX_ENABLE_DATABASE', false) && Boolean(databaseUrl);
  const nodeEnv = resolveNodeEnv();
  const oidc = resolveOidcConfig();

  return {
    nodeEnv,
    port: resolvePort(),
    apiVersion: readEnvVar('PHOENIX_API_VERSION') ?? 'v0-alpha',
    databaseUrl,
    databaseEnabled,
    authMode: resolveAuthMode(nodeEnv),
    oidc,
  };
}

// ============================================================
// PHX-BACKEND-009 — Production auth-mode boot guard
// ------------------------------------------------------------
// Deliberately NOT part of getBackendEnv(): this file's contract (see
// header) is that resolving the environment never throws — that must
// stay true so getBackendEnv() remains safe to call from anywhere,
// including request handlers, tests, and other config resolution. A
// production boot with dev-header selected is the one situation this
// backend treats as fail-fast-worthy, so it gets its own explicit,
// separately-invoked function. src/index.ts calls this once, right
// after resolving env and before the HTTP server starts listening —
// see index.ts for the try/catch that turns a thrown Error here into a
// clean startup failure (non-zero exit) instead of an unhandled
// exception. No other module needs to call this.
// ============================================================

/** Env var name for the explicit, dangerous, documented-as-unsafe override below. */
export const DANGEROUS_DEV_HEADER_IN_PRODUCTION_OVERRIDE =
  'PHOENIX_DANGEROUSLY_ALLOW_DEV_HEADER_IN_PRODUCTION';

/**
 * Throws if `env.nodeEnv === 'production'` and `env.authMode ===
 * 'dev-header'`, unless the caller has explicitly set
 * PHOENIX_DANGEROUSLY_ALLOW_DEV_HEADER_IN_PRODUCTION=true — an
 * intentionally alarming name for an override that should never be set
 * in a real deployment (see .env.example). No-op for every other
 * nodeEnv/authMode combination.
 */
export function assertAuthModeSafeToBoot(env: PhoenixBackendEnv): void {
  if (env.nodeEnv !== 'production' || env.authMode !== 'dev-header') {
    return;
  }

  const dangerousOverride = readBooleanEnvVar(DANGEROUS_DEV_HEADER_IN_PRODUCTION_OVERRIDE, false);
  if (dangerousOverride) {
    return;
  }

  throw new Error(
    'PHOENIX_AUTH_MODE=dev-header is not allowed when NODE_ENV=production. ' +
      'The dev-only x-phoenix-user-id header must never be trusted as authentication ' +
      'in production. Set PHOENIX_AUTH_MODE=production-disabled (the production default ' +
      'if unset) or PHOENIX_AUTH_MODE=token-placeholder, or — only as a deliberate, ' +
      `reviewed exception — set ${DANGEROUS_DEV_HEADER_IN_PRODUCTION_OVERRIDE}=true. See ` +
      'docs/backend/PHX_BACKEND_009_IMPLEMENTATION_REPORT.md § Production guard.'
  );
}
