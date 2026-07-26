// ============================================================
// Upload flow service -- token validation, idempotent reservation
// signing, atomically-revalidated completion/finalization,
// cancellation, and authoritative state reporting
// PHX-LAUNCH-001 (R5: PHX-LAUNCH-001-R5 §2, §3, §6)
// ------------------------------------------------------------
// Backs GET /api/upload/:token, POST /api/upload/:token/sign,
// POST /api/upload/:token/complete, and POST /api/upload/:token/cancel.
// Public but invitation-only: anonymous callers without a valid token
// are always denied.
//
// R5 correction summary:
//  - §2: the upload-complete email's provider idempotency key now
//    uses the UPLOAD SESSION id, not the request id -- carried out of
//    the finalization transaction alongside completedCount. Once R5
//    §1 allows replacement sessions for the same request, a second
//    legitimate session's completion notification must not be
//    suppressed by the provider as a duplicate of the first session's.
//  - §3: maybeFinalizeInTransaction now also counts RESERVED rows
//    inside the same transaction and refuses to finalize at all while
//    any remain -- a recovered uploaded_unverified/recoverable_error
//    reservation is not "busy" from the UI's point of view, so
//    without this server-side check a customer could finalize while
//    files were still stuck mid-flight, orphaning them the moment the
//    token became unusable.
//  - §6: signUploadObject now takes a client-generated reservationKey
//    or reuses the caller-visible object key of an existing
//    reservation for the same (session, key) pair -- a lost sign
//    response followed by a client retry reuses the SAME reservation
//    and issues a fresh signed URL for the SAME object key, rather
//    than creating a second reservation and consuming additional
//    quota. A same key presented with different file metadata is a
//    conflict; a same key referencing an already-completed/cancelled/
//    failed/expired reservation is an explicit terminal result, never
//    a silent second insert.
// ============================================================

import { tokenHash, reservationKeyHash as hashReservationKey } from './hash';
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
  | { kind: 'reservation_conflict' }
  | { kind: 'reservation_terminal'; status: 'completed' | 'cancelled' | 'failed' | 'expired' }
  | { kind: 'signing_failed' }
  | { kind: 'ok'; uploadUrl: string; storageObjectKey: string };

const ALLOWED_CONTENT_TYPES = UPLOAD_LIMITS.allowedContentTypes as readonly string[];

/** R3 (§2)/R4/R5: the single revalidation rule shared by every locked-transaction check in this file -- status/expiry/revocation/finalization, all four, always together. Exported so QA can prove this SPECIFIC check independently. */
export function isLockedSessionStillValid(lockedSession: { status: string; expires_at: Date; revoked_at: Date | null; finalized_at: Date | null }): boolean {
  return (
    lockedSession.status === 'active' &&
    lockedSession.expires_at.getTime() > Date.now() &&
    lockedSession.revoked_at === null &&
    lockedSession.finalized_at === null
  );
}

function fingerprintMatches(
  reservation: { original_filename: string; declared_content_type: string; declared_size_bytes: number },
  candidate: { filename: string; contentType: string; sizeBytes: number }
): boolean {
  return (
    reservation.original_filename === candidate.filename &&
    reservation.declared_content_type === candidate.contentType &&
    reservation.declared_size_bytes === candidate.sizeBytes
  );
}

export async function signUploadObject(
  rawToken: string,
  candidate: { filename: string; contentType: string; sizeBytes: number; reservationKey: string }
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

  const keyHash = hashReservationKey(candidate.reservationKey);

  // R5 (§6): ONE short transaction that locks the session, then looks
  // up any EXISTING reservation for this exact (session, key) pair --
  // never a separate pre-check -- so a truly concurrent pair of
  // same-key sign requests (e.g. a double-click) is resolved the same
  // way a single retry is: only one of them ever inserts a new row.
  const reservationResult = await withIntakeTransaction(async (query) => {
    const lockedSession = await intakeFilesRepo.lockUploadSessionForUpdate(query, validity.session.id);
    if (!lockedSession || !isLockedSessionStillValid(lockedSession)) {
      return { kind: 'denied' as const, reason: 'invalid' as const };
    }

    const existing = await intakeFilesRepo.lockReservationByKeyHashForUpdate(query, lockedSession.id, keyHash);
    if (existing) {
      if (existing.reservation_status !== 'reserved') {
        return { kind: 'terminal' as const, status: existing.reservation_status as 'completed' | 'cancelled' | 'failed' | 'expired' };
      }
      if (!fingerprintMatches(existing, candidate)) {
        return { kind: 'conflict' as const };
      }
      // R5 (§6) item 1: same session + same key + same fingerprint +
      // still 'reserved' -- reuse the existing reservation. No quota
      // check, no new row, no new upload.reservation_created event
      // (only the first claim ever inserts that).
      return { kind: 'reuse' as const, reservation: existing };
    }

    const totals = await intakeFilesRepo.getReservationTotalsForUpdate(query, lockedSession.id);
    if (totals.reservedOrCompletedCount + 1 > lockedSession.max_files) {
      return { kind: 'rejected' as const, reason: 'file_count_exceeded' as const };
    }
    if (totals.reservedOrCompletedTotalBytes + candidate.sizeBytes > lockedSession.max_total_size_bytes) {
      return { kind: 'rejected' as const, reason: 'total_size_exceeded' as const };
    }
    const objectKey = generateStorageObjectKey(lockedSession.id);
    const reservation = await intakeFilesRepo.insertReservation(query, {
      requestId: validity.session.request_id,
      uploadSessionId: lockedSession.id,
      storageObjectKey: objectKey,
      originalFilename: candidate.filename,
      declaredContentType: candidate.contentType,
      declaredSizeBytes: candidate.sizeBytes,
      reservationKeyHash: keyHash,
    });
    // R5 (§4 recap via §6 item 4): CORE event, written inside this
    // same transaction -- only the first claim for this key ever
    // reaches this branch.
    await eventsRepo.recordEventInTransaction(query, validity.session.request_id, 'upload.reservation_created');
    return { kind: 'created' as const, reservation };
  });

  if (reservationResult.kind === 'denied') {
    return { kind: 'denied', reason: reservationResult.reason };
  }
  if (reservationResult.kind === 'rejected') {
    await recordPostCommitEvent(validity.session.request_id, 'upload.file_rejected_size', { route: 'signUploadObject' });
    return { kind: 'rejected', reason: reservationResult.reason };
  }
  if (reservationResult.kind === 'conflict') {
    return { kind: 'reservation_conflict' };
  }
  if (reservationResult.kind === 'terminal') {
    return { kind: 'reservation_terminal', status: reservationResult.status };
  }

  const { reservation } = reservationResult;
  const isReplay = reservationResult.kind === 'reuse';

  try {
    const signed = await getStorageAdapter().createSignedUploadUrl(reservation.storage_object_key);
    await recordPostCommitEvent(validity.session.request_id, 'upload.object_signed', { route: 'signUploadObject' });
    return { kind: 'ok', uploadUrl: signed.uploadUrl, storageObjectKey: signed.storageObjectKey };
  } catch {
    // R5 (§6) item 5: a provider signing failure on a REPLAY must not
    // corrupt a previously valid reservation -- only a brand-new
    // reservation's OWN first signing failure marks it 'failed'.
    if (!isReplay) {
      await intakeFilesRepo.markReservationFailed(reservation.id);
    }
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
  | { kind: 'ok'; fileCount: number; finalized: boolean }
  | { kind: 'pending_reservations'; fileCount: number; reservedCount: number };

/**
 * Sends the post-commit upload-complete notification. Never throws
 * (R3 §4). R5 (§2): the provider idempotency key now uses the
 * UPLOAD SESSION id, not the request id.
 */
async function sendUploadCompleteNotification(requestId: string, uploadSessionId: string, publicReference: string, fileCount: number): Promise<void> {
  try {
    const email = buildUploadCompleteInternalEmail({ publicReference, fileCount });
    email.to = serverConfig.intakeInternalToEmail;
    email.idempotencyKey = `upload-complete/${uploadSessionId}`;
    const sendResult = await sendEmailSafely(email);
    await recordPostCommitEvent(
      requestId,
      sendResult.success ? 'request.upload_complete_notification_sent' : 'request.upload_complete_notification_failed',
      { route: 'upload-complete-notification' }
    );
  } catch {
    // Defensive only -- see this function's own contract.
  }
}

type FinalizationTransactionResult =
  | { kind: 'not_finalized'; completedCount: number }
  | { kind: 'pending_reservations'; completedCount: number; reservedCount: number }
  | { kind: 'finalized'; requestId: string; uploadSessionId: string; publicReference: string; completedCount: number };

/**
 * R3 (§1) + R4 (§3) + R5 (§2, §3): runs INSIDE the caller's
 * already-open transaction. R5 additionally counts RESERVED rows in
 * the SAME transaction and refuses to finalize AT ALL while any
 * remain -- a recovered uploaded_unverified/recoverable_error
 * reservation looks idle to the UI but is still a real, uncompleted
 * server-side row; finalizing anyway would orphan it the instant the
 * token became unusable. This check applies uniformly to both the
 * explicit-finish and automatic-at-max-count paths -- it is a no-op
 * for the automatic path, since quota rules make reserved rows
 * impossible once completedCount has reached max_files.
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

  const reservedCount = await intakeFilesRepo.countReservedForSessionInTransaction(query, lockedSession.id);
  if (reservedCount > 0) {
    await eventsRepo.recordEventInTransaction(query, lockedSession.request_id, 'upload.finalization_denied_pending_reservations');
    return { kind: 'pending_reservations', completedCount, reservedCount };
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
  return {
    kind: 'finalized',
    requestId: updatedRequest.id,
    uploadSessionId: lockedSession.id,
    publicReference: updatedRequest.public_reference,
    completedCount,
  };
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
      if (result.finalization.kind === 'pending_reservations') {
        return { kind: 'pending_reservations', fileCount: result.finalization.completedCount, reservedCount: result.finalization.reservedCount };
      }
      if (result.finalization.kind === 'finalized') {
        await sendUploadCompleteNotification(
          result.finalization.requestId,
          result.finalization.uploadSessionId,
          result.finalization.publicReference,
          result.finalization.completedCount
        );
      }
      return { kind: 'ok', fileCount: result.finalization.completedCount, finalized: result.finalization.kind === 'finalized' };
    }
  }
}

export type FinishUploadSessionOutcome =
  | { ok: true; fileCount: number }
  | { ok: false; fileCount: number; reason?: 'pending_reservations'; reservedCount?: number };

/** Explicit customer "I'm done uploading" action. R5 (§3): refuses while any reservation is still 'reserved'. */
export async function finishUploadSession(rawToken: string): Promise<FinishUploadSessionOutcome> {
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

  if (result.kind === 'ok' && result.finalization.kind === 'pending_reservations') {
    return { ok: false, fileCount: result.finalization.completedCount, reason: 'pending_reservations', reservedCount: result.finalization.reservedCount };
  }
  if (result.kind === 'ok' && result.finalization.kind === 'finalized') {
    await sendUploadCompleteNotification(
      result.finalization.requestId,
      result.finalization.uploadSessionId,
      result.finalization.publicReference,
      result.finalization.completedCount
    );
    return { ok: true, fileCount: result.finalization.completedCount };
  }
  return { ok: false, fileCount: result.kind === 'ok' && result.finalization.kind === 'not_finalized' ? result.finalization.completedCount : 0 };
}

export type CancelReservationOutcome =
  | { kind: 'denied'; reason: 'invalid' | 'expired' | 'revoked' | 'used' }
  | { kind: 'cancellation_denied'; reason: 'unknown_object_key' | 'foreign_session' | 'already_completed' }
  | { kind: 'ok'; cancelled: boolean };

/** R4 (§2.3): releases a still-`reserved` object's quota. */
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
