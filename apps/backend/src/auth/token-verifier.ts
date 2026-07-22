// ============================================================
// Phoenix Backend — JWT/JWKS Token Verifier
// PHX-AUTH-002 — Hosted Auth Vendor Decision & Production Resolver
// ------------------------------------------------------------
// Verifies a bearer token's signature via a remote JWKS endpoint using
// `jose` (no hand-rolled crypto). This module never trusts a token's
// role/workspace/organization claims for authorization — it produces
// only a VerifiedExternalIdentity (subject/email/emailVerified/
// displayName/issuer/audience/provider), which
// src/repositories/auth-identity.repository.ts maps to a Phoenix
// users.id. Everything downstream of that mapping (role, membership,
// permission) remains exactly as it was before this sprint — see
// src/auth/request-actor.ts.
//
// `jose` is ESM-only; this backend compiles to CommonJS (see
// tsconfig.json's "module": "commonjs"), so it is loaded via a
// dynamic `import()` (which Node supports from CJS) rather than a
// static `require()`/`import` — see loadJose() below.
//
// Enforced, non-negotiable per docs/auth/PHX_AUTH_001_IMPLEMENTATION_PLAN.md §2:
//   - signature verified via JWKS (kid-aware, cached, rotation-tolerant
//     — jose's createRemoteJWKSet handles caching/rotation internally)
//   - issuer: exact allowlist match (single configured issuer)
//   - audience: exact match against the configured audience
//   - expiration: always enforced, with a small configurable clock-skew
//     tolerance (PHOENIX_AUTH_CLOCK_SKEW_SECONDS, default 60s)
//   - iat sanity check: rejects a token whose iat is in the future
//     beyond the same clock-skew tolerance
//   - algorithm allowlist: only asymmetric algorithms (RS256/RS384/
//     RS512/ES256/ES384/ES512/PS256/PS384/PS512) are ever accepted;
//     `alg: none` and any HMAC (HSxxx) algorithm are always rejected —
//     jose's jwtVerify() is passed an explicit `algorithms` allowlist,
//     so an attacker cannot force a different algorithm via the token
//     header (the classic "alg confusion" downgrade)
//   - unsigned tokens are always rejected (jwtVerify() requires a
//     valid signature against the JWKS; there is no "skip verification"
//     branch anywhere in this file, in test or production code)
//   - missing `email` claim → rejected
//   - `email_verified` claim absent or false → rejected
//
// Raw token contents are never logged and never returned to any HTTP
// client — only the structured VerifiedExternalIdentity (or a generic
// failure reason) leaves this module.
// ============================================================

import type { PhoenixOidcConfig } from '../config/env';

/** The verified, provider-agnostic identity this module ever produces. */
export interface VerifiedExternalIdentity {
  provider: string;
  subject: string;
  email: string;
  emailVerified: boolean;
  displayName?: string;
  issuer: string;
  audience: string;
}

export type TokenVerificationResult =
  | { ok: true; identity: VerifiedExternalIdentity }
  | { ok: false; reason: TokenVerificationFailureReason; detail?: string };

/**
 * Coarse, non-sensitive failure classification — never includes raw
 * token contents. `resolver` callers (see actor-resolver.ts) map these
 * to HTTP status/ApiErrorCodes; this module itself has no knowledge of
 * HTTP.
 */
export type TokenVerificationFailureReason =
  | 'not_configured'
  | 'missing_token'
  | 'malformed_token'
  | 'invalid_signature'
  | 'invalid_issuer'
  | 'invalid_audience'
  | 'expired'
  | 'invalid_algorithm'
  | 'missing_email'
  | 'email_not_verified'
  | 'verification_error';

/**
 * Only asymmetric, JWKS-verifiable algorithms are ever accepted.
 * `none` and every HMAC (`HSxxx`) algorithm are deliberately absent —
 * passing this exact list to jose's `jwtVerify()` `algorithms` option
 * means jose itself refuses any token whose header claims a different
 * algorithm, regardless of what the token's own header says.
 */
const ALLOWED_ALGORITHMS: readonly string[] = [
  'RS256',
  'RS384',
  'RS512',
  'ES256',
  'ES384',
  'ES512',
  'PS256',
  'PS384',
  'PS512',
];

// `jose` is ESM-only. Cached across calls so repeated verifications
// (and the local JWKS test utility) do not re-import per request.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let josePromise: Promise<any> | undefined;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function loadJose(): Promise<any> {
  if (!josePromise) {
    josePromise = import('jose');
  }
  return josePromise;
}

// Remote JWKS sets are cached per jwksUri so repeated verifications
// reuse jose's internal cache/rotation handling instead of re-fetching
// the JWKS document on every request.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const jwksCache = new Map<string, any>();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getRemoteJwks(jose: any, jwksUri: string): Promise<any> {
  const cached = jwksCache.get(jwksUri);
  if (cached) return cached;
  const jwks = jose.createRemoteJWKSet(new URL(jwksUri));
  jwksCache.set(jwksUri, jwks);
  return jwks;
}

/** Extracts a Bearer token from an Authorization header value, or undefined. */
export function extractBearerToken(authorizationHeader: string | undefined): string | undefined {
  if (!authorizationHeader) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader.trim());
  const token = match?.[1]?.trim();
  return token && token.length > 0 ? token : undefined;
}

function readClaim(payload: Record<string, unknown>, claim: string): unknown {
  return payload[claim];
}

/**
 * Verifies `token` against `oidc`'s configured issuer/audience/JWKS
 * URI. Returns a VerifiedExternalIdentity on success, or a structured,
 * non-sensitive failure reason. Never throws — every error path
 * (network failure, malformed token, signature failure, expired,
 * wrong issuer/audience, missing/unverified email) is caught and
 * mapped to `{ ok: false, reason, detail? }`.
 */
export async function verifyBearerToken(
  token: string,
  oidc: PhoenixOidcConfig
): Promise<TokenVerificationResult> {
  if (!oidc.issuer || !oidc.audience || !oidc.jwksUri || !oidc.provider) {
    return { ok: false, reason: 'not_configured' };
  }
  if (!token || token.trim().length === 0) {
    return { ok: false, reason: 'missing_token' };
  }

  let jose;
  try {
    jose = await loadJose();
  } catch (err) {
    return {
      ok: false,
      reason: 'verification_error',
      detail: err instanceof Error ? err.message : 'Failed to load token verification library.',
    };
  }

  let jwks;
  try {
    jwks = await getRemoteJwks(jose, oidc.jwksUri);
  } catch (err) {
    return {
      ok: false,
      reason: 'verification_error',
      detail: err instanceof Error ? err.message : 'Failed to load JWKS endpoint.',
    };
  }

  let payload: Record<string, unknown>;
  try {
    const result = await jose.jwtVerify(token, jwks, {
      issuer: oidc.issuer,
      audience: oidc.audience,
      algorithms: ALLOWED_ALGORITHMS,
      clockTolerance: oidc.clockSkewSeconds,
    });
    payload = result.payload as Record<string, unknown>;
  } catch (err) {
    return classifyVerificationError(err);
  }

  // iat sanity check: reject a token whose iat is in the future beyond
  // the configured clock-skew tolerance. jose's clockTolerance already
  // covers exp/nbf/iat-adjacent checks for standard claims it enforces
  // directly, but iat itself is only a hint to jose, not one of the
  // claims it rejects on by default — so it is checked explicitly here.
  const iat = payload.iat;
  if (typeof iat === 'number') {
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (iat > nowSeconds + oidc.clockSkewSeconds) {
      return { ok: false, reason: 'expired', detail: 'Token iat is in the future.' };
    }
  }

  const subject = payload.sub;
  if (typeof subject !== 'string' || subject.trim().length === 0) {
    return { ok: false, reason: 'malformed_token', detail: 'Missing sub claim.' };
  }

  const email = readClaim(payload, oidc.emailClaim);
  if (typeof email !== 'string' || email.trim().length === 0) {
    return { ok: false, reason: 'missing_email' };
  }

  const emailVerified = readClaim(payload, oidc.emailVerifiedClaim);
  if (emailVerified !== true) {
    return { ok: false, reason: 'email_not_verified' };
  }

  const displayNameClaim = readClaim(payload, oidc.displayNameClaim);
  const displayName = typeof displayNameClaim === 'string' ? displayNameClaim : undefined;

  return {
    ok: true,
    identity: {
      provider: oidc.provider,
      subject,
      email,
      emailVerified: true,
      displayName,
      issuer: oidc.issuer,
      audience: oidc.audience,
    },
  };
}

/**
 * Maps a thrown jose verification error to a structured, non-sensitive
 * failure reason. jose throws distinct named errors for each failure
 * category (JWTExpired, JWTClaimValidationFailed for issuer/audience,
 * JWSSignatureVerificationFailed, JOSEAlgNotAllowed, JWSInvalid /
 * JWTInvalid for malformed input) — this function inspects the error's
 * `code`/`name` rather than its message, since messages may vary by
 * jose version and are not a stable contract.
 */
function classifyVerificationError(err: unknown): { ok: false; reason: TokenVerificationFailureReason; detail?: string } {
  const code = (err as { code?: string } | undefined)?.code;
  const name = (err as { name?: string } | undefined)?.name;
  const claim = (err as { claim?: string } | undefined)?.claim;

  if (code === 'ERR_JWT_EXPIRED' || name === 'JWTExpired') {
    return { ok: false, reason: 'expired' };
  }
  if (code === 'ERR_JWT_CLAIM_VALIDATION_FAILED' || name === 'JWTClaimValidationFailed') {
    if (claim === 'iss') return { ok: false, reason: 'invalid_issuer' };
    if (claim === 'aud') return { ok: false, reason: 'invalid_audience' };
    return { ok: false, reason: 'malformed_token', detail: `Claim validation failed: ${claim ?? 'unknown'}` };
  }
  if (code === 'ERR_JOSE_ALG_NOT_ALLOWED' || name === 'JOSEAlgNotAllowed') {
    return { ok: false, reason: 'invalid_algorithm' };
  }
  if (
    code === 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED' ||
    name === 'JWSSignatureVerificationFailed'
  ) {
    return { ok: false, reason: 'invalid_signature' };
  }
  if (name === 'JWSInvalid' || name === 'JWTInvalid' || code === 'ERR_JWS_INVALID' || code === 'ERR_JWT_INVALID') {
    return { ok: false, reason: 'malformed_token' };
  }

  return {
    ok: false,
    reason: 'verification_error',
    detail: err instanceof Error ? err.message : 'Unknown token verification error.',
  };
}
