// ============================================================
// Intake hashing helpers — server-only
// PHX-LAUNCH-001
// ------------------------------------------------------------
// Every value derived here is a one-way HMAC-SHA256 keyed by
// INTAKE_HASH_SECRET. Raw IP addresses and raw idempotency keys are
// never persisted — only these hashes. This module has no
// dependency on any provider SDK, so it is fully unit-testable
// without any external credential.
// ============================================================

import { createHmac, randomBytes } from 'node:crypto';
import { serverConfig } from './config';

export function hmacHash(value: string, secret: string = serverConfig.intakeHashSecret): string {
  return createHmac('sha256', secret).update(value.trim().toLowerCase()).digest('hex');
}

/**
 * Normalizes an IP (v4 or v6, optionally with a port) before hashing
 * so that trivially-different representations of the same client
 * (e.g. a trailing port) do not defeat rate limiting.
 */
export function normalizeIp(rawIp: string): string {
  return rawIp.trim().replace(/^::ffff:/, '').split('%')[0];
}

export function ipHash(rawIp: string, secret?: string): string {
  return hmacHash(normalizeIp(rawIp), secret);
}

export function emailHash(email: string, secret?: string): string {
  return hmacHash(email, secret);
}

export function idempotencyKeyHash(idempotencyKey: string, secret?: string): string {
  return hmacHash(idempotencyKey, secret);
}

/**
 * Generates a cryptographically random, non-sequential raw upload
 * token. Only its SHA-256 hash (see tokenHash) is ever persisted;
 * the raw value exists only transiently to build the one-time
 * /upload/<token> URL delivered by email.
 */
export function generateRawUploadToken(): string {
  return randomBytes(32).toString('base64url');
}

export function tokenHash(rawToken: string): string {
  return createHmac('sha256', serverConfig.intakeHashSecret).update(rawToken).digest('hex');
}
