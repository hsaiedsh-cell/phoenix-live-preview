#!/usr/bin/env node
// ============================================================
// Phoenix Backend — Local Test Token Utility
// PHX-AUTH-002 — Hosted Auth Vendor Decision & Production Resolver
// ------------------------------------------------------------
// QA-only utility. Mints a JWT signed with the SAME local test-only
// RSA private key scripts/auth-test-jwks.mjs generated/served, for
// exercising oidc-jwt mode's verifier end-to-end without a real
// provider account. Run auth-test-jwks.mjs at least once first (it
// generates .auth-test/private-key.jwk.json).
//
// Usage:
//   node scripts/auth-test-token.mjs \
//     --sub test-subject-1 \
//     --email owen.fischer@acme-enterprise.example \
//     [--email-verified true|false]   (default: true)
//     [--iss https://phoenix-auth-test.local]
//     [--aud phoenix-backend-test]
//     [--exp-seconds 3600]            (default: 1 hour from now)
//     [--iat-offset-seconds 0]        (default: now; use a large
//                                       positive value to test the
//                                       "iat in the future" rejection)
//     [--alg none|HS256]              (produces a deliberately invalid
//                                       token for negative QA cases —
//                                       see QA report's alg-confusion
//                                       and unsigned-token tests)
//
// Prints only the raw token to stdout (nothing else), so it can be
// used directly:
//   TOKEN=$(node scripts/auth-test-token.mjs --sub u1 --email a@b.com)
//   curl -H "Authorization: Bearer $TOKEN" http://localhost:4000/api/workspaces/...
// ============================================================

import { importJWK, SignJWT } from 'jose';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

if ((process.env.NODE_ENV ?? '').toLowerCase() === 'production') {
  console.error(
    '[auth-test-token] Refusing to run with NODE_ENV=production. This is a QA-only utility.'
  );
  process.exit(1);
}

function flag(name, fallback) {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) return fallback;
  return process.argv[idx + 1];
}

const TEST_DIR = join(process.cwd(), '.auth-test');
const PRIVATE_KEY_PATH = join(TEST_DIR, 'private-key.jwk.json');

async function main() {
  const sub = flag('sub', 'test-subject-1');
  const email = flag('email', 'test-user@acme-enterprise.example');
  const emailVerified = flag('email-verified', 'true') === 'true';
  const iss = flag('iss', 'https://phoenix-auth-test.local');
  const aud = flag('aud', 'phoenix-backend-test');
  const expSeconds = Number.parseInt(flag('exp-seconds', '3600'), 10);
  const iatOffsetSeconds = Number.parseInt(flag('iat-offset-seconds', '0'), 10);
  const forcedAlg = flag('alg', undefined); // 'none' | 'HS256' — deliberately-invalid QA cases

  const nowSeconds = Math.floor(Date.now() / 1000) + iatOffsetSeconds;

  if (forcedAlg === 'none') {
    // Deliberately malformed: unsigned token with alg:none. Built by
    // hand (jose refuses to produce alg:none) so QA can confirm the
    // backend's algorithm allowlist rejects it — see
    // token-verifier.ts's ALLOWED_ALGORITHMS.
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({ sub, email, email_verified: emailVerified, iss, aud, iat: nowSeconds, exp: nowSeconds + expSeconds })
    ).toString('base64url');
    // alg:none tokens have an empty signature segment per the spec.
    console.log(`${header}.${payload}.`);
    return;
  }

  if (forcedAlg === 'HS256') {
    // Deliberately wrong-algorithm: HMAC-signed with an arbitrary
    // symmetric secret, to confirm the backend's asymmetric-only
    // ALLOWED_ALGORITHMS allowlist rejects it even though the
    // signature itself is validly formed for that (disallowed) alg.
    const secret = new TextEncoder().encode('qa-only-not-a-real-secret');
    const token = await new SignJWT({ email, email_verified: emailVerified })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(sub)
      .setIssuer(iss)
      .setAudience(aud)
      .setIssuedAt(nowSeconds)
      .setExpirationTime(nowSeconds + expSeconds)
      .sign(secret);
    console.log(token);
    return;
  }

  if (!existsSync(PRIVATE_KEY_PATH)) {
    console.error(
      `[auth-test-token] No test key found at ${PRIVATE_KEY_PATH}. Run scripts/auth-test-jwks.mjs first.`
    );
    process.exit(1);
  }

  const privateJwk = JSON.parse(readFileSync(PRIVATE_KEY_PATH, 'utf8'));
  const privateKey = await importJWK(privateJwk, 'RS256');

  const token = await new SignJWT({ email, email_verified: emailVerified })
    .setProtectedHeader({ alg: 'RS256', kid: privateJwk.kid })
    .setSubject(sub)
    .setIssuer(iss)
    .setAudience(aud)
    .setIssuedAt(nowSeconds)
    .setExpirationTime(nowSeconds + expSeconds)
    .sign(privateKey);

  console.log(token);
}

void main();
