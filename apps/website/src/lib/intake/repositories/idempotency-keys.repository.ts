// ============================================================
// public_intake_idempotency_keys repository
// PHX-LAUNCH-001-R1 §2.1 / §2.2
// ------------------------------------------------------------
// Concurrency-safety comes from db.ts's withAdvisoryLock (a
// session-scoped pg_advisory_lock spanning the whole submit flow,
// including the external Turnstile call) — NOT from a unique index
// on idempotency_key_hash, because that column is intentionally
// allowed to repeat once a prior row has expired (see the
// migration's header comment on this table). Every function here
// must be called with a query function obtained from INSIDE that
// same lock's scope (see submit.service.ts's resolveIdempotentReplay
// and finalizeNewSubmission) — calling these with an unrelated query
// function would silently defeat the whole mechanism.
// ============================================================

import type { TransactionQuery } from '../db';

export const IDEMPOTENCY_WINDOW_MINUTES = 15;

export interface IdempotencyKeyRow {
  id: string;
  idempotency_key_hash: string;
  payload_fingerprint: string;
  request_id: string;
  expires_at: Date;
  created_at: Date;
}

/**
 * Returns the most recent still-valid (non-expired) row for this key
 * hash, or null if none exists. Must be called from inside
 * withAdvisoryLock's scope for the concurrency guarantee to hold.
 */
export async function findActiveIdempotencyKey(
  query: TransactionQuery,
  idempotencyKeyHash: string
): Promise<IdempotencyKeyRow | null> {
  const rows = await query<IdempotencyKeyRow>(
    `SELECT * FROM public_intake_idempotency_keys
     WHERE idempotency_key_hash = $1 AND expires_at > now()
     ORDER BY created_at DESC
     LIMIT 1`,
    [idempotencyKeyHash]
  );
  return rows[0] ?? null;
}

export async function insertIdempotencyKey(
  query: TransactionQuery,
  input: { idempotencyKeyHash: string; payloadFingerprint: string; requestId: string; windowMinutes?: number }
): Promise<IdempotencyKeyRow> {
  const rows = await query<IdempotencyKeyRow>(
    `INSERT INTO public_intake_idempotency_keys (idempotency_key_hash, payload_fingerprint, request_id, expires_at)
     VALUES ($1, $2, $3, now() + make_interval(mins => $4))
     RETURNING *`,
    [input.idempotencyKeyHash, input.payloadFingerprint, input.requestId, input.windowMinutes ?? IDEMPOTENCY_WINDOW_MINUTES]
  );
  return rows[0];
}
