// ============================================================
// public_intake_files repository (R1: reservation model)
// PHX-LAUNCH-001-R1 §1.1 / §1.2 / §1.3
// ------------------------------------------------------------
// Every reservation is created inside a transaction that holds
// `SELECT ... FOR UPDATE` on the parent public_upload_sessions row
// (see lockUploadSessionForUpdate), so concurrent sign requests for
// the same session serialize on that row lock and the count/total
// checks below can never both pass for more reservations than the
// session's limits allow (PHX-LAUNCH-001-R1 §1.2's required
// concurrency proof).
// ============================================================

import { intakeQuery, type TransactionQuery } from '../db';
import { UPLOAD_LIMITS } from '../config';

export type ReservationStatus = 'reserved' | 'completed' | 'failed' | 'expired' | 'cancelled';

export interface IntakeFileRow {
  id: string;
  request_id: string;
  upload_session_id: string;
  storage_object_key: string;
  original_filename: string;
  declared_content_type: string;
  declared_size_bytes: number;
  reservation_status: ReservationStatus;
  verified_content_type: string | null;
  verified_size_bytes: number | null;
  scan_status: 'pending_review' | 'cleared' | 'quarantined';
  created_at: Date;
  completed_at: Date | null;
}

export interface LockedSessionRow {
  id: string;
  request_id: string;
  status: string;
  max_files: number;
  max_file_size_bytes: number;
  max_total_size_bytes: number;
  expires_at: Date;
  revoked_at: Date | null;
  finalized_at: Date | null;
}

/**
 * Locks the parent session row for the duration of the enclosing
 * transaction. Every subsequent quota check/insert in that same
 * transaction is therefore serialized against every other concurrent
 * signing attempt for the SAME session (PHX-LAUNCH-001-R1 §1.2).
 */
export async function lockUploadSessionForUpdate(query: TransactionQuery, uploadSessionId: string): Promise<LockedSessionRow | null> {
  const rows = await query<LockedSessionRow>(
    `SELECT id, request_id, status, max_files, max_file_size_bytes, max_total_size_bytes, expires_at, revoked_at, finalized_at
     FROM public_upload_sessions WHERE id = $1 FOR UPDATE`,
    [uploadSessionId]
  );
  return rows[0] ?? null;
}

export interface SessionReservationTotals {
  reservedOrCompletedCount: number;
  reservedOrCompletedTotalBytes: number;
}

/**
 * Counts/sums every NON-failed, NON-expired reservation (i.e.
 * 'reserved' or 'completed') for the session. Must be called AFTER
 * lockUploadSessionForUpdate in the same transaction so the result
 * cannot change underneath the caller before the new reservation is
 * inserted.
 */
export async function getReservationTotalsForUpdate(
  query: TransactionQuery,
  uploadSessionId: string
): Promise<SessionReservationTotals> {
  const rows = await query<{ cnt: string; total: string | null }>(
    `SELECT count(*) AS cnt, COALESCE(sum(declared_size_bytes), 0) AS total
     FROM public_intake_files
     WHERE upload_session_id = $1 AND reservation_status IN ('reserved', 'completed')`,
    [uploadSessionId]
  );
  return {
    reservedOrCompletedCount: Number(rows[0]?.cnt ?? 0),
    reservedOrCompletedTotalBytes: Number(rows[0]?.total ?? 0),
  };
}

export type ReservationDecision =
  | { accepted: true }
  | { accepted: false; reason: 'file_count_exceeded' | 'total_size_exceeded' | 'per_file_size_exceeded' | 'content_type_not_allowed' | 'extension_not_allowed' };

export async function insertReservation(
  query: TransactionQuery,
  input: {
    requestId: string;
    uploadSessionId: string;
    storageObjectKey: string;
    originalFilename: string;
    declaredContentType: string;
    declaredSizeBytes: number;
  }
): Promise<IntakeFileRow> {
  const rows = await query<IntakeFileRow>(
    `INSERT INTO public_intake_files
       (request_id, upload_session_id, storage_object_key, original_filename, declared_content_type, declared_size_bytes, reservation_status)
     VALUES ($1, $2, $3, $4, $5, $6, 'reserved')
     RETURNING *`,
    [
      input.requestId,
      input.uploadSessionId,
      input.storageObjectKey,
      input.originalFilename,
      input.declaredContentType,
      input.declaredSizeBytes,
    ]
  );
  return rows[0];
}

/** PHX-LAUNCH-001-R1 §1.2: "a failed provider signing call releases or marks the reservation failed." */
export async function markReservationFailed(reservationId: string): Promise<void> {
  await intakeQuery(
    `UPDATE public_intake_files SET reservation_status = 'failed' WHERE id = $1 AND reservation_status = 'reserved'`,
    [reservationId]
  );
}

export async function findReservationByObjectKey(storageObjectKey: string): Promise<IntakeFileRow | null> {
  const rows = await intakeQuery<IntakeFileRow>(
    `SELECT * FROM public_intake_files WHERE storage_object_key = $1`,
    [storageObjectKey]
  );
  return rows[0] ?? null;
}

/**
 * R2 (§2.2 step 2): locks the reservation row for the duration of the
 * enclosing transaction. Always called AFTER lockSessionForUpdate in
 * upload-sessions.repository.ts within the same transaction -- a
 * single, consistent lock order (session, then reservation) across
 * every call site prevents a lock-ordering deadlock between
 * concurrent completions.
 */
export async function lockReservationForUpdate(query: TransactionQuery, storageObjectKey: string): Promise<IntakeFileRow | null> {
  const rows = await query<IntakeFileRow>(
    `SELECT * FROM public_intake_files WHERE storage_object_key = $1 FOR UPDATE`,
    [storageObjectKey]
  );
  return rows[0] ?? null;
}

/**
 * R2: transaction-scoped variant of completeReservationOnce, called
 * only after the enclosing transaction has already revalidated both
 * the locked session and this locked reservation row.
 */
export async function completeReservationInTransaction(
  query: TransactionQuery,
  reservationId: string,
  verifiedContentType: string,
  verifiedSizeBytes: number
): Promise<IntakeFileRow | null> {
  const rows = await query<IntakeFileRow>(
    `UPDATE public_intake_files
       SET reservation_status = 'completed', verified_content_type = $2, verified_size_bytes = $3, completed_at = now()
       WHERE id = $1 AND reservation_status = 'reserved'
       RETURNING *`,
    [reservationId, verifiedContentType, verifiedSizeBytes]
  );
  return rows[0] ?? null;
}

/** R2: transaction-scoped completed-file count, used inside the same transaction as the completion above so it reflects that just-completed row. */
export async function countCompletedForSessionInTransaction(query: TransactionQuery, uploadSessionId: string): Promise<number> {
  const rows = await query<{ cnt: string }>(
    `SELECT count(*) AS cnt FROM public_intake_files WHERE upload_session_id = $1 AND reservation_status = 'completed'`,
    [uploadSessionId]
  );
  return Number(rows[0]?.cnt ?? 0);
}

/**
 * R4 (§2.3): atomically transitions exactly one 'reserved' row to
 * 'cancelled', releasing its quota. The `WHERE reservation_status =
 * 'reserved'` clause is what makes "completed reservations can never
 * be cancelled" and "duplicate cancellation is idempotent" both true
 * at the database layer -- a second cancel attempt (or one racing a
 * completion) simply matches zero rows.
 */
export async function cancelReservationInTransaction(query: TransactionQuery, reservationId: string): Promise<IntakeFileRow | null> {
  const rows = await query<IntakeFileRow>(
    `UPDATE public_intake_files
       SET reservation_status = 'cancelled'
       WHERE id = $1 AND reservation_status = 'reserved'
       RETURNING *`,
    [reservationId]
  );
  return rows[0] ?? null;
}

/**
 * Atomically transitions exactly one 'reserved' row to 'completed'.
 * The `WHERE reservation_status = 'reserved'` clause is what makes
 * "already-completed object cannot complete twice" true at the
 * database layer -- a second concurrent completion attempt for the
 * same row gets an empty result, not a second successful update.
 */
export async function completeReservationOnce(
  reservationId: string,
  verifiedContentType: string,
  verifiedSizeBytes: number
): Promise<IntakeFileRow | null> {
  const rows = await intakeQuery<IntakeFileRow>(
    `UPDATE public_intake_files
       SET reservation_status = 'completed', verified_content_type = $2, verified_size_bytes = $3, completed_at = now()
       WHERE id = $1 AND reservation_status = 'reserved'
       RETURNING *`,
    [reservationId, verifiedContentType, verifiedSizeBytes]
  );
  return rows[0] ?? null;
}

export async function countCompletedForSession(uploadSessionId: string): Promise<number> {
  const rows = await intakeQuery<{ cnt: string }>(
    `SELECT count(*) AS cnt FROM public_intake_files WHERE upload_session_id = $1 AND reservation_status = 'completed'`,
    [uploadSessionId]
  );
  return Number(rows[0]?.cnt ?? 0);
}

export async function listFilesForSession(uploadSessionId: string): Promise<IntakeFileRow[]> {
  return intakeQuery<IntakeFileRow>(
    `SELECT * FROM public_intake_files WHERE upload_session_id = $1 ORDER BY created_at ASC`,
    [uploadSessionId]
  );
}

/**
 * R4 (§1): the authoritative-state summary GET /api/upload/:token
 * returns. Deliberately narrow -- callers must never widen this to
 * include request_id, storage_object_key is the only identifier
 * exposed (already server-generated, opaque, and safe -- see
 * object-key.ts), and no field here can be traced back to a
 * database UUID, token hash, email, customer message, or IP hash.
 * Counts/bytes are computed from 'reserved' and 'completed' rows
 * only (never 'failed'/'expired'/'cancelled', which no longer
 * consume quota).
 */
export interface PendingReservationSummary {
  storageObjectKey: string;
  originalFilename: string;
  declaredContentType: string;
  declaredSizeBytes: number;
  reservationStatus: 'reserved';
}

export interface SessionStateSummary {
  completedCount: number;
  completedBytes: number;
  reservedCount: number;
  reservedBytes: number;
  pendingReservations: PendingReservationSummary[];
}

export async function getSessionStateSummary(uploadSessionId: string): Promise<SessionStateSummary> {
  const rows = await intakeQuery<{
    storage_object_key: string;
    original_filename: string;
    declared_content_type: string;
    declared_size_bytes: number;
    reservation_status: ReservationStatus;
  }>(
    `SELECT storage_object_key, original_filename, declared_content_type, declared_size_bytes, reservation_status
     FROM public_intake_files
     WHERE upload_session_id = $1 AND reservation_status IN ('reserved', 'completed')
     ORDER BY created_at ASC`,
    [uploadSessionId]
  );

  let completedCount = 0;
  let completedBytes = 0;
  let reservedCount = 0;
  let reservedBytes = 0;
  const pendingReservations: PendingReservationSummary[] = [];

  for (const row of rows) {
    if (row.reservation_status === 'completed') {
      completedCount += 1;
      completedBytes += row.declared_size_bytes;
    } else {
      reservedCount += 1;
      reservedBytes += row.declared_size_bytes;
      pendingReservations.push({
        storageObjectKey: row.storage_object_key,
        originalFilename: row.original_filename,
        declaredContentType: row.declared_content_type,
        declaredSizeBytes: row.declared_size_bytes,
        reservationStatus: 'reserved',
      });
    }
  }

  return { completedCount, completedBytes, reservedCount, reservedBytes, pendingReservations };
}

// ---- Orphan handling (PHX-LAUNCH-001-R1 §1.6) ----------------

export interface OrphanReservationRow extends IntakeFileRow {
  reason: 'expired_reserved' | 'failed' | 'cancelled';
}

/**
 * Reservations that are still 'reserved' but whose parent upload
 * session has already expired (customer never completed the
 * upload), plus rows already marked 'failed' or 'cancelled' --
 * cancellation (R4 §2.3) attempts a best-effort provider deletion at
 * cancel time, but if that deletion failed, the row's provider
 * object may still exist and must remain discoverable here so a
 * later cleanup pass retries it. Never includes 'completed' rows --
 * completed customer files are never touched by cleanup.
 */
export async function findOrphanReservations(): Promise<OrphanReservationRow[]> {
  return intakeQuery<OrphanReservationRow>(
    `SELECT f.*, CASE
       WHEN f.reservation_status = 'failed' THEN 'failed'
       WHEN f.reservation_status = 'cancelled' THEN 'cancelled'
       ELSE 'expired_reserved'
     END AS reason
     FROM public_intake_files f
     JOIN public_upload_sessions s ON s.id = f.upload_session_id
     WHERE f.reservation_status IN ('failed', 'cancelled')
        OR (f.reservation_status = 'reserved' AND s.expires_at < now())
     ORDER BY f.created_at ASC`
  );
}

/**
 * R2 (§4.2): marks exactly ONE reservation row 'expired'. Unlike R1's
 * bulk expireOrphanReservations, this is called by the ops CLI only
 * AFTER the storage adapter has successfully deleted (or confirmed
 * absent -- see StorageAdapter.deleteObject's "not found is an
 * idempotent success" contract) the underlying provider object for
 * THIS row -- R1's bulk update changed database status without ever
 * removing the object from the private bucket, leaving orphaned
 * customer files in Storage indefinitely, which is exactly the gap
 * R2 closes. Never touches a 'completed' row (the WHERE clause only
 * matches 'reserved' or already-'failed' rows, matching
 * findOrphanReservations' own definition of an orphan).
 */
export async function markReservationExpired(reservationId: string): Promise<IntakeFileRow | null> {
  const rows = await intakeQuery<IntakeFileRow>(
    `UPDATE public_intake_files
       SET reservation_status = 'expired'
       WHERE id = $1 AND reservation_status IN ('reserved', 'failed', 'cancelled')
       RETURNING *`,
    [reservationId]
  );
  return rows[0] ?? null;
}
