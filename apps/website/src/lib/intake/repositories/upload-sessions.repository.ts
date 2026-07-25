// ============================================================
// public_upload_sessions repository
// PHX-LAUNCH-001
// ------------------------------------------------------------
// Only ever stores a hash of the upload token — never the raw
// token. Enforces "single active session per request" both here
// (application-layer check before insert) and in the database
// (uq_upload_sessions_one_active_per_request partial unique index).
// ============================================================

import { intakeQuery, type TransactionQuery } from '../db';
import { UPLOAD_LIMITS } from '../config';

export type UploadSessionStatus = 'active' | 'used' | 'revoked' | 'expired';

export interface UploadSessionRow {
  id: string;
  request_id: string;
  token_hash: string;
  status: UploadSessionStatus;
  max_files: number;
  max_file_size_bytes: number;
  max_total_size_bytes: number;
  expires_at: Date;
  used_at: Date | null;
  revoked_at: Date | null;
  finalized_at: Date | null;
  created_at: Date;
}

export async function findActiveSessionForRequest(requestId: string): Promise<UploadSessionRow | null> {
  const rows = await intakeQuery<UploadSessionRow>(
    `SELECT * FROM public_upload_sessions WHERE request_id = $1 AND status = 'active'`,
    [requestId]
  );
  return rows[0] ?? null;
}

/**
 * R2 (§2.2 step 1): locks the session row for the duration of the
 * enclosing transaction. Used by completeUploadObject's atomic
 * revalidate-then-complete-then-finalize transaction, always BEFORE
 * locking the reservation row (see lockReservationForUpdate in
 * intake-files.repository.ts) -- a single, consistent lock order
 * across every call site, which is what prevents a classic
 * lock-ordering deadlock between concurrent completions.
 */
export async function lockSessionForUpdate(query: TransactionQuery, sessionId: string): Promise<UploadSessionRow | null> {
  const rows = await query<UploadSessionRow>(
    `SELECT * FROM public_upload_sessions WHERE id = $1 FOR UPDATE`,
    [sessionId]
  );
  return rows[0] ?? null;
}

/**
 * R2 (§2.2 step 7): the exactly-once finalization transition, now
 * called from INSIDE the same transaction as completion and the
 * request-status transition (unlike R1's finalizeSessionOnce, which
 * was its own separate statement/transaction, allowing a revoked or
 * expired session to be overwritten to 'used' if a completion raced
 * a revoke). The caller is responsible for having already
 * revalidated session.status/expires_at/revoked_at in this same
 * transaction via lockSessionForUpdate before calling this.
 */
export async function finalizeSessionInTransaction(query: TransactionQuery, sessionId: string): Promise<UploadSessionRow | null> {
  const rows = await query<UploadSessionRow>(
    `UPDATE public_upload_sessions
       SET status = 'used', used_at = COALESCE(used_at, now()), finalized_at = now()
       WHERE id = $1 AND finalized_at IS NULL
       RETURNING *`,
    [sessionId]
  );
  return rows[0] ?? null;
}

/** R1 (§4.3): transaction-scoped read, used inside the same transaction that will also create the session, to avoid a TOCTOU gap. */
export async function findActiveSessionForRequestInTransaction(
  query: TransactionQuery,
  requestId: string
): Promise<UploadSessionRow | null> {
  const rows = await query<UploadSessionRow>(
    `SELECT * FROM public_upload_sessions WHERE request_id = $1 AND status = 'active'`,
    [requestId]
  );
  return rows[0] ?? null;
}

export async function createUploadSession(requestId: string, tokenHash: string): Promise<UploadSessionRow> {
  const existingActive = await findActiveSessionForRequest(requestId);
  if (existingActive) {
    throw new Error('active_upload_session_already_exists');
  }
  const expiresAt = new Date(Date.now() + UPLOAD_LIMITS.tokenExpiryHours * 60 * 60 * 1000);
  const rows = await intakeQuery<UploadSessionRow>(
    `INSERT INTO public_upload_sessions (request_id, token_hash, max_files, max_file_size_bytes, max_total_size_bytes, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      requestId,
      tokenHash,
      UPLOAD_LIMITS.maxFiles,
      UPLOAD_LIMITS.maxFileSizeBytes,
      UPLOAD_LIMITS.maxTotalSizeBytes,
      expiresAt,
    ]
  );
  return rows[0];
}

/**
 * R1 (§4.3): transaction-scoped insert, called only after
 * findActiveSessionForRequestInTransaction has confirmed no active
 * session exists, inside the SAME transaction as the parent
 * request's status transition to upload_invited — so a mid-flight
 * failure can never leave the request in upload_invited without a
 * corresponding session.
 */
export async function createUploadSessionInTransaction(
  query: TransactionQuery,
  requestId: string,
  tokenHash: string
): Promise<UploadSessionRow> {
  const expiresAt = new Date(Date.now() + UPLOAD_LIMITS.tokenExpiryHours * 60 * 60 * 1000);
  const rows = await query<UploadSessionRow>(
    `INSERT INTO public_upload_sessions (request_id, token_hash, max_files, max_file_size_bytes, max_total_size_bytes, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      requestId,
      tokenHash,
      UPLOAD_LIMITS.maxFiles,
      UPLOAD_LIMITS.maxFileSizeBytes,
      UPLOAD_LIMITS.maxTotalSizeBytes,
      expiresAt,
    ]
  );
  return rows[0];
}

export async function findByTokenHash(tokenHash: string): Promise<UploadSessionRow | null> {
  const rows = await intakeQuery<UploadSessionRow>(
    `SELECT * FROM public_upload_sessions WHERE token_hash = $1`,
    [tokenHash]
  );
  return rows[0] ?? null;
}

export type TokenValidationResult =
  | { valid: true; session: UploadSessionRow }
  | { valid: false; reason: 'invalid' | 'expired' | 'revoked' | 'used' };

/** Pure decision function — no I/O — so it is trivially unit-testable. */
export function evaluateTokenValidity(session: UploadSessionRow | null, now: Date = new Date()): TokenValidationResult {
  if (!session) return { valid: false, reason: 'invalid' };
  if (session.status === 'revoked') return { valid: false, reason: 'revoked' };
  if (session.status === 'used') return { valid: false, reason: 'used' };
  if (session.status === 'expired' || session.expires_at.getTime() < now.getTime()) {
    return { valid: false, reason: 'expired' };
  }
  if (session.status !== 'active') return { valid: false, reason: 'invalid' };
  return { valid: true, session };
}

export async function markSessionUsed(id: string): Promise<void> {
  await intakeQuery(
    `UPDATE public_upload_sessions SET status = 'used', used_at = now() WHERE id = $1 AND status = 'active'`,
    [id]
  );
}

/**
 * R2: superseded by finalizeSessionInTransaction above, which is
 * always called from inside the same transaction that has already
 * revalidated the session and completed a reservation. This
 * non-transactional version was R1's finalization primitive and is
 * removed -- calling it standalone, outside a lock/revalidation
 * transaction, is exactly the race PHX-LAUNCH-001-R2 §2.1 describes
 * (a concurrently revoked/expired session could be overwritten to
 * 'used').
 */

export async function revokeSession(id: string): Promise<UploadSessionRow | null> {
  const rows = await intakeQuery<UploadSessionRow>(
    `UPDATE public_upload_sessions SET status = 'revoked', revoked_at = now()
     WHERE id = $1 AND status = 'active'
     RETURNING *`,
    [id]
  );
  return rows[0] ?? null;
}

export async function expireStaleSessions(dryRun = true): Promise<UploadSessionRow[]> {
  if (dryRun) {
    return intakeQuery<UploadSessionRow>(
      `SELECT * FROM public_upload_sessions WHERE status = 'active' AND expires_at < now()`
    );
  }
  return intakeQuery<UploadSessionRow>(
    `UPDATE public_upload_sessions SET status = 'expired'
     WHERE status = 'active' AND expires_at < now()
     RETURNING *`
  );
}
