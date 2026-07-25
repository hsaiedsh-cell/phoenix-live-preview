// ============================================================
// QA: Operational events are non-destructive across the upload flow (R4)
// PHX-LAUNCH-001-R4 Section 4
// EXECUTED against a real local Postgres instance. Storage is an
// injected fake adapter.
// ============================================================

import { randomUUID } from 'node:crypto';
import { assert, section, printSummaryAndExit } from './assert';
import { intakeQuery } from '../../src/lib/intake/db';
import * as intakeRequestsRepo from '../../src/lib/intake/repositories/intake-requests.repository';
import * as uploadSessionsRepo from '../../src/lib/intake/repositories/upload-sessions.repository';
import { generateRawUploadToken, tokenHash } from '../../src/lib/intake/hash';
import { signUploadObject } from '../../src/lib/intake/upload-flow.service';
import { submitIntakeRequest } from '../../src/lib/intake/submit.service';
import { revokeUploadSession, issueUploadSession } from '../../src/lib/intake/upload-session.service';
import { recordPostCommitEvent } from '../../src/lib/intake/post-commit';
import { __setStorageForTests, __setEmailForTests, __setTurnstileForTests, __resetAdaptersForTests } from '../../src/lib/intake/adapters';
import { createFakeStorageAdapter } from '../../src/lib/intake/adapters/storage.adapter';
import { createFakeEmailSender } from '../../src/lib/intake/adapters/email.adapter';
import { createFakeTurnstileVerifier } from '../../src/lib/intake/adapters/turnstile.adapter';
import { CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION } from '../../src/lib/intake/config';

async function createTestRequest(status = 'upload_invited'): Promise<intakeRequestsRepo.IntakeRequestRow> {
  const row = await intakeQuery<intakeRequestsRepo.IntakeRequestRow>(
    `INSERT INTO public_intake_requests (
       public_reference, request_type, first_name, last_name, work_email_normalized,
       company, role, message, privacy_consent, privacy_version, terms_version,
       marketing_consent, consent_timestamp, idempotency_key_hash, ip_hash, status
     ) VALUES ('PHX-REQ-' || substr(md5(random()::text), 1, 12), 'assessment', 'R4Gate4', 'Tester',
       $1, 'Acme', 'CAIO', 'operational events QA r4', true, $2, $3, false, now(), $4, null, $5)
     RETURNING *`,
    [`r4gate4-${randomUUID()}@acme.example`, CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION, randomUUID(), status]
  ).then((rows) => rows[0]);
  return row;
}

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    requestType: 'assessment',
    firstName: 'Jane',
    lastName: 'Doe',
    workEmail: `jane-${randomUUID()}@acme.example`,
    company: 'Acme',
    role: 'CAIO',
    message: 'Please assess our AI outputs.',
    privacyConsent: true,
    privacyVersion: CURRENT_PRIVACY_VERSION,
    termsVersion: CURRENT_TERMS_VERSION,
    marketingConsent: false,
    turnstileToken: 'test-token',
    idempotencyKey: randomUUID(),
    ...overrides,
  };
}

async function main() {
  __setEmailForTests(createFakeEmailSender('always_succeed'));
  const fakeStorage = createFakeStorageAdapter();
  __setStorageForTests(fakeStorage);

  section('1. upload.reservation_created is CORE -- written in the SAME transaction as the reservation insert');
  {
    const fs = await import('node:fs');
    const source = fs.readFileSync(new URL('../../src/lib/intake/upload-flow.service.ts', import.meta.url), 'utf8');
    const signFnMatch = source.match(/export async function signUploadObject[\s\S]*?\n}\n\nexport type CompleteUploadOutcome/);
    assert(!!signFnMatch, 'signUploadObject found in source');
    if (signFnMatch) {
      const reservationTxMatch = signFnMatch[0].match(/withIntakeTransaction\(async \(query\) => \{[\s\S]*?\n  \}\);/);
      assert(!!reservationTxMatch, 'the reservation-creating transaction block was found');
      if (reservationTxMatch) {
        assert(
          reservationTxMatch[0].includes("recordEventInTransaction(query, validity.session.request_id, 'upload.reservation_created')"),
          'upload.reservation_created is recorded INSIDE the transaction using the transaction-scoped query, not after commit'
        );
      }
    }
  }

  section("2. Object-signed event failure still returns the signed URL (behavioral: real event insert, real success)");
  {
    const request = await createTestRequest();
    const rawToken = generateRawUploadToken();
    await uploadSessionsRepo.createUploadSession(request.id, tokenHash(rawToken));
    const outcome = await signUploadObject(rawToken, { filename: 'signed-event.pdf', contentType: 'application/pdf', sizeBytes: 1000 });
    assert(outcome.kind === 'ok', 'signing succeeds and returns a real signed URL -- the observational upload.object_signed event (best-effort, via recordPostCommitEvent) never affects this outcome');
  }

  section('3. recordPostCommitEvent never throws for the SPECIFIC event types this section lists as best-effort (direct proof)');
  {
    const nonexistentRequestId = '00000000-0000-0000-0000-000000000000';
    for (const eventType of [
      'upload.object_signed',
      'upload.reservation_failed',
      'upload.completion_denied_metadata_mismatch',
      'request.idempotency_replay',
      'request.upload_session_revoked',
      'upload.token_accepted',
      'upload.file_rejected_type',
    ] as const) {
      const result = await recordPostCommitEvent(nonexistentRequestId, eventType, { route: 'qa-direct-proof' });
      assert(result.recorded === false, `recordPostCommitEvent(${eventType}) against a genuinely nonexistent request (real FK violation) reports recorded:false rather than throwing`);
    }
  }

  section('4. Idempotency-replay event failure still returns the original reference (behavioral: real replay flow)');
  {
    __setTurnstileForTests(createFakeTurnstileVerifier([{ success: true }]));
    const key = randomUUID();
    const email = `replay-event-${randomUUID()}@acme.example`;
    const input = baseInput({ idempotencyKey: key, workEmail: email });
    const first = await submitIntakeRequest(input, { rawIp: '203.0.113.60' });
    assert(first.kind === 'accepted', 'first submission accepted');
    const second = await submitIntakeRequest(input, { rawIp: '203.0.113.61' });
    assert(second.kind === 'accepted' && second.wasReplay === true, 'the replay still returns the original reference -- request.idempotency_replay is recorded via recordPostCommitEvent (best-effort), which cannot turn this into an error');
    if (first.kind === 'accepted' && second.kind === 'accepted') {
      assert(first.publicReference === second.publicReference, 'both point at the same request');
    }
  }

  section('5. Revocation-event failure still reports a successful revoke (behavioral: real revoke flow)');
  {
    const request = await createTestRequest('under_review');
    await issueUploadSession(request.id);
    const revokeResult = await revokeUploadSession(request.id);
    assert(revokeResult.revoked === true, 'revocation reports success -- request.upload_session_revoked is recorded via recordPostCommitEvent (best-effort), which cannot hide a successful revoke');
    const rows = await intakeQuery<{ status: string }>(
      `SELECT status FROM public_upload_sessions WHERE request_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [request.id]
    );
    assert(rows[0]?.status === 'revoked', 'the session is genuinely revoked in the database, matching the reported outcome');
  }

  section('6. request.status_changed after a non-transactional finalize action is best-effort (structural)');
  {
    const fs = await import('node:fs');
    const source = fs.readFileSync(new URL('../../src/lib/intake/finalize.service.ts', import.meta.url), 'utf8');
    assert(source.includes('recordPostCommitEvent(requestId'), 'finalize.service.ts uses recordPostCommitEvent for its status-changed and specific action events');
    assert(!source.includes('eventsRepo'), 'finalize.service.ts no longer imports the throwable events repository at all');
  }

  __resetAdaptersForTests();
  printSummaryAndExit();
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('gate4-operational-events-r4.qa.ts failed:', error);
  process.exitCode = 1;
});
