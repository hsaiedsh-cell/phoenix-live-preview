// ============================================================
// public_intake_idempotency_keys repository (R2: state machine)
// PHX-LAUNCH-001-R2 §1.2
// ------------------------------------------------------------
// Replaces R1's advisory-lock-based design entirely. Every function
// here is ONE short, independent statement or transaction -- nothing
// holds a connection open across an external network call, and
// nothing relies on session state persisting between statements, so
// this is safe to run through a transaction-mode connection pooler
// (Supabase's normally-recommended pooling mode for serverless
// traffic).
//
// Concurrency safety comes entirely from `idempotency_key_hash` being
// a genuine UNIQUE column plus the INSERT ... ON CONFLICT ... DO
// UPDATE ... WHERE pattern in claimIdempotencyKey -- Postgres
// resolves a race between two concurrent INSERTs targeting the same
// key using its own internal row-level locking for the unique index,
// with no explicit application-level lock of any kind.
// ============================================================

import { randomBytes, createHash } from 'node:crypto';
import { intakeQuery, type TransactionQuery } from '../db';

export const IDEMPOTENCY_WINDOW_MINUTES = 15;

export type IdempotencyState = 'pending' | 'completed' | 'failed';

export interface IdempotencyKeyRow {
  id: string;
  idempotency_key_hash: string;
  payload_fingerprint: string;
  state: IdempotencyState;
  owner_token_hash: string;
  request_id: string | null;
  expires_at: Date;
  created_at: Date;
  updated_at: Date;
}

/** A fresh, server-generated, per-attempt token -- never derived from or equal to any client-supplied value. */
export function generateOwnerToken(): string {
  return randomBytes(24).toString('base64url');
}

export function hashOwnerToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

/**
 * Atomically attempts to claim the idempotency key for a new attempt.
 * Succeeds (returns the claimed row) when:
 *   - no row exists for this hash yet, OR
 *   - the existing row is expired, OR
 *   - the existing row is already 'failed'.
 * Returns null when an ACTIVE row already exists (pending, not yet
 * expired, or completed) -- the caller must then inspect that row
 * separately (see findByHash) to decide replay vs. conflict vs.
 * in-progress.
 *
 * This single statement is the entire concurrency-safety mechanism:
 * two truly concurrent callers racing to INSERT the same hash are
 * resolved by Postgres's own unique-index conflict handling, so
 * exactly one of them ever receives a non-empty RETURNING result for
 * a fresh claim.
 */
export async function claimIdempotencyKey(input: {
  idempotencyKeyHash: string;
  payloadFingerprint: string;
  ownerTokenHash: string;
  windowMinutes?: number;
}): Promise<IdempotencyKeyRow | null> {
  const rows = await intakeQuery<IdempotencyKeyRow>(
    `INSERT INTO public_intake_idempotency_keys
       (idempotency_key_hash, payload_fingerprint, state, owner_token_hash, request_id, expires_at, created_at, updated_at)
     VALUES ($1, $2, 'pending', $3, NULL, now() + make_interval(mins => $4), now(), now())
     ON CONFLICT (idempotency_key_hash) DO UPDATE
       SET payload_fingerprint = EXCLUDED.payload_fingerprint,
           state = 'pending',
           owner_token_hash = EXCLUDED.owner_token_hash,
           request_id = NULL,
           expires_at = EXCLUDED.expires_at,
           updated_at = now()
       WHERE public_intake_idempotency_keys.expires_at <= now()
          OR public_intake_idempotency_keys.state = 'failed'
     RETURNING *`,
    [input.idempotencyKeyHash, input.payloadFingerprint, input.ownerTokenHash, input.windowMinutes ?? IDEMPOTENCY_WINDOW_MINUTES]
  );
  return rows[0] ?? null;
}

export async function findByHash(idempotencyKeyHash: string): Promise<IdempotencyKeyRow | null> {
  const rows = await intakeQuery<IdempotencyKeyRow>(
    `SELECT * FROM public_intake_idempotency_keys WHERE idempotency_key_hash = $1`,
    [idempotencyKeyHash]
  );
  return rows[0] ?? null;
}

/**
 * Releases a claim back to 'failed' (immediately reclaimable) --
 * used when Turnstile or a rate limit rejects the attempt after a
 * successful claim. The owner-token check (PHX-LAUNCH-001-R2 §1.2
 * item 7: "only the owner of the active claim may complete or fail
 * it") means a stale/losing caller can never release a claim it did
 * not win.
 */
export async function releaseIdempotencyClaim(idempotencyKeyHash: string, ownerTokenHash: string): Promise<boolean> {
  const rows = await intakeQuery<IdempotencyKeyRow>(
    `UPDATE public_intake_idempotency_keys
       SET state = 'failed', updated_at = now()
       WHERE idempotency_key_hash = $1 AND owner_token_hash = $2 AND state = 'pending'
       RETURNING *`,
    [idempotencyKeyHash, ownerTokenHash]
  );
  return rows.length > 0;
}

/**
 * Transaction-scoped completion, called only after Turnstile and
 * rate limits have already succeeded, alongside the request-row
 * insert and its request.received event in the SAME transaction
 * (see submit.service.ts). The owner-token check means a claim that
 * somehow expired mid-flight (should be unreachable in normal
 * operation given the 15-minute window vs. millisecond-scale work)
 * cannot be completed by a caller who no longer legitimately owns it
 * -- the caller must treat a null return as a hard failure and roll
 * back the whole transaction.
 */
export async function completeIdempotencyClaimInTransaction(
  query: TransactionQuery,
  idempotencyKeyHash: string,
  ownerTokenHash: string,
  requestId: string
): Promise<IdempotencyKeyRow | null> {
  const rows = await query<IdempotencyKeyRow>(
    `UPDATE public_intake_idempotency_keys
       SET state = 'completed', request_id = $3, updated_at = now()
       WHERE idempotency_key_hash = $1 AND owner_token_hash = $2 AND state = 'pending'
       RETURNING *`,
    [idempotencyKeyHash, ownerTokenHash, requestId]
  );
  return rows[0] ?? null;
}
