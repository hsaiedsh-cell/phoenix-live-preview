// ============================================================
// Upload flow service -- token validation, reservation-based
// signing, and atomically-revalidated completion/finalization
// PHX-LAUNCH-001 (R3: PHX-LAUNCH-001-R3 §1, §2, §4)
// ------------------------------------------------------------
// Backs GET /api/upload/:token, POST /api/upload/:token/sign, and
// POST /api/upload/:token/complete. Public but invitation-only:
// anonymous callers without a valid token are always denied.
//
// R3 correction summary:
//  - §1: maybeFinalizeInTransaction previously read the parent
//    request row via intakeRequestsRepo.findById -- the GLOBAL POOL,
//    called from INSIDE an already-open withIntakeTransaction
//    callback. That both risked a pool self-deadlock under
//    concurrent finalizations (this transaction holds one connection
//    while asking the pool for a second) and left the request row
//    completely unlocked/unrevalidated at the exact moment of
//    finalization -- the session could become 'used' while the
//    request silently failed to transition (its UPDATE's return
//    value was never even checked). The request row is now locked
//    with lockRequestForUpdate (FOR UPDATE, using the transaction's
//    own `query`) in the SAME transaction, in a consistent lock
//    order (session, then reservation, then request) everywhere,
//    revalidated to require status='upload_invited', and every
//    conditional UPDATE's returned row is checked before any
//    corresponding event is written.
//  - §2: signUploadObject's locked-transaction revalidation
//    previously checked only `status === 'active'`, so a session
//    that had already crossed expires_at (but not yet had its status
//    column updated by anything) could still receive a NEW
//    reservation. Now revalidates status/expires_at/revoked_at/
//    finalized_at together, identically to how completeUploadObject
//    already revalidated all four.
//  - §4: post-commit operational event recording (the upload-complete
//    notification's own sent/failed event) now goes through
//    post-commit.ts's recordPostCommitEvent, which can never throw --
//    a transient failure recording THAT event can no longer surface
//    as an HTTP 500 for work (file completion, session finalization,
//    request transition) that had already committed successfully.
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

/** R3 (§2): the single revalidation rule shared by every locked-transaction check in this file -- status/expiry/revocation/finalization, all four, always together. Exported so QA can prove this SPECIFIC check independently denies an expired/revoked/finalized session, regardless of what the earlier pre-transaction check also happens to catch. */
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
    // R3 (§2): revalidate status/expiry/revocation/finalization
    // together -- a session can cross expires_at (or be revoked)
    // between the initial pre-transaction check above and this
    // locked check while its `status` column still reads 'active',
    // since nothing else proactively flips that column at the exact
    // moment of expiry.
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
 * logic. R3 (§4): this function itself can never throw -- both the
 * email send (already true via sendEmailSafely) and the resulting
 * event-recording call (now via recordPostCommitEvent) are
 * best-effort. A failure recording THIS event must never surface as
 * a route-level error for a finalization that already committed.
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
    // Defensive only -- sendEmailSafely and recordPostCommitEvent are
    // both already designed to never throw, but this function's
    // entire contract (§4) is that it NEVER propagates a failure to
    // its caller, so nothing here is allowed to be an exception.
  }
}

type FinalizationTransactionResult =
  | { kind: 'not_finalized' }
  | { kind: 'finalized'; requestId: string; publicReference: string; fileCount: number };

/**
 * R3 (§1): runs INSIDE the caller's already-open transaction (after
 * the session/reservation locks are held and any reservation
 * completion for this call has already happened). Lock order for
 * finalization specifically: session (already locked by caller) ->
 * reservation (already locked/completed by caller, when completing a
 * file) -> intake request (locked HERE, in this function) -- always
 * in that order, everywhere. Every conditional UPDATE's returned row
 * is checked; a success event is written only when the corresponding
 * UPDATE actually returned a row.
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
  // "require at least one completed file" before any finalization --
  // an explicit finish with zero completed files must not transition
  // anything.
  if (completedCount < 1) {
    await eventsRepo.recordEventInTransaction(query, lockedSession.request_id, 'upload.finalization_rejected_zero_files');
    return { kind: 'not_finalized' };
  }

  // R3 (§1): lock the parent request row INSIDE this same
  // transaction -- never via the global pool -- and require it to
  // still be in the one state upload finalization is valid from
  // (upload_invited). If a concurrent actor has already moved it to
  // 'rejected' or 'closed' (or anything else), finalize NEITHER the
  // session NOR the request -- no mutation to either row.
  const lockedRequest = await intakeRequestsRepo.lockRequestForUpdate(query, lockedSession.request_id);
  if (!lockedRequest || lockedRequest.status !== 'upload_invited') {
    await eventsRepo.recordEventInTransaction(query, lockedSession.request_id, 'upload.finalization_denied_request_state');
    return { kind: 'not_finalized' };
  }

  const finalizedSession = await uploadSessionsRepo.finalizeSessionInTransaction(query, lockedSession.id);
  if (!finalizedSession) {
    // Someone else already finalized this session (duplicate finish
    // or a race with auto-finalization) -- idempotent no-op. The
    // request row we just locked is released, unmodified, at
    // transaction end.
    return { kind: 'not_finalized' };
  }
  await eventsRepo.recordEventInTransaction(query, lockedSession.request_id, 'upload.session_finalized');

  const updatedRequest = await intakeRequestsRepo.updateStatusInTransaction(query, lockedRequest.id, lockedRequest.status, 'files_received');
  if (!updatedRequest) {
    // Should be unreachable: we hold FOR UPDATE on this exact row in
    // this exact transaction, so no concurrent writer could have
    // changed it since lockRequestForUpdate above. If it ever
    // happens anyway, throw to roll back the WHOLE transaction --
    // including the session finalization and the reservation
    // completion that preceded this function call -- rather than
    // commit a finalized session with no corresponding request
    // transition (PHX-LAUNCH-001-R3 §1: "request transition failure
    // rolls back session finalization").
    throw new Error('request_finalization_update_returned_no_row_after_lock');
  }
  await eventsRepo.recordEventInTransaction(query, updatedRequest.id, 'request.files_received');
  return { kind: 'finalized', requestId: updatedRequest.id, publicReference: updatedRequest.public_reference, fileCount: completedCount };
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

  // fetch provider metadata BEFORE opening any transaction -- this is
  // an external network call and must never happen while a database
  // connection/transaction is held.
  const verified = await getStorageAdapter().verifyObjectExists(input.storageObjectKey);
  if (!verified) {
    await eventsRepo.recordEvent(validity.session.request_id, 'upload.completion_denied_metadata_mismatch');
    return { kind: 'completion_denied', reason: 'provider_metadata_unavailable' };
  }

  // ONE short transaction, locking session then reservation then (if
  // finalizing) request, consistent order everywhere, fully
  // revalidating all of them before trusting anything.
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
      // R3 (§4): sendUploadCompleteNotification can never throw, so
      // this always still reaches the success return below,
      // regardless of the email/event outcome.
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
    if (!lockedSession || !isLockedSessionStillValid(lockedSession)) {
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
