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

export async function issueUploadSession(requestId: string): Promise<IssueUploadSessionOutcome> {
  const existing = await intakeRequestsRepo.findById(requestId);
  if (!existing) return { kind: 'not_found' };

  if (!intakeRequestsRepo.isAllowedStatusTransition(existing.status, 'upload_invited')) {
    return { kind: 'invalid_transition', from: existing.status };
  }

  const rawToken = generateRawUploadToken();

  const transactionResult = await withIntakeTransaction(async (query) => {
    // Re-check inside the transaction (TOCTOU-safe): the earlier
    // findById above is only used for the cheap not_found/invalid_transition
    // pre-checks; the authoritative check is this one.
    const alreadyActive = await uploadSessionsRepo.findActiveSessionForRequestInTransaction(query, requestId);
    if (alreadyActive) {
      return { kind: 'session_already_active' as const };
    }
    const updated = await intakeRequestsRepo.updateStatusInTransaction(query, requestId, existing.status, 'upload_invited');
    if (!updated) {
      return { kind: 'invalid_transition' as const, from: existing.status };
    }
    await eventsRepo.recordEventInTransaction(query, requestId, 'request.status_changed', {
      from: existing.status,
      to: 'upload_invited',
    });
    const session = await uploadSessionsRepo.createUploadSessionInTransaction(query, requestId, tokenHash(rawToken));
    await eventsRepo.recordEventInTransaction(query, requestId, 'request.upload_session_created');
    await eventsRepo.recordEventInTransaction(query, requestId, 'request.upload_invited');
    return { kind: 'ok' as const, session, publicReference: updated.public_reference, workEmail: updated.work_email_normalized };
  });

  if (transactionResult.kind !== 'ok') {
    return transactionResult;
  }

  const { session, publicReference, workEmail } = transactionResult;

  const uploadUrl = `${publicConfig.siteUrl}/upload/${rawToken}`;
  const email = buildUploadInvitationEmail({
    publicReference,
    uploadUrl,
    expiresAt: session.expires_at,
  });
  email.to = workEmail;
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
    await eventsRepo.recordEvent(requestId, 'request.upload_session_revoked');
  }
  return { revoked: Boolean(revoked) };
}
