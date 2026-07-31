// ============================================================
// QA: Per-session upload-complete email idempotency (R5)
// PHX-LAUNCH-001-R5 Section 2
// EXECUTED against a real local Postgres instance. Storage is an
// injected fake adapter.
// ============================================================

import { randomUUID } from 'node:crypto';
import { assert, section, printSummaryAndExit } from './assert';
import { intakeQuery } from '../../src/lib/intake/db';
import * as intakeRequestsRepo from '../../src/lib/intake/repositories/intake-requests.repository';
import * as uploadSessionsRepo from '../../src/lib/intake/repositories/upload-sessions.repository';
import { generateRawUploadToken, tokenHash } from '../../src/lib/intake/hash';
import { signUploadObject, completeUploadObject, finishUploadSession } from '../../src/lib/intake/upload-flow.service';
import { revokeUploadSession, issueUploadSession } from '../../src/lib/intake/upload-session.service';
import { __setStorageForTests, __setEmailForTests, __resetAdaptersForTests } from '../../src/lib/intake/adapters';
import { createFakeStorageAdapter } from '../../src/lib/intake/adapters/storage.adapter';
import { createFakeEmailSender } from '../../src/lib/intake/adapters/email.adapter';
import { CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION } from '../../src/lib/intake/config';

async function createTestRequest(status = 'upload_invited'): Promise<intakeRequestsRepo.IntakeRequestRow> {
  return intakeQuery<intakeRequestsRepo.IntakeRequestRow>(
    `INSERT INTO public_intake_requests (
       public_reference, request_type, first_name, last_name, work_email_normalized,
       company, role, message, privacy_consent, privacy_version, terms_version,
       marketing_consent, consent_timestamp, idempotency_key_hash, ip_hash, status
     ) VALUES ('PHX-REQ-' || substr(md5(random()::text), 1, 12), 'assessment', 'R5Gate2', 'Tester',
       $1, 'Acme', 'CAIO', 'per-session email idempotency QA r5', true, $2, $3, false, now(), $4, null, $5)
     RETURNING *`,
    [`r5gate2-${randomUUID()}@acme.example`, CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION, randomUUID(), status]
  ).then((rows) => rows[0]);
}

async function completeOneFile(rawToken: string, storage: ReturnType<typeof createFakeStorageAdapter>, filename: string) {
  const sign = await signUploadObject(rawToken, { filename, contentType: 'application/pdf', sizeBytes: 1000, reservationKey: randomUUID() });
  if (sign.kind !== 'ok') throw new Error(`unexpected sign outcome: ${sign.kind}`);
  storage.simulatedObjects.set(sign.storageObjectKey, { sizeBytes: 1000, contentType: 'application/pdf' });
  return completeUploadObject(rawToken, { storageObjectKey: sign.storageObjectKey });
}

async function main() {
  const fakeStorage = createFakeStorageAdapter();
  __setStorageForTests(fakeStorage);

  section('1. Duplicate finalization of one session requests exactly one semantic email');
  {
    const fakeEmail = createFakeEmailSender('always_succeed');
    __setEmailForTests(fakeEmail);
    const request = await createTestRequest();
    const rawToken = generateRawUploadToken();
    const session = await uploadSessionsRepo.createUploadSession(request.id, tokenHash(rawToken));
    await completeOneFile(rawToken, fakeStorage, 'f1.pdf');
    await finishUploadSession(rawToken);
    await finishUploadSession(rawToken); // duplicate finish attempt

    const completionEmails = fakeEmail.sentMessages.filter((m) => m.idempotencyKey?.startsWith('upload-complete/'));
    assert(completionEmails.length === 1, `exactly one upload-complete email was requested despite finish being called twice (got ${completionEmails.length})`);
    assert(completionEmails[0].idempotencyKey === `upload-complete/${session.id}`, 'the idempotency key uses the UPLOAD SESSION id, not the request id');
  }
  __resetAdaptersForTests();

  section('2. Reissued-session completion uses a key based on ITS OWN session id, not the request id (the R4 bug this section fixes) or the prior revoked session');
  {
    __setStorageForTests(fakeStorage);
    const fakeEmail = createFakeEmailSender('always_succeed');
    __setEmailForTests(fakeEmail);
    const request = await createTestRequest('under_review');

    const issued1 = await issueUploadSession(request.id);
    assert(issued1.kind === 'ok', 'first session issued');
    const session1Rows = await intakeQuery<{ id: string }>(`SELECT id FROM public_upload_sessions WHERE request_id = $1`, [request.id]);
    // Session 1 is revoked BEFORE the customer ever completes
    // anything -- the realistic scenario R5 §1 supports (a
    // replacement is needed because the original was never usable).
    // Finalizing session 1 first would move the request past
    // upload_invited entirely (by design, R3's own request-state
    // check), which is not what "replacement" means here.
    const revoked = await revokeUploadSession(request.id);
    assert(revoked.revoked === true, 'session 1 is revoked before completing anything');

    const issued2 = await issueUploadSession(request.id);
    assert(issued2.kind === 'ok', 'replacement session 2 issued');
    const session2Rows = await intakeQuery<{ id: string }>(
      `SELECT id FROM public_upload_sessions WHERE request_id = $1 AND status = 'active'`,
      [request.id]
    );
    assert(session2Rows[0].id !== session1Rows[0].id, 'session 2 is a genuinely different row from session 1');

    const rawToken2 = generateRawUploadToken();
    await intakeQuery(`UPDATE public_upload_sessions SET token_hash = $1 WHERE id = $2`, [tokenHash(rawToken2), session2Rows[0].id]);
    await completeOneFile(rawToken2, fakeStorage, 'session2-file.pdf');
    const finish2 = await finishUploadSession(rawToken2);
    assert(finish2.ok, 'session 2 (the replacement) finalizes successfully');

    const completionEmails = fakeEmail.sentMessages.filter((m) => m.idempotencyKey?.startsWith('upload-complete/'));
    assert(completionEmails.length === 1, 'exactly one upload-complete email was requested, for the replacement session');
    assert(completionEmails[0].idempotencyKey === `upload-complete/${session2Rows[0].id}`, "the key matches session 2's OWN id exactly");
    assert(completionEmails[0].idempotencyKey !== `upload-complete/${request.id}`, 'the key does NOT match the request id -- this is exactly the R4 bug this section fixes: before R5, this would have been upload-complete/<requestId>, identical regardless of which session actually completed');
    assert(completionEmails[0].idempotencyKey !== `upload-complete/${session1Rows[0].id}`, "the key does NOT match the REVOKED session 1's id either");
  }
  __resetAdaptersForTests();

  __resetAdaptersForTests();
  printSummaryAndExit();
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('gate2-email-idempotency-r5.qa.ts failed:', error);
  process.exitCode = 1;
});
