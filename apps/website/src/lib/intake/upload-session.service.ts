// ============================================================
// Upload-session issuance service
// PHX-LAUNCH-001
// ------------------------------------------------------------
// Backs POST /api/intake/:requestId/upload-session. Internal-only
// (ops secret required by the route handler) — never called from
// browser code. Only valid from status 'under_review'.
// ============================================================

import * as intakeRequestsRepo from './repositories/intake-requests.repository';
import * as eventsRepo from './repositories/intake-events.repository';
import * as uploadSessionsRepo from './repositories/upload-sessions.repository';
import { generateRawUploadToken, tokenHash } from './hash';
import { sendEmailSafely } from './adapters';
import { buildUploadInvitationEmail } from './adapters/email.adapter';
import { publicConfig } from './config';

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

  const alreadyActive = await uploadSessionsRepo.findActiveSessionForRequest(requestId);
  if (alreadyActive) {
    return { kind: 'session_already_active' };
  }

  const updated = await intakeRequestsRepo.updateStatus(requestId, existing.status, 'upload_invited');
  if (!updated) {
    return { kind: 'invalid_transition', from: existing.status };
  }
  await eventsRepo.recordEvent(requestId, 'request.status_changed', { from: existing.status, to: 'upload_invited' });

  const rawToken = generateRawUploadToken();
  const session = await uploadSessionsRepo.createUploadSession(requestId, tokenHash(rawToken));
  await eventsRepo.recordEvent(requestId, 'request.upload_session_created');
  await eventsRepo.recordEvent(requestId, 'request.upload_invited');

  const uploadUrl = `${publicConfig.siteUrl}/upload/${rawToken}`;
  const email = buildUploadInvitationEmail({
    publicReference: updated.public_reference,
    uploadUrl,
    expiresAt: session.expires_at,
  });
  email.to = updated.work_email_normalized;
  const sendResult = await sendEmailSafely(email);
  await eventsRepo.recordEvent(
    requestId,
    sendResult.success ? 'request.upload_invite_email_sent' : 'request.upload_invite_email_failed'
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
