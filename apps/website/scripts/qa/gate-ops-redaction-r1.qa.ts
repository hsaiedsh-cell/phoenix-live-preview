// ============================================================
// QA: Operations CLI redaction (R1: PHX-LAUNCH-001-R1 §5)
// EXECUTED against real local Postgres, calling the REAL
// buildSafeSummary function exported by scripts/ops/intake-ops.ts --
// not a reimplementation.
// ============================================================

import { randomUUID } from 'node:crypto';
import { assert, section, printSummaryAndExit } from './assert';
import { intakeQuery } from '../../src/lib/intake/db';
import * as intakeRequestsRepo from '../../src/lib/intake/repositories/intake-requests.repository';
import { buildSafeSummary } from '../ops/intake-ops';
import { CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION } from '../../src/lib/intake/config';

const SENSITIVE_MARKER_MESSAGE = 'CONFIDENTIAL_MESSAGE_BODY_MARKER_xyz';
const SENSITIVE_MARKER_EMAIL = `sensitive-email-marker-${randomUUID()}@acme.example`;

async function createTestRequest(): Promise<intakeRequestsRepo.IntakeRequestRow> {
  return intakeQuery<intakeRequestsRepo.IntakeRequestRow>(
    `INSERT INTO public_intake_requests (
       public_reference, request_type, first_name, last_name, work_email_normalized,
       company, role, message, phone, privacy_consent, privacy_version, terms_version,
       marketing_consent, consent_timestamp, idempotency_key_hash, ip_hash
     ) VALUES ('PHX-REQ-' || substr(md5(random()::text), 1, 12), 'assessment', 'Ops', 'RedactionTest',
       $1, 'Acme', 'CAIO', $2, '+1-555-0100', true, $3, $4, false, now(), $5, 'deadbeef-fake-ip-hash-value')
     RETURNING *`,
    [SENSITIVE_MARKER_EMAIL, SENSITIVE_MARKER_MESSAGE, CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION, randomUUID()]
  ).then((rows) => rows[0]);
}

async function main() {
  section('1. R1 §5: buildSafeSummary (the real function `find` uses by default) contains only safe fields');
  const row = await createTestRequest();
  const summary = await buildSafeSummary(row);
  const summaryJson = JSON.stringify(summary);

  assert(summary.publicReference === row.public_reference, 'safe summary includes publicReference');
  assert(summary.status === row.status, 'safe summary includes status');
  assert(summary.requestType === row.request_type, 'safe summary includes requestType');
  assert(summary.company === row.company, 'safe summary includes company');
  assert(typeof summary.createdAt === 'string' && typeof summary.updatedAt === 'string', 'safe summary includes created/updated timestamps');
  assert(typeof summary.fileCount === 'number', 'safe summary includes a file count');
  assert('uploadSessionStatus' in summary, 'safe summary includes upload-session status (null when none exists)');

  section('2. R1 §5: the safe summary NEVER contains the sensitive fields, even though the source row does');
  assert(!summaryJson.includes(SENSITIVE_MARKER_MESSAGE), 'safe summary does not contain the customer message');
  assert(!summaryJson.includes(SENSITIVE_MARKER_EMAIL), 'safe summary does not contain the customer email');
  assert(!summaryJson.includes('+1-555-0100'), 'safe summary does not contain the phone number');
  assert(!summaryJson.includes('deadbeef-fake-ip-hash-value'), 'safe summary does not contain the IP hash');
  assert(!('message' in summary), 'safe summary type has no message field at all');
  assert(!('workEmailNormalized' in summary) && !('email' in summary), 'safe summary type has no email field at all');
  assert(!('phone' in summary), 'safe summary type has no phone field at all');
  assert(!('ipHash' in summary) && !('ip_hash' in summary), 'safe summary type has no IP hash field at all');
  assert(!('idempotencyKeyHash' in summary) && !('idempotency_key_hash' in summary), 'safe summary type has no idempotency hash field at all');

  section('3. Confirming the full row DOES contain those fields (so the redaction above is meaningful, not vacuous)');
  const fullRowJson = JSON.stringify(row);
  assert(fullRowJson.includes(SENSITIVE_MARKER_MESSAGE), 'sanity check: the full underlying row DOES contain the message (proves the redaction test above is real, not trivially true)');
  assert(fullRowJson.includes(SENSITIVE_MARKER_EMAIL), 'sanity check: the full underlying row DOES contain the email');

  printSummaryAndExit();
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('gate-ops-redaction-r1.qa.ts failed:', error);
  process.exitCode = 1;
});
