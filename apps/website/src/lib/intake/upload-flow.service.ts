// ============================================================
// Upload flow service -- token validation, reservation-based
// signing, and atomically-revalidated completion
// PHX-LAUNCH-001 (R2: PHX-LAUNCH-001-R2 §2)
// ------------------------------------------------------------
// Backs GET /api/upload/:token, POST /api/upload/:token/sign, and
// POST /api/upload/:token/complete. Public but invitation-only:
// anonymous callers without a valid token are always denied.
//
// R2 correction summary (§2): the R1 completion flow validated the
// session, THEN called the storage provider, THEN completed/finalized
// without re-checking whether the session had been revoked or had
// expired in the meantime -- finalizeSessionOnce only checked
// finalized_at IS NULL, so a concurrently revoked/expired session
// could still be overwritten to 'used'. R2 fetches provider metadata
// FIRST (external call, no DB connection held), then opens ONE short
// transaction that locks the session row and the reservation row
// (in that consistent order, session-then-reservation, everywhere --
// see the repository functions' own comments on why), fully
// revalidates both, completes the reservation, and -- only if
// finalization is warranted -- finalizes the session and transitions
// the request, all before COMMIT. The upload-complete email is
// requested only after that commit.
// ============================================================

import { tokenHash } from './hash';
import * as uploadSessionsRepo from './repositories/upload-sessions.repository';
import * as intakeFilesRepo from './repositories/intake-files.repository';
import * as eventsRepo from './repositories/intake-events.repository';
import * as intakeRequestsRepo from './repositories/intake-requests.repository';
import { generateStorageObjectKey } from './object-key';
import { getStorageAdapter, sendEmailSafely } from './adapters';
import { buildUploadCompleteInternalEmail } from './adapters/email.adapter';
import { serverConfig } from './config';
import { withIntakeTransaction, type TransactionQuery } from './db';
import { UPLOAD_LIMITS } from './config';
import { isDangerousExtension, isExtensionCompatibleWithMimeType } from './extension-validation';

export type TokenCheckOutcome =
  | { kind: 'denied'; reason: 'invalid' | 'expired' | 'revoked' | 'used' }
  | { kind: 'ok'; requestId: string; sessionId: string; maxFiles: number; expiresAt: Date };

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
      await eventsRepo.recordEvent(session.request_id, eventByReason[validity.reason]);
    }
    return { kind: 'denied', reason: validity.reason };
  }

  await eventsRepo.recordEvent(validity.session.request_id, 'upload.token_accepted');
  return {
    kind: 'ok',
    requestId: validity.session.request_id,
    sessionId: validity.session.id,
    maxFiles: validity.session.max_files,
    expiresAt: validity.session.expires_at,
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

  if (isDangerousExtension(candidate.filename)) {
    await eventsRepo.recordEvent(validity.session.request_id, 'upload.file_rejected_extension');
    return { kind: 'rejected', reason: 'extension_not_allowed' };
  }
  if (!ALLOWED_CONTENT_TYPES.includes(candidate.contentType)) {
    await eventsRepo.recordEvent(validity.session.request_id, 'upload.file_rejected_type');
    return { kind: 'rejected', reason: 'content_type_not_allowed' };
  }
  if (!isExtensionCompatibleWithMimeType(candidate.filename, candidate.contentType)) {
    await eventsRepo.recordEvent(validity.session.request_id, 'upload.file_rejected_extension');
    return { kind: 'rejected', reason: 'extension_not_allowed' };
  }
  if (candidate.sizeBytes > UPLOAD_LIMITS.maxFileSizeBytes) {
    await eventsRepo.recordEvent(validity.session.request_id, 'upload.file_rejected_size');
    return { kind: 'rejected', reason: 'per_file_size_exceeded' };
  }

  const reservationResult = await withIntakeTransaction(async (query) => {
    const lockedSession = await intakeFilesRepo.lockUploadSessionForUpdate(query, validity.session.id);
    if (!lockedSession || lockedSession.status !== 'active') {
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
    return { kind: 'ok' as const, reservation };
  });

  if (reservationResult.kind === 'denied') {
    return { kind: 'denied', reason: reservationResult.reason };
  }
  if (reservationResult.kind === 'rejected') {
    await eventsRepo.recordEvent(validity.session.request_id, 'upload.file_rejected_size');
    return { kind: 'rejected', reason: reservationResult.reason };
  }

  const { reservation } = reservationResult;
  await eventsRepo.recordEvent(validity.session.request_id, 'upload.reservation_created');

  try {
    const signed = await getStorageAdapter().createSignedUploadUrl(reservation.storage_object_key);
    await eventsRepo.recordEvent(validity.session.request_id, 'upload.object_signed');
    return { kind: 'ok', uploadUrl: signed.uploadUrl, storageObjectKey: signed.storageObjectKey };
  } catch {
    await intakeFilesRepo.markReservationFailed(reservation.id);
    await eventsRepo.recordEvent(validity.session.request_id, 'upload.reservation_failed');
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
 * Sends the post-commit upload-complete notification. Extracted so
 * both completeUploadObject and finishUploadSession (which can also
 * be the caller that wins finalization, with zero newly-completed
 * files in this specific call) share identical, once-only email
 * logic.
 */
async function sendUploadCompleteNotification(requestId: string, publicReference: string, fileCount: number): Promise<void> {
  const email = buildUploadCompleteInternalEmail({ publicReference, fileCount });
  email.to = serverConfig.intakeInternalToEmail;
  email.idempotencyKey = `upload-complete/${requestId}`;
  const sendResult = await sendEmailSafely(email);
  await eventsRepo.recordEvent(
    requestId,
    sendResult.success ? 'request.upload_complete_notification_sent' : 'request.upload_complete_notification_failed'
  );
}

type FinalizationTransactionResult =
  | { kind: 'not_finalized' }
  | { kind: 'finalized'; requestId: string; publicReference: string; fileCount: number };

/**
 * R2 (§2.2 steps 6-7): runs INSIDE the caller's already-open
 * transaction (after the session/reservation locks are held and any
 * reservation completion for this call has already happened). Counts
 * completed files, and if finalization is warranted, revalidates
 * requiring at least one completed file, finalizes the session, and
 * transitions the request -- all still inside that same transaction.
 */
async function maybeFinalizeInTransaction(
  query: TransactionQuery,
  lockedSession: { id: string; request_id: string; max_files: number },
  requestFinish: boolean
): Promise<FinalizationTransactionResult> {
  const completedCount = await intakeFilesRepo.countCompletedForSessionInTransaction(query, lockedSession.id);
  const reachedMax = completedCount >= lockedSession.max_files;
  if (!requestFinish && !reachedMax) {
    return { kind: 'not_finalized' };
  }
  // R2 §2.2 step 7: "require at least one completed file" before any
  // finalization -- an explicit finish with zero completed files
  // must not transition anything.
  if (completedCount < 1) {
    await eventsRepo.recordEventInTransaction(query, lockedSession.request_id, 'upload.finalization_rejected_zero_files');
    return { kind: 'not_finalized' };
  }

  const finalized = await uploadSessionsRepo.finalizeSessionInTransaction(query, lockedSession.id);
  if (!finalized) {
    // Someone else already finalized this session (duplicate finish
    // or a race with auto-finalization) -- idempotent no-op.
    return { kind: 'not_finalized' };
  }
  await eventsRepo.recordEventInTransaction(query, lockedSession.request_id, 'upload.session_finalized');

  const requestRow = await intakeRequestsRepo.findById(lockedSession.request_id);
  if (requestRow && intakeRequestsRepo.isAllowedStatusTransition(requestRow.status, 'files_received')) {
    await intakeRequestsRepo.updateStatusInTransaction(query, requestRow.id, requestRow.status, 'files_received');
    await eventsRepo.recordEventInTransaction(query, requestRow.id, 'request.files_received');
    return { kind: 'finalized', requestId: requestRow.id, publicReference: requestRow.public_reference, fileCount: completedCount };
  }
  return { kind: 'not_finalized' };
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
    await eventsRepo.recordEvent(validity.session.request_id, 'upload.completion_denied_unknown_key');
    return { kind: 'completion_denied', reason: 'unknown_object_key' };
  }
  if (reservation.upload_session_id !== validity.session.id || reservation.request_id !== validity.session.request_id) {
    await eventsRepo.recordEvent(validity.session.request_id, 'upload.completion_denied_foreign_session');
    return { kind: 'completion_denied', reason: 'foreign_session' };
  }

  // R2 §2.2: fetch provider metadata BEFORE opening any transaction
  // -- this is an external network call and must never happen while
  // a database connection/transaction is held.
  const verified = await getStorageAdapter().verifyObjectExists(input.storageObjectKey);
  if (!verified) {
    await eventsRepo.recordEvent(validity.session.request_id, 'upload.completion_denied_metadata_mismatch');
    return { kind: 'completion_denied', reason: 'provider_metadata_unavailable' };
  }

  // R2 §2.2 steps 1-6: ONE short transaction, locking session then
  // reservation (consistent order everywhere), fully revalidating
  // both before trusting anything about them.
  const result = await withIntakeTransaction(async (query) => {
    const lockedSession = await uploadSessionsRepo.lockSessionForUpdate(query, validity.session.id);
    const lockedReservation = await intakeFilesRepo.lockReservationForUpdate(query, input.storageObjectKey);

    if (
      !lockedSession ||
      lockedSession.status !== 'active' ||
      lockedSession.expires_at.getTime() <= Date.now() ||
      lockedSession.revoked_at !== null ||
      lockedSession.finalized_at !== null
    ) {
      return { kind: 'session_invalid' as const };
    }
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
      await eventsRepo.recordEvent(validity.session.request_id, 'upload.completion_denied_session_revalidation_failed');
      return { kind: 'completion_denied', reason: 'session_revalidation_failed' };
    case 'reservation_invalid':
      await eventsRepo.recordEvent(validity.session.request_id, 'upload.completion_denied_already_completed');
      return { kind: 'completion_denied', reason: 'not_reserved' };
    case 'metadata_mismatch':
      await eventsRepo.recordEvent(validity.session.request_id, 'upload.completion_denied_metadata_mismatch');
      return { kind: 'completion_denied', reason: 'metadata_mismatch' };
    case 'extension_mismatch':
      await eventsRepo.recordEvent(validity.session.request_id, 'upload.completion_denied_metadata_mismatch');
      return { kind: 'completion_denied', reason: 'extension_mismatch' };
    case 'ok': {
      // R2 §2.2 step 9: only after commit does the winning caller
      // request the email.
      if (result.finalization.kind === 'finalized') {
        await sendUploadCompleteNotification(result.finalization.requestId, result.finalization.publicReference, result.finalization.fileCount);
      }
      const fileCount = await intakeFilesRepo.countCompletedForSession(validity.session.id);
      return { kind: 'ok', fileCount, finalized: result.finalization.kind === 'finalized' };
    }
  }
}

/** Explicit customer "I'm done uploading" action -- also goes through the same atomic revalidate-then-finalize transaction, without completing a new file. `ok` is true only if THIS call actually finalized the session (a zero-completed-file finish, or a finish racing an already-finalized session, reports ok:false). */
export async function finishUploadSession(rawToken: string): Promise<{ ok: boolean; fileCount: number }> {
  const hash = tokenHash(rawToken);
  const session = await uploadSessionsRepo.findByTokenHash(hash);
  const validity = uploadSessionsRepo.evaluateTokenValidity(session);
  if (!validity.valid) return { ok: false, fileCount: 0 };

  const result = await withIntakeTransaction(async (query) => {
    const lockedSession = await uploadSessionsRepo.lockSessionForUpdate(query, validity.session.id);
    if (
      !lockedSession ||
      lockedSession.status !== 'active' ||
      lockedSession.expires_at.getTime() <= Date.now() ||
      lockedSession.revoked_at !== null ||
      lockedSession.finalized_at !== null
    ) {
      return { kind: 'session_invalid' as const };
    }
    const finalization = await maybeFinalizeInTransaction(query, lockedSession, true);
    return { kind: 'ok' as const, finalization };
  });

  if (result.kind === 'ok' && result.finalization.kind === 'finalized') {
    await sendUploadCompleteNotification(result.finalization.requestId, result.finalization.publicReference, result.finalization.fileCount);
    return { ok: true, fileCount: result.finalization.fileCount };
  }
  const fileCount = await intakeFilesRepo.countCompletedForSession(validity.session.id);
  return { ok: false, fileCount };
}
