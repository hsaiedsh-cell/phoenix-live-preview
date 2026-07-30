// ============================================================
// Upload-session issuance service
// PHX-LAUNCH-001 (R1: PHX-LAUNCH-001-R1 §4.3)
// ------------------------------------------------------------
// Backs POST /api/intake/:requestId/upload-session. Internal-only
// (ops secret required by the route handler) -- never called from
// browser code. Only valid from status 'under_review'.
//
// R1: status transition + session creation + their two core events
// now commit atomically in ONE transaction (see
// db.ts's withIntakeTransaction), so a mid-flight database failure
// can never leave the request in upload_invited without a
// corresponding upload session. The invitation email is sent only
// AFTER that transaction commits, carrying a stable per-session
// provider idempotency key.
// ============================================================

import * as intakeRequestsRepo from './repositories/intake-requests.repository';
import * as eventsRepo from './repositories/intake-events.repository';
import * as uploadSessionsRepo from './repositories/upload-sessions.repository';
import { generateRawUploadToken, tokenHash } from './hash';
import { sendEmailSafely } from './adapters';
import { recordPostCommitEvent } from './post-commit';
import { buildUploadInvitationEmail } from './adapters/email.adapter';
import { publicConfig } from './config';
import { withIntakeTransaction } from './db';

export type IssueUploadSessionOutcome =
  | { kind: 'not_found' }
  | { kind: 'invalid_transition'; from: string }
  | { kind: 'session_already_active' }
  | { kind: 'ok'; expiresAt: Date; emailSent: boolean };

/**
 * R5 (§1): supports both the initial invitation (under_review ->
 * upload_invited) and a REPLACEMENT invitation (upload_invited, no
 * usable active session remaining -- the prior one was revoked or
 * has expired) without a fake upload_invited -> upload_invited
 * transition. Everything happens inside one transaction: the parent
 * request row is locked FOR UPDATE first, then any existing 'active'
 * session is locked and, if already past expires_at, atomically
 * expired right there (closing the gap where an expired-but-not-yet-
 * cleaned-up session permanently blocked reissue). A genuinely
 * active, unexpired session still blocks with session_already_active,
 * exactly as before.
 */
export async function issueUploadSession(requestId: string): Promise<IssueUploadSessionOutcome> {
  const rawToken = generateRawUploadToken();

  const transactionResult = await withIntakeTransaction(async (query) => {
    const lockedRequest = await intakeRequestsRepo.lockRequestForUpdate(query, requestId);
    if (!lockedRequest) return { kind: 'not_found' as const };

    const isInitial = lockedRequest.status === 'under_review';
    const isReplacement = lockedRequest.status === 'upload_invited';
    if (!isInitial && !isReplacement) {
      return { kind: 'invalid_transition' as const, from: lockedRequest.status };
    }

    const stillUsableActiveSession = await uploadSessionsRepo.lockAndExpireIfStaleActiveSessionInTransaction(query, requestId);
    if (stillUsableActiveSession) {
      return { kind: 'session_already_active' as const };
    }

    if (isInitial) {
      const updated = await intakeRequestsRepo.updateStatusInTransaction(query, requestId, lockedRequest.status, 'upload_invited');
      if (!updated) {
        return { kind: 'invalid_transition' as const, from: lockedRequest.status };
      }
      await eventsRepo.recordEventInTransaction(query, requestId, 'request.status_changed', {
        from: lockedRequest.status,
        to: 'upload_invited',
      });
    } else {
      // R5 (§1): replacement -- no fake same-status transition. A
      // dedicated core event marks this specifically as a reissue,
      // distinct from the initial invitation.
      await eventsRepo.recordEventInTransaction(query, requestId, 'request.upload_session_reissued');
    }

    const session = await uploadSessionsRepo.createUploadSessionInTransaction(query, requestId, tokenHash(rawToken));
    await eventsRepo.recordEventInTransaction(query, requestId, 'request.upload_session_created');
    await eventsRepo.recordEventInTransaction(query, requestId, 'request.upload_invited');
    return {
      kind: 'ok' as const,
      session,
      publicReference: lockedRequest.public_reference,
      workEmail: lockedRequest.work_email_normalized,
    };
  });

  if (transactionResult.kind !== 'ok') {
    return transactionResult;
  }

  const { session, publicReference, workEmail } = transactionResult;

  const uploadUrlValue = new URL('/upload', publicConfig.siteUrl);
  uploadUrlValue.hash = new URLSearchParams({ token: rawToken }).toString();
  const uploadUrl = uploadUrlValue.toString();
  const email = buildUploadInvitationEmail({
    publicReference,
    uploadUrl,
    expiresAt: session.expires_at,
  });
  email.to = workEmail;
  // Already per-session (not per-request) -- a replacement session
  // gets its own distinct provider idempotency key, since it is a
  // different session.id (R5 §1's own QA proves this explicitly).
  email.idempotencyKey = `upload-invitation/${session.id}`;
  const sendResult = await sendEmailSafely(email);
  await recordPostCommitEvent(
    requestId,
    sendResult.success ? 'request.upload_invite_email_sent' : 'request.upload_invite_email_failed',
    { route: 'issueUploadSession' }
  );

  return { kind: 'ok', expiresAt: session.expires_at, emailSent: sendResult.success };
}

export async function revokeUploadSession(requestId: string): Promise<{ revoked: boolean }> {
  const active = await uploadSessionsRepo.findActiveSessionForRequest(requestId);
  if (!active) return { revoked: false };
  const revoked = await uploadSessionsRepo.revokeSession(active.id);
  if (revoked) {
    await recordPostCommitEvent(requestId, 'request.upload_session_revoked', { route: 'revokeUploadSession' });
  }
  return { revoked: Boolean(revoked) };
}
