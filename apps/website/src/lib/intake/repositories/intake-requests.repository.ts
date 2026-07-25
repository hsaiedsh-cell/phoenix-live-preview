// ============================================================
// public_intake_requests repository
// PHX-LAUNCH-001
// ------------------------------------------------------------
// Raw parameterized SQL only, matching this repo's established
// no-ORM convention. Every write is server-side only.
// ============================================================

import { intakeQuery, type TransactionQuery } from '../db';
import { generatePublicReference } from '../reference';

export type IntakeRequestStatus =
  | 'received'
  | 'under_review'
  | 'upload_invited'
  | 'files_received'
  | 'quoted'
  | 'accepted'
  | 'rejected'
  | 'closed';

export interface IntakeRequestRow {
  id: string;
  public_reference: string;
  request_type: string;
  first_name: string;
  last_name: string;
  work_email_normalized: string;
  company: string;
  role: string;
  phone: string | null;
  country: string | null;
  estimated_timeline: string | null;
  message: string;
  status: IntakeRequestStatus;
  privacy_consent: boolean;
  privacy_version: string;
  terms_version: string;
  marketing_consent: boolean;
  consent_timestamp: Date;
  idempotency_key_hash: string;
  ip_hash: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface CreateIntakeRequestInput {
  requestType: string;
  firstName: string;
  lastName: string;
  workEmailNormalized: string;
  company: string;
  role: string;
  phone?: string;
  country?: string;
  estimatedTimeline?: string;
  message: string;
  privacyVersion: string;
  termsVersion: string;
  marketingConsent: boolean;
  idempotencyKeyHash: string;
  ipHash: string | null;
}

/**
 * R1: plain insert only — no ON CONFLICT / idempotency logic here
 * anymore. Concurrency-safe idempotent replay resolution (including
 * the advisory-lock transaction and the 15-minute window) now lives
 * in submit.service.ts's resolveIdempotentSubmission, which calls
 * this function only once it has already determined a new row is
 * genuinely needed. `query` is the caller's transaction-scoped query
 * function (see db.ts's withIntakeTransaction) so this insert and
 * the caller's idempotency-key insert and request.received event
 * insert all commit or roll back together (PHX-LAUNCH-001-R1 §4.3).
 */
export async function insertRequest(
  query: TransactionQuery,
  input: CreateIntakeRequestInput
): Promise<IntakeRequestRow> {
  const publicReference = generatePublicReference();
  const rows = await query<IntakeRequestRow>(
    `INSERT INTO public_intake_requests (
       public_reference, request_type, first_name, last_name,
       work_email_normalized, company, role, phone, country,
       estimated_timeline, message, privacy_consent, privacy_version,
       terms_version, marketing_consent, consent_timestamp,
       idempotency_key_hash, ip_hash
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true,$12,$13,$14,now(),$15,$16)
     RETURNING *`,
    [
      publicReference,
      input.requestType,
      input.firstName,
      input.lastName,
      input.workEmailNormalized,
      input.company,
      input.role,
      input.phone ?? null,
      input.country ?? null,
      input.estimatedTimeline ?? null,
      input.message,
      input.privacyVersion,
      input.termsVersion,
      input.marketingConsent,
      input.idempotencyKeyHash,
      input.ipHash,
    ]
  );
  return rows[0];
}

export async function findByPublicReference(publicReference: string): Promise<IntakeRequestRow | null> {
  const rows = await intakeQuery<IntakeRequestRow>(
    `SELECT * FROM public_intake_requests WHERE public_reference = $1`,
    [publicReference]
  );
  return rows[0] ?? null;
}

export async function findById(id: string): Promise<IntakeRequestRow | null> {
  const rows = await intakeQuery<IntakeRequestRow>(
    `SELECT * FROM public_intake_requests WHERE id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

const ALLOWED_TRANSITIONS: Record<IntakeRequestStatus, IntakeRequestStatus[]> = {
  received: ['under_review', 'rejected', 'closed'],
  under_review: ['upload_invited', 'rejected', 'quoted', 'closed'],
  upload_invited: ['files_received', 'rejected', 'closed'],
  files_received: ['quoted', 'rejected', 'closed'],
  quoted: ['accepted', 'rejected', 'closed'],
  accepted: ['closed'],
  rejected: ['closed'],
  closed: [],
};

export function isAllowedStatusTransition(from: IntakeRequestStatus, to: IntakeRequestStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export async function updateStatus(
  id: string,
  fromStatus: IntakeRequestStatus,
  toStatus: IntakeRequestStatus
): Promise<IntakeRequestRow | null> {
  if (!isAllowedStatusTransition(fromStatus, toStatus)) {
    throw new Error(`invalid_status_transition:${fromStatus}->${toStatus}`);
  }
  const rows = await intakeQuery<IntakeRequestRow>(
    `UPDATE public_intake_requests
       SET status = $1, updated_at = now()
       WHERE id = $2 AND status = $3
       RETURNING *`,
    [toStatus, id, fromStatus]
  );
  return rows[0] ?? null;
}

/**
 * R1 (§4.3): transaction-scoped variant so a status transition can
 * commit atomically together with e.g. upload-session creation —
 * "a database failure cannot leave upload_invited without an upload
 * session."
 */
export async function updateStatusInTransaction(
  query: TransactionQuery,
  id: string,
  fromStatus: IntakeRequestStatus,
  toStatus: IntakeRequestStatus
): Promise<IntakeRequestRow | null> {
  if (!isAllowedStatusTransition(fromStatus, toStatus)) {
    throw new Error(`invalid_status_transition:${fromStatus}->${toStatus}`);
  }
  const rows = await query<IntakeRequestRow>(
    `UPDATE public_intake_requests
       SET status = $1, updated_at = now()
       WHERE id = $2 AND status = $3
       RETURNING *`,
    [toStatus, id, fromStatus]
  );
  return rows[0] ?? null;
}

export async function listRequests(limit = 50): Promise<IntakeRequestRow[]> {
  return intakeQuery<IntakeRequestRow>(
    `SELECT * FROM public_intake_requests ORDER BY created_at DESC LIMIT $1`,
    [Math.min(limit, 200)]
  );
}
