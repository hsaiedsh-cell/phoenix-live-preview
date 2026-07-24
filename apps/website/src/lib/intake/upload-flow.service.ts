// ============================================================
// Upload flow service — token validation, signing, completion
// PHX-LAUNCH-001
// ------------------------------------------------------------
// Backs GET /api/upload/:token, POST /api/upload/:token/sign, and
// POST /api/upload/:token/complete. Public but invitation-only:
// anonymous callers without a valid token are always denied.
// ============================================================

import { tokenHash } from './hash';
import * as uploadSessionsRepo from './repositories/upload-sessions.repository';
import * as intakeFilesRepo from './repositories/intake-files.repository';
import * as eventsRepo from './repositories/intake-events.repository';
import { generateStorageObjectKey } from './object-key';
import { getStorageAdapter, sendEmailSafely } from './adapters';
import { buildUploadCompleteInternalEmail } from './adapters/email.adapter';
import { serverConfig } from './config';
import * as intakeRequestsRepo from './repositories/intake-requests.repository';

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
  | { kind: 'rejected'; reason: 'file_count_exceeded' | 'total_size_exceeded' | 'per_file_size_exceeded' | 'content_type_not_allowed' }
  | { kind: 'ok'; uploadUrl: string; storageObjectKey: string };

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

  const totals = await intakeFilesRepo.getSessionTotals(validity.session.id);
  const decision = intakeFilesRepo.evaluateFileAcceptance(totals, candidate);
  if (!decision.accepted) {
    const eventByReason = {
      file_count_exceeded: 'upload.file_rejected_size',
      total_size_exceeded: 'upload.file_rejected_size',
      per_file_size_exceeded: 'upload.file_rejected_size',
      content_type_not_allowed: 'upload.file_rejected_type',
    } as const;
    await eventsRepo.recordEvent(validity.session.request_id, eventByReason[decision.reason]);
    return { kind: 'rejected', reason: decision.reason };
  }

  const objectKey = generateStorageObjectKey(validity.session.id);
  const signed = await getStorageAdapter().createSignedUploadUrl(objectKey);
  await eventsRepo.recordEvent(validity.session.request_id, 'upload.object_signed');

  return { kind: 'ok', uploadUrl: signed.uploadUrl, storageObjectKey: signed.storageObjectKey };
}

export type CompleteUploadOutcome =
  | { kind: 'denied'; reason: 'invalid' | 'expired' | 'revoked' | 'used' }
  | { kind: 'object_not_found' }
  | { kind: 'ok'; fileCount: number };

export async function completeUploadObject(
  rawToken: string,
  input: { storageObjectKey: string; originalFilename: string; contentType: string }
): Promise<CompleteUploadOutcome> {
  const hash = tokenHash(rawToken);
  const session = await uploadSessionsRepo.findByTokenHash(hash);
  const validity = uploadSessionsRepo.evaluateTokenValidity(session);
  if (!validity.valid) {
    return { kind: 'denied', reason: validity.reason };
  }

  const object = await getStorageAdapter().verifyObjectExists(input.storageObjectKey);
  if (!object) {
    return { kind: 'object_not_found' };
  }

  await intakeFilesRepo.recordCompletedFile({
    requestId: validity.session.request_id,
    uploadSessionId: validity.session.id,
    storageObjectKey: input.storageObjectKey,
    originalFilename: input.originalFilename,
    contentType: input.contentType,
    sizeBytes: object.sizeBytes,
  });
  await eventsRepo.recordEvent(validity.session.request_id, 'upload.completion_verified');

  const totals = await intakeFilesRepo.getSessionTotals(validity.session.id);
  const isLastAllowedFile = totals.fileCount >= validity.session.max_files;

  // A session becomes single-use once the customer marks their
  // upload as complete via the finishSession flag on the LAST call,
  // OR once max_files is reached — whichever comes first. See the
  // route handler for how `finishSession` is threaded through.
  if (isLastAllowedFile) {
    await uploadSessionsRepo.markSessionUsed(validity.session.id);
  }

  const requestRow = await intakeRequestsRepo.findById(validity.session.request_id);
  if (requestRow && intakeRequestsRepo.isAllowedStatusTransition(requestRow.status, 'files_received')) {
    await intakeRequestsRepo.updateStatus(requestRow.id, requestRow.status, 'files_received');
    await eventsRepo.recordEvent(requestRow.id, 'request.files_received');

    const email = buildUploadCompleteInternalEmail({
      publicReference: requestRow.public_reference,
      fileCount: totals.fileCount,
    });
    email.to = serverConfig.intakeInternalToEmail;
    const sendResult = await sendEmailSafely(email);
    await eventsRepo.recordEvent(
      requestRow.id,
      sendResult.success
        ? 'request.upload_complete_notification_sent'
        : 'request.upload_complete_notification_failed'
    );
  }

  return { kind: 'ok', fileCount: totals.fileCount };
}

/** Explicit customer action ("I'm done uploading") — marks the session used even below max_files. */
export async function finishUploadSession(rawToken: string): Promise<{ ok: boolean }> {
  const hash = tokenHash(rawToken);
  const session = await uploadSessionsRepo.findByTokenHash(hash);
  const validity = uploadSessionsRepo.evaluateTokenValidity(session);
  if (!validity.valid) return { ok: false };
  await uploadSessionsRepo.markSessionUsed(validity.session.id);
  return { ok: true };
}
