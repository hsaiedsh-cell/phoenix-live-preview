// ============================================================
// Upload flow service -- token validation, reservation-based
// signing, atomically-revalidated completion/finalization,
// cancellation, and authoritative state reporting
// PHX-LAUNCH-001 (R4: PHX-LAUNCH-001-R4 §1, §2, §3, §4)
// ------------------------------------------------------------
// Backs GET /api/upload/:token, POST /api/upload/:token/sign,
// POST /api/upload/:token/complete, and POST /api/upload/:token/cancel
// (new in R4). Public but invitation-only: anonymous callers without
// a valid token are always denied.
//
// R4 correction summary:
//  - §1: checkUploadToken now returns the full authoritative state
//    contract (counts/bytes/pending reservations) the addendum
//    requires, computed from intake-files.repository.ts's
//    getSessionStateSummary -- never database UUIDs, request UUID,
//    token hash, email, message, or IP hash.
//  - §2: a new cancelUploadReservation lets the token holder release
//    a still-`reserved` object's quota (mark 'cancelled', best-effort
//    provider deletion after commit). Completed reservations can
//    never be cancelled; a duplicate cancel is idempotent.
//  - §3: maybeFinalizeInTransaction now ALWAYS returns the
//    authoritative completedCount computed inside the same
//    transaction that completed the reservation and/or finalized the
//    session. completeUploadObject and finishUploadSession no longer
//    issue a separate post-commit countCompletedForSession query to
//    build their success response -- a post-commit pool/query
//    failure can therefore never turn an already-committed completion
//    into an HTTP 500.
//  - §4: every OBSERVATIONAL event (token accepted/denied, file
//    rejected, object signed, reservation signing failed, completion
//    denied) now goes through recordPostCommitEvent (never throws).
//    upload.reservation_created moved INSIDE the sign transaction
//    (it is a CORE event proving reservation state, per the
//    addendum's classification) -- previously it was recorded after
//    commit with a plain, throwable call, which is exactly the "most
//    serious path" failure mode the addendum describes: a failed
//    event insert could 500 a request whose reservation had already
//    committed and already consumed quota, without ever returning the
//    signed URL.
// ============================================================

import { tokenHash } from './hash';
import * as uploadSessionsRepo from './repositories/upload-sessions.repository';
import * as intakeFilesRepo from './repositories/intake-files.repository';
import * as eventsRepo from './repositories/intake-events.repository';
import * as intakeRequestsRepo from './repositories/intake-requests.repository';
import { recordPostCommitEvent } from './post-commit';
import { generateStorageObjectKey } from './object-key';
import { getStorageAdapter, sendEmailSafely } from './adapters';
import { buildUploadCompleteInternalEmail } from './adapters/email.adapter';
import { serverConfig } from './config';
import { withIntakeTransaction, type TransactionQuery } from './db';
import { UPLOAD_LIMITS } from './config';
import { isDangerousExtension, isExtensionCompatibleWithMimeType } from './extension-validation';

export type TokenCheckOutcome =
  | { kind: 'denied'; reason: 'invalid' | 'expired' | 'revoked' | 'used' }
  | {
      kind: 'ok';
      maxFiles: number;
      maxFileSizeBytes: number;
      maxTotalSizeBytes: number;
      completedCount: number;
      reservedCount: number;
      reservedBytes: number;
      completedBytes: number;
      remainingFileSlots: number;
      remainingBytes: number;
      expiresAt: Date;
      pendingReservations: intakeFilesRepo.PendingReservationSummary[];
    };

/** R4 (§1): the full, authoritative, privacy-safe token-state contract. Never logs any of the returned values. */
export async function checkUploadToken(rawToken: string): Promise<TokenCheckOutcome> {
  const hash = tokenHash(rawToken);
  const session = await uploadSessionsRepo.findByTokenHash(hash);
  const validity = uploadSessionsRepo.evaluateTokenValidity(session);

  if (!validity.valid) {
    const eventByReason = {
      invalid: 'upload.token_denied_invalid',
      expired: 'upload.token_denied_expired',
      revoked: 'upload.token_denied_revoked',
      used: 'upload.token_denied_used',
    } as const;
    if (session) {
      // R4 (§4): observational, best-effort -- must never throw.
      await recordPostCommitEvent(session.request_id, eventByReason[validity.reason], { route: 'checkUploadToken' });
    }
    return { kind: 'denied', reason: validity.reason };
  }

  await recordPostCommitEvent(validity.session.request_id, 'upload.token_accepted', { route: 'checkUploadToken' });

  const summary = await intakeFilesRepo.getSessionStateSummary(validity.session.id);
  const remainingFileSlots = Math.max(0, validity.session.max_files - summary.reservedCount - summary.completedCount);
  const remainingBytes = Math.max(0, validity.session.max_total_size_bytes - summary.reservedBytes - summary.completedBytes);

  return {
    kind: 'ok',
    maxFiles: validity.session.max_files,
    maxFileSizeBytes: validity.session.max_file_size_bytes,
    maxTotalSizeBytes: validity.session.max_total_size_bytes,
    completedCount: summary.completedCount,
    reservedCount: summary.reservedCount,
    reservedBytes: summary.reservedBytes,
    completedBytes: summary.completedBytes,
    remainingFileSlots,
    remainingBytes,
    expiresAt: validity.session.expires_at,
    pendingReservations: summary.pendingReservations,
  };
}

export type SignUploadOutcome =
  | { kind: 'denied'; reason: 'invalid' | 'expired' | 'revoked' | 'used' }
  | {
      kind: 'rejected';
      reason: 'file_count_exceeded' | 'total_size_exceeded' | 'per_file_size_exceeded' | 'content_type_not_allowed' | 'extension_not_allowed';
    }
  | { kind: 'signing_failed' }
  | { kind: 'ok'; uploadUrl: string; storageObjectKey: string };

const ALLOWED_CONTENT_TYPES = UPLOAD_LIMITS.allowedContentTypes as readonly string[];

/** R3 (§2)/R4: the single revalidation rule shared by every locked-transaction check in this file -- status/expiry/revocation/finalization, all four, always together. Exported so QA can prove this SPECIFIC check independently. */
export function isLockedSessionStillValid(lockedSession: { status: string; expires_at: Date; revoked_at: Date | null; finalized_at: Date | null }): boolean {
  return (
    lockedSession.status === 'active' &&
    lockedSession.expires_at.getTime() > Date.now() &&
    lockedSession.revoked_at === null &&
    lockedSession.finalized_at === null
  );
}

export async function signUploadObject(
  rawToken: string,
  candidate: { filename: string; contentType: string; sizeBytes: number }
): Promise<SignUploadOutcome> {
  const hash = tokenHash(rawToken);
  const session = await uploadSessionsRepo.findByTokenHash(hash);
  const validity = uploadSessionsRepo.evaluateTokenValidity(session);
  if (!validity.valid) {
    return { kind: 'denied', reason: validity.reason };
  }

  // R4 (§4): "file rejected" is an observational event -- best-effort.
  if (isDangerousExtension(candidate.filename)) {
    await recordPostCommitEvent(validity.session.request_id, 'upload.file_rejected_extension', { route: 'signUploadObject' });
    return { kind: 'rejected', reason: 'extension_not_allowed' };
  }
  if (!ALLOWED_CONTENT_TYPES.includes(candidate.contentType)) {
    await recordPostCommitEvent(validity.session.request_id, 'upload.file_rejected_type', { route: 'signUploadObject' });
    return { kind: 'rejected', reason: 'content_type_not_allowed' };
  }
  if (!isExtensionCompatibleWithMimeType(candidate.filename, candidate.contentType)) {
    await recordPostCommitEvent(validity.session.request_id, 'upload.file_rejected_extension', { route: 'signUploadObject' });
    return { kind: 'rejected', reason: 'extension_not_allowed' };
  }
  if (candidate.sizeBytes > UPLOAD_LIMITS.maxFileSizeBytes) {
    await recordPostCommitEvent(validity.session.request_id, 'upload.file_rejected_size', { route: 'signUploadObject' });
    return { kind: 'rejected', reason: 'per_file_size_exceeded' };
  }

  // R4 (§4): upload.reservation_created is CORE -- written inside the
  // SAME transaction that inserts the reservation, never after
  // commit. This is the exact "most serious path" the addendum
  // describes: an R2/R3-era post-commit event failure here could 500
  // a request whose reservation had already committed and already
  // consumed quota, without the customer ever receiving the signed URL.
  const reservationResult = await withIntakeTransaction(async (query) => {
    const lockedSession = await intakeFilesRepo.lockUploadSessionForUpdate(query, validity.session.id);
    if (!lockedSession || !isLockedSessionStillValid(lockedSession)) {
      return { kind: 'denied' as const, reason: 'invalid' as const };
    }
    const totals = await intakeFilesRepo.getReservationTotalsForUpdate(query, validity.session.id);
    if (totals.reservedOrCompletedCount + 1 > lockedSession.max_files) {
      return { kind: 'rejected' as const, reason: 'file_count_exceeded' as const };
    }
    if (totals.reservedOrCompletedTotalBytes + candidate.sizeBytes > lockedSession.max_total_size_bytes) {
      return { kind: 'rejected' as const, reason: 'total_size_exceeded' as const };
    }
    const objectKey = generateStorageObjectKey(validity.session.id);
    const reservation = await intakeFilesRepo.insertReservation(query, {
      requestId: validity.session.request_id,
      uploadSessionId: validity.session.id,
      storageObjectKey: objectKey,
      originalFilename: candidate.filename,
      declaredContentType: candidate.contentType,
      declaredSizeBytes: candidate.sizeBytes,
    });
    await eventsRepo.recordEventInTransaction(query, validity.session.request_id, 'upload.reservation_created');
    return { kind: 'ok' as const, reservation };
  });

  if (reservationResult.kind === 'denied') {
    return { kind: 'denied', reason: reservationResult.reason };
  }
  if (reservationResult.kind === 'rejected') {
    await recordPostCommitEvent(validity.session.request_id, 'upload.file_rejected_size', { route: 'signUploadObject' });
    return { kind: 'rejected', reason: reservationResult.reason };
  }

  const { reservation } = reservationResult;

  try {
    const signed = await getStorageAdapter().createSignedUploadUrl(reservation.storage_object_key);
    // R4 (§4): observational -- must never turn a successfully
    // signed URL into a failure response.
    await recordPostCommitEvent(validity.session.request_id, 'upload.object_signed', { route: 'signUploadObject' });
    return { kind: 'ok', uploadUrl: signed.uploadUrl, storageObjectKey: signed.storageObjectKey };
  } catch {
    // The reservation already committed (core, above) -- releasing
    // its quota on a real provider failure is itself a core state
    // change, so it stays a direct (not best-effort) call; only the
    // OBSERVATIONAL event about it is best-effort.
    await intakeFilesRepo.markReservationFailed(reservation.id);
    await recordPostCommitEvent(validity.session.request_id, 'upload.reservation_failed', { route: 'signUploadObject' });
    return { kind: 'signing_failed' };
  }
}

export type CompleteUploadOutcome =
  | { kind: 'denied'; reason: 'invalid' | 'expired' | 'revoked' | 'used' }
  | {
      kind: 'completion_denied';
      reason:
        | 'unknown_object_key'
        | 'foreign_session'
        | 'not_reserved'
        | 'provider_metadata_unavailable'
        | 'metadata_mismatch'
        | 'extension_mismatch'
        | 'session_revalidation_failed';
    }
  | { kind: 'ok'; fileCount: number; finalized: boolean };

/**
 * Sends the post-commit upload-complete notification. Never throws
 * (R3 §4, unchanged in R4).
 */
async function sendUploadCompleteNotification(requestId: string, publicReference: string, fileCount: number): Promise<void> {
  try {
    const email = buildUploadCompleteInternalEmail({ publicReference, fileCount });
    email.to = serverConfig.intakeInternalToEmail;
    email.idempotencyKey = `upload-complete/${requestId}`;
    const sendResult = await sendEmailSafely(email);
    await recordPostCommitEvent(
      requestId,
      sendResult.success ? 'request.upload_complete_notification_sent' : 'request.upload_complete_notification_failed',
      { route: 'upload-complete-notification' }
    );
  } catch {
    // Defensive only -- see this function's own contract: it never
    // propagates a failure to its caller.
  }
}

type FinalizationTransactionResult =
  | { kind: 'not_finalized'; completedCount: number }
  | { kind: 'finalized'; requestId: string; publicReference: string; completedCount: number };

/**
 * R3 (§1) + R4 (§3): runs INSIDE the caller's already-open
 * transaction. ALWAYS returns the authoritative completedCount
 * computed in THIS transaction, for both branches -- so
 * completeUploadObject/finishUploadSession never need a separate
 * post-commit query to learn it (R4 §3's required correction).
 */
async function maybeFinalizeInTransaction(
  query: TransactionQuery,
  lockedSession: { id: string; request_id: string; max_files: number },
  requestFinish: boolean
): Promise<FinalizationTransactionResult> {
  const completedCount = await intakeFilesRepo.countCompletedForSessionInTransaction(query, lockedSession.id);
  const reachedMax = completedCount >= lockedSession.max_files;
  if (!requestFinish && !reachedMax) {
    return { kind: 'not_finalized', completedCount };
  }
  if (completedCount < 1) {
    await eventsRepo.recordEventInTransaction(query, lockedSession.request_id, 'upload.finalization_rejected_zero_files');
    return { kind: 'not_finalized', completedCount };
  }

  const lockedRequest = await intakeRequestsRepo.lockRequestForUpdate(query, lockedSession.request_id);
  if (!lockedRequest || lockedRequest.status !== 'upload_invited') {
    await eventsRepo.recordEventInTransaction(query, lockedSession.request_id, 'upload.finalization_denied_request_state');
    return { kind: 'not_finalized', completedCount };
  }

  const finalizedSession = await uploadSessionsRepo.finalizeSessionInTransaction(query, lockedSession.id);
  if (!finalizedSession) {
    return { kind: 'not_finalized', completedCount };
  }
  await eventsRepo.recordEventInTransaction(query, lockedSession.request_id, 'upload.session_finalized');

  const updatedRequest = await intakeRequestsRepo.updateStatusInTransaction(query, lockedRequest.id, lockedRequest.status, 'files_received');
  if (!updatedRequest) {
    throw new Error('request_finalization_update_returned_no_row_after_lock');
  }
  await eventsRepo.recordEventInTransaction(query, updatedRequest.id, 'request.files_received');
  return { kind: 'finalized', requestId: updatedRequest.id, publicReference: updatedRequest.public_reference, completedCount };
}

export async function completeUploadObject(
  rawToken: string,
  input: { storageObjectKey: string; finishSession?: boolean }
): Promise<CompleteUploadOutcome> {
  const hash = tokenHash(rawToken);
  const session = await uploadSessionsRepo.findByTokenHash(hash);
  const validity = uploadSessionsRepo.evaluateTokenValidity(session);
  if (!validity.valid) {
    return { kind: 'denied', reason: validity.reason };
  }

  const reservation = await intakeFilesRepo.findReservationByObjectKey(input.storageObjectKey);
  if (!reservation) {
    await recordPostCommitEvent(validity.session.request_id, 'upload.completion_denied_unknown_key', { route: 'completeUploadObject' });
    return { kind: 'completion_denied', reason: 'unknown_object_key' };
  }
  if (reservation.upload_session_id !== validity.session.id || reservation.request_id !== validity.session.request_id) {
    await recordPostCommitEvent(validity.session.request_id, 'upload.completion_denied_foreign_session', { route: 'completeUploadObject' });
    return { kind: 'completion_denied', reason: 'foreign_session' };
  }

  // fetch provider metadata BEFORE opening any transaction -- this is
  // an external network call and must never happen while a database
  // connection/transaction is held.
  const verified = await getStorageAdapter().verifyObjectExists(input.storageObjectKey);
  if (!verified) {
    await recordPostCommitEvent(validity.session.request_id, 'upload.completion_denied_metadata_mismatch', { route: 'completeUploadObject' });
    return { kind: 'completion_denied', reason: 'provider_metadata_unavailable' };
  }

  const result = await withIntakeTransaction(async (query) => {
    const lockedSession = await uploadSessionsRepo.lockSessionForUpdate(query, validity.session.id);

    if (!lockedSession || !isLockedSessionStillValid(lockedSession)) {
      return { kind: 'session_invalid' as const };
    }
    const lockedReservation = await intakeFilesRepo.lockReservationForUpdate(query, input.storageObjectKey);
    if (
      !lockedReservation ||
      lockedReservation.reservation_status !== 'reserved' ||
      lockedReservation.upload_session_id !== lockedSession.id
    ) {
      return { kind: 'reservation_invalid' as const };
    }
    if (verified.contentType !== lockedReservation.declared_content_type || verified.sizeBytes !== lockedReservation.declared_size_bytes) {
      return { kind: 'metadata_mismatch' as const };
    }
    if (!isExtensionCompatibleWithMimeType(lockedReservation.original_filename, verified.contentType)) {
      return { kind: 'extension_mismatch' as const };
    }

    const completed = await intakeFilesRepo.completeReservationInTransaction(query, lockedReservation.id, verified.contentType, verified.sizeBytes);
    if (!completed) {
      return { kind: 'reservation_invalid' as const };
    }
    await eventsRepo.recordEventInTransaction(query, lockedSession.request_id, 'upload.completion_verified');

    const finalization = await maybeFinalizeInTransaction(query, lockedSession, input.finishSession === true);
    return { kind: 'ok' as const, finalization };
  });

  switch (result.kind) {
    case 'session_invalid':
      await recordPostCommitEvent(validity.session.request_id, 'upload.completion_denied_session_revalidation_failed', { route: 'completeUploadObject' });
      return { kind: 'completion_denied', reason: 'session_revalidation_failed' };
    case 'reservation_invalid':
      await recordPostCommitEvent(validity.session.request_id, 'upload.completion_denied_already_completed', { route: 'completeUploadObject' });
      return { kind: 'completion_denied', reason: 'not_reserved' };
    case 'metadata_mismatch':
      await recordPostCommitEvent(validity.session.request_id, 'upload.completion_denied_metadata_mismatch', { route: 'completeUploadObject' });
      return { kind: 'completion_denied', reason: 'metadata_mismatch' };
    case 'extension_mismatch':
      await recordPostCommitEvent(validity.session.request_id, 'upload.completion_denied_metadata_mismatch', { route: 'completeUploadObject' });
      return { kind: 'completion_denied', reason: 'extension_mismatch' };
    case 'ok': {
      // R4 (§3): completedCount comes from INSIDE the transaction
      // that just committed -- no second, post-commit database query
      // is issued to construct this response.
      if (result.finalization.kind === 'finalized') {
        await sendUploadCompleteNotification(result.finalization.requestId, result.finalization.publicReference, result.finalization.completedCount);
      }
      return { kind: 'ok', fileCount: result.finalization.completedCount, finalized: result.finalization.kind === 'finalized' };
    }
  }
}

/** Explicit customer "I'm done uploading" action -- also goes through the same atomic revalidate-then-finalize transaction, without completing a new file. `ok` is true only if THIS call actually finalized the session. */
export async function finishUploadSession(rawToken: string): Promise<{ ok: boolean; fileCount: number }> {
  const hash = tokenHash(rawToken);
  const session = await uploadSessionsRepo.findByTokenHash(hash);
  const validity = uploadSessionsRepo.evaluateTokenValidity(session);
  if (!validity.valid) return { ok: false, fileCount: 0 };

  const result = await withIntakeTransaction(async (query) => {
    const lockedSession = await uploadSessionsRepo.lockSessionForUpdate(query, validity.session.id);
    if (!lockedSession || !isLockedSessionStillValid(lockedSession)) {
      return { kind: 'session_invalid' as const };
    }
    const finalization = await maybeFinalizeInTransaction(query, lockedSession, true);
    return { kind: 'ok' as const, finalization };
  });

  // R4 (§3): completedCount always comes from the transaction result,
  // even in the not-finalized branch -- no post-commit query.
  if (result.kind === 'ok' && result.finalization.kind === 'finalized') {
    await sendUploadCompleteNotification(result.finalization.requestId, result.finalization.publicReference, result.finalization.completedCount);
    return { ok: true, fileCount: result.finalization.completedCount };
  }
  return { ok: false, fileCount: result.kind === 'ok' ? result.finalization.completedCount : 0 };
}

export type CancelReservationOutcome =
  | { kind: 'denied'; reason: 'invalid' | 'expired' | 'revoked' | 'used' }
  | { kind: 'cancellation_denied'; reason: 'unknown_object_key' | 'foreign_session' | 'already_completed' }
  | { kind: 'ok'; cancelled: boolean };

/**
 * R4 (§2.3): releases a still-`reserved` object's quota. Completed
 * reservations can never be cancelled (checked inside the same
 * locked transaction that would otherwise cancel it); a duplicate
 * cancel on an already-cancelled/failed/expired row is idempotent
 * (`cancelled: false`, not an error). Provider deletion is attempted
 * only AFTER commit, best-effort -- a deletion failure leaves the row
 * exactly where the normal orphan-cleanup path already looks for it
 * (see intake-files.repository.ts's findOrphanReservations, which
 * now also matches 'cancelled' rows).
 */
export async function cancelUploadReservation(rawToken: string, storageObjectKey: string): Promise<CancelReservationOutcome> {
  const hash = tokenHash(rawToken);
  const session = await uploadSessionsRepo.findByTokenHash(hash);
  const validity = uploadSessionsRepo.evaluateTokenValidity(session);
  if (!validity.valid) {
    return { kind: 'denied', reason: validity.reason };
  }

  const result = await withIntakeTransaction(async (query) => {
    const lockedSession = await uploadSessionsRepo.lockSessionForUpdate(query, validity.session.id);
    if (!lockedSession || !isLockedSessionStillValid(lockedSession)) {
      return { kind: 'session_invalid' as const };
    }
    const lockedReservation = await intakeFilesRepo.lockReservationForUpdate(query, storageObjectKey);
    if (!lockedReservation || lockedReservation.upload_session_id !== lockedSession.id || lockedReservation.request_id !== lockedSession.request_id) {
      return { kind: 'unknown_or_foreign' as const };
    }
    if (lockedReservation.reservation_status === 'completed') {
      return { kind: 'already_completed' as const };
    }
    if (lockedReservation.reservation_status !== 'reserved') {
      // Already cancelled/failed/expired -- idempotent no-op success.
      return { kind: 'already_terminal' as const };
    }
    const cancelled = await intakeFilesRepo.cancelReservationInTransaction(query, lockedReservation.id);
    if (!cancelled) {
      return { kind: 'already_terminal' as const };
    }
    await eventsRepo.recordEventInTransaction(query, lockedSession.request_id, 'upload.reservation_cancelled');
    return { kind: 'cancelled' as const, requestId: lockedSession.request_id };
  });

  switch (result.kind) {
    case 'session_invalid':
      return { kind: 'denied', reason: 'invalid' };
    case 'unknown_or_foreign':
      await recordPostCommitEvent(validity.session.request_id, 'upload.cancellation_denied', { route: 'cancelUploadReservation' });
      return { kind: 'cancellation_denied', reason: 'unknown_object_key' };
    case 'already_completed':
      await recordPostCommitEvent(validity.session.request_id, 'upload.cancellation_denied', { route: 'cancelUploadReservation' });
      return { kind: 'cancellation_denied', reason: 'already_completed' };
    case 'already_terminal':
      return { kind: 'ok', cancelled: false };
    case 'cancelled': {
      // Best-effort provider deletion AFTER commit -- a failure here
      // leaves the row discoverable by ordinary orphan cleanup and
      // must never turn an already-committed, successful cancel into
      // an error response.
      try {
        const deleteResult = await getStorageAdapter().deleteObject(storageObjectKey);
        await recordPostCommitEvent(
          result.requestId,
          deleteResult.success ? 'upload.orphan_object_deleted' : 'upload.orphan_object_delete_failed',
          { route: 'cancelUploadReservation' }
        );
      } catch {
        await recordPostCommitEvent(result.requestId, 'upload.orphan_object_delete_failed', { route: 'cancelUploadReservation' });
      }
      return { kind: 'ok', cancelled: true };
    }
  }
}
