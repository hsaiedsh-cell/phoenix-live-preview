// ============================================================
// Upload flow service -- token validation, reservation-based
// signing, and revalidated completion
// PHX-LAUNCH-001-R1 §1
// ------------------------------------------------------------
// Backs GET /api/upload/:token, POST /api/upload/:token/sign, and
// POST /api/upload/:token/complete. Public but invitation-only:
// anonymous callers without a valid token are always denied.
//
// R1 correction summary:
//  - signUploadObject now locks the parent session row
//    (`SELECT ... FOR UPDATE`) and evaluates count/size limits
//    against ALL non-failed, non-expired reservations inside that
//    same transaction before inserting a new 'reserved' row, making
//    the 5-file/60MB limits concurrency-safe (§1.2).
//  - completeUploadObject never trusts client-supplied
//    filename/contentType; it looks up the server-side reservation
//    created at signing time, verifies it belongs to the same
//    session/request, verifies the PROVIDER's own observed size and
//    MIME metadata match what was declared, and validates the file
//    extension independently of the claimed MIME type (§1.3/§1.4).
//  - Session finalization is exactly-once via
//    upload-sessions.repository.ts's finalizeSessionOnce; only the
//    winner of that race transitions the request to files_received
//    and requests the upload-complete notification (§1.5).
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
import { withIntakeTransaction } from './db';
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

  // ---- R1 §1.4: extension validation, independent of client-declared MIME ----
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

  // ---- R1 §1.2: concurrency-safe quota check under a row lock, inside one transaction ----
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
    const eventByReason = {
      file_count_exceeded: 'upload.file_rejected_size',
      total_size_exceeded: 'upload.file_rejected_size',
    } as const;
    await eventsRepo.recordEvent(
      validity.session.request_id,
      eventByReason[reservationResult.reason as 'file_count_exceeded' | 'total_size_exceeded']
    );
    return { kind: 'rejected', reason: reservationResult.reason };
  }

  const { reservation } = reservationResult;
  await eventsRepo.recordEvent(validity.session.request_id, 'upload.reservation_created');

  // ---- R1 §1.2: a failed provider signing call releases/marks the reservation failed ----
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
      reason: 'unknown_object_key' | 'foreign_session' | 'not_reserved' | 'provider_metadata_unavailable' | 'metadata_mismatch' | 'extension_mismatch';
    }
  | { kind: 'ok'; fileCount: number };

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

  // ---- R1 §1.1: resolve the reservation, never an arbitrary bucket object ----
  const reservation = await intakeFilesRepo.findReservationByObjectKey(input.storageObjectKey);
  if (!reservation) {
    await eventsRepo.recordEvent(validity.session.request_id, 'upload.completion_denied_unknown_key');
    return { kind: 'completion_denied', reason: 'unknown_object_key' };
  }
  if (reservation.upload_session_id !== validity.session.id || reservation.request_id !== validity.session.request_id) {
    await eventsRepo.recordEvent(validity.session.request_id, 'upload.completion_denied_foreign_session');
    return { kind: 'completion_denied', reason: 'foreign_session' };
  }
  if (reservation.reservation_status !== 'reserved') {
    await eventsRepo.recordEvent(validity.session.request_id, 'upload.completion_denied_already_completed');
    return { kind: 'completion_denied', reason: 'not_reserved' };
  }

  // ---- R1 §1.3: revalidate using ONLY the provider's own observed metadata ----
  const verified = await getStorageAdapter().verifyObjectExists(input.storageObjectKey);
  if (!verified) {
    await eventsRepo.recordEvent(validity.session.request_id, 'upload.completion_denied_metadata_mismatch');
    return { kind: 'completion_denied', reason: 'provider_metadata_unavailable' };
  }
  if (verified.contentType !== reservation.declared_content_type || verified.sizeBytes !== reservation.declared_size_bytes) {
    await eventsRepo.recordEvent(validity.session.request_id, 'upload.completion_denied_metadata_mismatch');
    return { kind: 'completion_denied', reason: 'metadata_mismatch' };
  }
  if (!isExtensionCompatibleWithMimeType(reservation.original_filename, verified.contentType)) {
    await eventsRepo.recordEvent(validity.session.request_id, 'upload.completion_denied_metadata_mismatch');
    return { kind: 'completion_denied', reason: 'extension_mismatch' };
  }

  const completed = await intakeFilesRepo.completeReservationOnce(reservation.id, verified.contentType, verified.sizeBytes);
  if (!completed) {
    // Lost a race against a concurrent completion of the same reservation.
    await eventsRepo.recordEvent(validity.session.request_id, 'upload.completion_denied_already_completed');
    return { kind: 'completion_denied', reason: 'not_reserved' };
  }
  await eventsRepo.recordEvent(validity.session.request_id, 'upload.completion_verified');

  // ---- R1 §1.5: session finalization is exactly-once, session stays active otherwise ----
  const completedCount = await intakeFilesRepo.countCompletedForSession(validity.session.id);
  const reachedMax = completedCount >= validity.session.max_files;
  const shouldFinalize = input.finishSession === true || reachedMax;

  if (shouldFinalize) {
    const finalized = await uploadSessionsRepo.finalizeSessionOnce(validity.session.id);
    if (finalized) {
      // We won the finalization race -- this is the ONLY call that
      // transitions the request and requests the notification.
      await eventsRepo.recordEvent(validity.session.request_id, 'upload.session_finalized');
      const requestRow = await intakeRequestsRepo.findById(validity.session.request_id);
      if (requestRow && intakeRequestsRepo.isAllowedStatusTransition(requestRow.status, 'files_received')) {
        await intakeRequestsRepo.updateStatus(requestRow.id, requestRow.status, 'files_received');
        await eventsRepo.recordEvent(requestRow.id, 'request.files_received');

        const email = buildUploadCompleteInternalEmail({
          publicReference: requestRow.public_reference,
          fileCount: completedCount,
        });
        email.to = serverConfig.intakeInternalToEmail;
        email.idempotencyKey = `upload-complete/${validity.session.id}`;
        const sendResult = await sendEmailSafely(email);
        await eventsRepo.recordEvent(
          requestRow.id,
          sendResult.success
            ? 'request.upload_complete_notification_sent'
            : 'request.upload_complete_notification_failed'
        );
      }
    }
    // If `finalized` is null, someone else already finalized this
    // session (e.g. a duplicate finishSession call) -- intentionally
    // a silent no-op, matching "subsequent completion/finalization
    // calls are idempotent and do not resend" (§1.5).
  }

  return { kind: 'ok', fileCount: completedCount };
}

/** Explicit customer action ("I'm done uploading") without completing another file -- also goes through the same exactly-once finalization path. */
export async function finishUploadSession(rawToken: string): Promise<{ ok: boolean }> {
  const hash = tokenHash(rawToken);
  const session = await uploadSessionsRepo.findByTokenHash(hash);
  const validity = uploadSessionsRepo.evaluateTokenValidity(session);
  if (!validity.valid) return { ok: false };

  const finalized = await uploadSessionsRepo.finalizeSessionOnce(validity.session.id);
  if (finalized) {
    await eventsRepo.recordEvent(validity.session.request_id, 'upload.session_finalized');
    const requestRow = await intakeRequestsRepo.findById(validity.session.request_id);
    if (requestRow && intakeRequestsRepo.isAllowedStatusTransition(requestRow.status, 'files_received')) {
      const completedCount = await intakeFilesRepo.countCompletedForSession(validity.session.id);
      await intakeRequestsRepo.updateStatus(requestRow.id, requestRow.status, 'files_received');
      await eventsRepo.recordEvent(requestRow.id, 'request.files_received');

      const email = buildUploadCompleteInternalEmail({ publicReference: requestRow.public_reference, fileCount: completedCount });
      email.to = serverConfig.intakeInternalToEmail;
      email.idempotencyKey = `upload-complete/${validity.session.id}`;
      const sendResult = await sendEmailSafely(email);
      await eventsRepo.recordEvent(
        requestRow.id,
        sendResult.success ? 'request.upload_complete_notification_sent' : 'request.upload_complete_notification_failed'
      );
    }
  }
  return { ok: true };
}
