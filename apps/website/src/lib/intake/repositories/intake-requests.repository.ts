// ============================================================
// public_intake_requests repository
// PHX-LAUNCH-001
// ------------------------------------------------------------
// Raw parameterized SQL only, matching this repo's established
// no-ORM convention. Every write is server-side only.
// ============================================================

import { intakeQuery, type TransactionQuery } from '../db';
import { generatePublicReference } from '../reference';
import {
  decodeOperatorQueueCursor,
  encodeOperatorQueueCursor,
  type OperatorQueueQueryInput,
} from '../schema';

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

/**
 * R3 (§1): transaction-scoped lock/read, used by upload finalization
 * so the parent request row is locked and revalidated INSIDE the same
 * transaction that also holds the upload-session and reservation
 * locks -- never read via the global pool (findById) from inside a
 * withIntakeTransaction callback, which previously both risked a
 * pool self-deadlock under concurrency and left the request row
 * completely unlocked/unrevalidated at the moment of finalization.
 */
export async function lockRequestForUpdate(query: TransactionQuery, id: string): Promise<IntakeRequestRow | null> {
  const rows = await query<IntakeRequestRow>(
    `SELECT * FROM public_intake_requests WHERE id = $1 FOR UPDATE`,
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

// ============================================================
// PHX-LAUNCH-002 R2 — privacy-minimized operator read model
// ============================================================

export type OperatorUploadSessionStatus = 'active' | 'used' | 'revoked' | 'expired';

export interface OperatorQueueItem {
  requestId: string;
  publicReference: string;
  status: IntakeRequestStatus;
  requestType: string;
  company: string;
  createdAt: string;
  updatedAt: string;
  fileCount: number;
  uploadSessionStatus: OperatorUploadSessionStatus | null;
}

export interface OperatorQueueResult {
  items: OperatorQueueItem[];
  total: number;
  nextCursor: string | null;
}

interface OperatorQueueRow {
  request_id: string;
  public_reference: string;
  status: IntakeRequestStatus;
  request_type: string;
  company: string;
  created_at: Date;
  updated_at: Date;
  file_count: number;
  upload_session_status: OperatorUploadSessionStatus | null;
}

interface OperatorQueueSql {
  whereSql: string;
  values: unknown[];
}

export function escapeOperatorQueueSearch(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function addOperatorQueueValue(values: unknown[], value: unknown): string {
  values.push(value);
  return `$${values.length}`;
}

function buildOperatorQueueSql(
  input: OperatorQueueQueryInput,
  includeCursor: boolean
): OperatorQueueSql {
  const clauses: string[] = [];
  const values: unknown[] = [];
  const search = input.search?.trim();

  if (search) {
    const parameter = addOperatorQueueValue(
      values,
      `%${escapeOperatorQueueSearch(search)}%`
    );
    clauses.push(`(
      r.public_reference ILIKE ${parameter} ESCAPE '\\'
      OR r.company ILIKE ${parameter} ESCAPE '\\'
      OR (r.first_name || ' ' || r.last_name) ILIKE ${parameter} ESCAPE '\\'
      OR r.work_email_normalized::text ILIKE ${parameter} ESCAPE '\\'
    )`);
  }

  if (input.statuses.length > 0) {
    const parameter = addOperatorQueueValue(values, input.statuses);
    clauses.push(`r.status = ANY(${parameter}::text[])`);
  }

  if (input.requestTypes.length > 0) {
    const parameter = addOperatorQueueValue(values, input.requestTypes);
    clauses.push(`r.request_type = ANY(${parameter}::text[])`);
  }

  if (input.createdFrom) {
    const parameter = addOperatorQueueValue(values, input.createdFrom);
    clauses.push(`r.created_at >= ${parameter}::timestamptz`);
  }

  if (input.createdTo) {
    const parameter = addOperatorQueueValue(values, input.createdTo);
    clauses.push(`r.created_at <= ${parameter}::timestamptz`);
  }

  if (includeCursor && input.cursor) {
    const cursor = decodeOperatorQueueCursor(input.cursor);
    if (!cursor) throw new Error('invalid_operator_queue_cursor');

    const createdAtParameter = addOperatorQueueValue(values, cursor.createdAt);
    const requestIdParameter = addOperatorQueueValue(values, cursor.requestId);
    clauses.push(
      `(r.created_at, r.id) < (${createdAtParameter}::timestamptz, ${requestIdParameter}::uuid)`
    );
  }

  return {
    whereSql: clauses.length > 0 ? `WHERE ${clauses.join('\n      AND ')}` : '',
    values,
  };
}

export async function queryOperatorQueue(
  input: OperatorQueueQueryInput
): Promise<OperatorQueueResult> {
  const countSql = buildOperatorQueueSql(input, false);
  const countRows = await intakeQuery<{ total: string }>(
    `SELECT count(*)::text AS total
     FROM public_intake_requests r
     ${countSql.whereSql}`,
    countSql.values
  );

  const pageSql = buildOperatorQueueSql(input, true);
  const fetchLimit = input.limit + 1;
  const limitParameter = addOperatorQueueValue(pageSql.values, fetchLimit);

  const rows = await intakeQuery<OperatorQueueRow>(
    `SELECT
       r.id AS request_id,
       r.public_reference,
       r.status,
       r.request_type,
       r.company,
       r.created_at,
       r.updated_at,
       COALESCE(file_summary.file_count, 0)::int AS file_count,
       latest_session.status AS upload_session_status
     FROM public_intake_requests r
     LEFT JOIN LATERAL (
       SELECT
         session.id,
         session.status
       FROM public_upload_sessions session
       WHERE session.request_id = r.id
       ORDER BY session.created_at DESC, session.id DESC
       LIMIT 1
     ) latest_session ON true
     LEFT JOIN LATERAL (
       SELECT count(*)::int AS file_count
       FROM public_intake_files file
       WHERE file.upload_session_id = latest_session.id
         AND file.reservation_status = 'completed'
     ) file_summary ON true
     ${pageSql.whereSql}
     ORDER BY r.created_at DESC, r.id DESC
     LIMIT ${limitParameter}`,
    pageSql.values
  );

  const hasNextPage = rows.length > input.limit;
  const visibleRows = rows.slice(0, input.limit);
  const lastRow = visibleRows[visibleRows.length - 1];

  return {
    items: visibleRows.map((row) => ({
      requestId: row.request_id,
      publicReference: row.public_reference,
      status: row.status,
      requestType: row.request_type,
      company: row.company,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      fileCount: row.file_count,
      uploadSessionStatus: row.upload_session_status,
    })),
    total: Number(countRows[0]?.total ?? 0),
    nextCursor:
      hasNextPage && lastRow
        ? encodeOperatorQueueCursor({
            createdAt: lastRow.created_at.toISOString(),
            requestId: lastRow.request_id,
          })
        : null,
  };
}

export interface OperatorRequestDetail {
  requestId: string;
  publicReference: string;
  requestType: string;
  status: IntakeRequestStatus;
  firstName: string;
  lastName: string;
  workEmail: string;
  company: string;
  role: string;
  phone: string | null;
  country: string | null;
  estimatedTimeline: string | null;
  message: string;
  createdAt: string;
  updatedAt: string;
  fileCount: number;
  uploadSessionStatus: OperatorUploadSessionStatus | null;
}

interface OperatorRequestDetailRow {
  request_id: string;
  public_reference: string;
  request_type: string;
  status: IntakeRequestStatus;
  first_name: string;
  last_name: string;
  work_email: string;
  company: string;
  role: string;
  phone: string | null;
  country: string | null;
  estimated_timeline: string | null;
  message: string;
  created_at: Date;
  updated_at: Date;
  file_count: number;
  upload_session_status: OperatorUploadSessionStatus | null;
}

export async function findOperatorRequestDetailById(
  requestId: string
): Promise<OperatorRequestDetail | null> {
  const rows = await intakeQuery<OperatorRequestDetailRow>(
    `SELECT
       r.id AS request_id,
       r.public_reference,
       r.request_type,
       r.status,
       r.first_name,
       r.last_name,
       r.work_email_normalized::text AS work_email,
       r.company,
       r.role,
       r.phone,
       r.country,
       r.estimated_timeline,
       r.message,
       r.created_at,
       r.updated_at,
       COALESCE(file_summary.file_count, 0)::int AS file_count,
       latest_session.status AS upload_session_status
     FROM public_intake_requests r
     LEFT JOIN LATERAL (
       SELECT
         session.id,
         session.status
       FROM public_upload_sessions session
       WHERE session.request_id = r.id
       ORDER BY session.created_at DESC, session.id DESC
       LIMIT 1
     ) latest_session ON true
     LEFT JOIN LATERAL (
       SELECT count(*)::int AS file_count
       FROM public_intake_files file
       WHERE file.upload_session_id = latest_session.id
         AND file.reservation_status = 'completed'
     ) file_summary ON true
     WHERE r.id = $1`,
    [requestId]
  );

  const row = rows[0];
  if (!row) return null;

  return {
    requestId: row.request_id,
    publicReference: row.public_reference,
    requestType: row.request_type,
    status: row.status,
    firstName: row.first_name,
    lastName: row.last_name,
    workEmail: row.work_email,
    company: row.company,
    role: row.role,
    phone: row.phone,
    country: row.country,
    estimatedTimeline: row.estimated_timeline,
    message: row.message,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    fileCount: row.file_count,
    uploadSessionStatus: row.upload_session_status,
  };
}
