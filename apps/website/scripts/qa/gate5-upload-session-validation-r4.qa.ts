// ============================================================
// QA: Strict internal upload-session route body validation (R4)
// PHX-LAUNCH-001-R4 Section 5
// EXECUTED against a real local Postgres instance, calling the
// actual Next.js route handler module directly with constructed
// Request objects (no real HTTP server, but real route code, real
// ops-secret check, real body parsing, real service calls).
// ============================================================

import { randomUUID } from 'node:crypto';
import { assert, section, printSummaryAndExit } from './assert';
import { intakeQuery } from '../../src/lib/intake/db';
import * as intakeRequestsRepo from '../../src/lib/intake/repositories/intake-requests.repository';
import { CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION } from '../../src/lib/intake/config';

const OPS_SECRET = 'test-ops-secret-for-r4-qa-only-not-real-1234567890';
process.env.INTAKE_OPS_SECRET = OPS_SECRET;

async function createTestRequest(status = 'under_review'): Promise<intakeRequestsRepo.IntakeRequestRow> {
  return intakeQuery<intakeRequestsRepo.IntakeRequestRow>(
    `INSERT INTO public_intake_requests (
       public_reference, request_type, first_name, last_name, work_email_normalized,
       company, role, message, privacy_consent, privacy_version, terms_version,
       marketing_consent, consent_timestamp, idempotency_key_hash, ip_hash, status
     ) VALUES ('PHX-REQ-' || substr(md5(random()::text), 1, 12), 'assessment', 'R4Gate5', 'Tester',
       $1, 'Acme', 'CAIO', 'strict validation QA r4', true, $2, $3, false, now(), $4, null, $5)
     RETURNING *`,
    [`r4gate5-${randomUUID()}@acme.example`, CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION, randomUUID(), status]
  ).then((rows) => rows[0]);
}

function makeRequest(body: string, contentType = 'application/json'): Request {
  return new Request('https://phoenixops.ai/api/intake/x/upload-session', {
    method: 'POST',
    headers: { 'content-type': contentType, 'x-intake-ops-secret': OPS_SECRET },
    body,
  });
}

async function main() {
  const { POST } = await import('../../src/app/api/intake/[requestId]/upload-session/route');

  section('1. Malformed JSON never issues a session');
  {
    const request = await createTestRequest();
    const response = await POST(makeRequest('{not valid json!!'), { params: Promise.resolve({ requestId: request.id }) });
    assert(response.status !== 200, 'malformed JSON does not return 200');
    assert([413, 422].includes(response.status), `malformed JSON is rejected with an explicit error status (got ${response.status})`);
    const row = await intakeRequestsRepo.findById(request.id);
    assert(row?.status === 'under_review', 'the request status is completely unchanged -- no invitation was issued');
  }

  section('2. Oversized body never issues a session');
  {
    const request = await createTestRequest();
    const hugeBody = JSON.stringify({ revoke: false, padding: 'x'.repeat(200_000) });
    const response = await POST(makeRequest(hugeBody), { params: Promise.resolve({ requestId: request.id }) });
    assert(response.status !== 200, 'an oversized body does not return 200');
    const row = await intakeRequestsRepo.findById(request.id);
    assert(row?.status === 'under_review', 'the request status is completely unchanged for an oversized body');
  }

  section('3. Invalid revoke type never issues a session (schema-invalid -> 422)');
  {
    const request = await createTestRequest();
    const response = await POST(makeRequest(JSON.stringify({ revoke: 'yes please' })), { params: Promise.resolve({ requestId: request.id }) });
    assert(response.status === 422, `a schema-invalid body (revoke as a string, not boolean) is rejected with 422 (got ${response.status})`);
    const row = await intakeRequestsRepo.findById(request.id);
    assert(row?.status === 'under_review', 'no invitation was issued for the invalid-schema body');
  }

  section('4. A valid empty object issues an invite');
  {
    const request = await createTestRequest();
    const response = await POST(makeRequest(JSON.stringify({})), { params: Promise.resolve({ requestId: request.id }) });
    assert(response.status === 200, `a valid empty object body succeeds (got ${response.status})`);
    const row = await intakeRequestsRepo.findById(request.id);
    assert(row?.status === 'upload_invited', 'the request genuinely transitioned to upload_invited');
  }

  section('5. A valid {revoke:true} revokes (no session existed, so reports no_active_session, not an error)');
  {
    const request = await createTestRequest();
    const response = await POST(makeRequest(JSON.stringify({ revoke: true })), { params: Promise.resolve({ requestId: request.id }) });
    assert(response.status === 200, `a valid revoke:true body is accepted and processed (got ${response.status})`);
    const body = (await response.json()) as { revoked: boolean };
    assert(body.revoked === false, 'reports revoked:false since no active session existed for this fresh request -- still a valid, processed request, not a validation error');
  }

  section('6. A valid {revoke:true} against a request WITH an active session genuinely revokes it');
  {
    const request = await createTestRequest();
    const inviteResponse = await POST(makeRequest(JSON.stringify({})), { params: Promise.resolve({ requestId: request.id }) });
    assert(inviteResponse.status === 200, 'invite issued');
    const revokeResponse = await POST(makeRequest(JSON.stringify({ revoke: true })), { params: Promise.resolve({ requestId: request.id }) });
    assert(revokeResponse.status === 200, 'revoke request succeeds');
    const revokeBody = (await revokeResponse.json()) as { revoked: boolean };
    assert(revokeBody.revoked === true, 'the active session is genuinely revoked');
  }

  printSummaryAndExit();
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('gate5-upload-session-validation-r4.qa.ts failed:', error);
  process.exitCode = 1;
});
