// ============================================================
// public_intake_events repository — INSERT-only
// PHX-LAUNCH-001
// ------------------------------------------------------------
// No UPDATE or DELETE function exists in this module by design,
// matching the append-only discipline established for
// audit_records/report_artifacts in apps/backend.
//
// `detail` must never contain: the customer's free-text message,
// raw IP, Turnstile token, upload token (raw or hashed), file
// contents, original filename, or any provider secret. Callers pass
// only small, non-sensitive structured metadata (e.g. { attempt: 2 }
// or { reason: 'expired' }).
// ============================================================

import { intakeQuery } from '../db';

export type IntakeEventType =
  | 'request.received'
  | 'request.validation_rejected'
  | 'request.consent_missing'
  | 'request.turnstile_rejected'
  | 'request.turnstile_provider_error'
  | 'request.rate_limited_ip'
  | 'request.rate_limited_email'
  | 'request.duplicate_suppressed'
  | 'request.confirmation_email_sent'
  | 'request.confirmation_email_failed'
  | 'request.internal_notification_sent'
  | 'request.internal_notification_failed'
  | 'request.status_changed'
  | 'request.upload_session_created'
  | 'request.upload_invited'
  | 'request.upload_invite_email_sent'
  | 'request.upload_invite_email_failed'
  | 'request.upload_session_revoked'
  | 'upload.token_denied_invalid'
  | 'upload.token_denied_expired'
  | 'upload.token_denied_revoked'
  | 'upload.token_denied_used'
  | 'upload.token_accepted'
  | 'upload.object_signed'
  | 'upload.file_rejected_type'
  | 'upload.file_rejected_size'
  | 'upload.completion_verified'
  | 'request.files_received'
  | 'request.upload_complete_notification_sent'
  | 'request.upload_complete_notification_failed'
  | 'request.rejected'
  | 'request.closed'
  | 'monitoring.error_captured';

export interface IntakeEventRow {
  id: string;
  request_id: string;
  event_type: IntakeEventType;
  detail: Record<string, unknown> | null;
  created_at: Date;
}

export async function recordEvent(
  requestId: string,
  eventType: IntakeEventType,
  detail: Record<string, unknown> | null = null
): Promise<IntakeEventRow> {
  const rows = await intakeQuery<IntakeEventRow>(
    `INSERT INTO public_intake_events (request_id, event_type, detail)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [requestId, eventType, detail ? JSON.stringify(detail) : null]
  );
  return rows[0];
}

export async function listEventsForRequest(requestId: string): Promise<IntakeEventRow[]> {
  return intakeQuery<IntakeEventRow>(
    `SELECT * FROM public_intake_events WHERE request_id = $1 ORDER BY created_at ASC`,
    [requestId]
  );
}
