// ============================================================
// QA: Idempotent finish receipt (R7)
// PHX-LAUNCH-001-R7 Section 3 / Section 7 ("Finish receipt")
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
import { __setStorageForTests, __setEmailForTests, __resetAdaptersForTests } from '../../src/lib/intake/adapters';
import { createFakeStorageAdapter } from '../../src/lib/intake/adapters/storage.adapter';
import { createFakeEmailSender } from '../../src/lib/intake/adapters/email.adapter';
import { CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION } from '../../src/lib/intake/config';

async function createTestRequest(): Promise<intakeRequestsRepo.IntakeRequestRow> {
  return intakeQuery<intakeRequestsRepo.IntakeRequestRow>(
    `INSERT INTO public_intake_requests (
       public_reference, request_type, first_name, last_name, work_email_normalized,
       company, role, message, privacy_consent, privacy_version, terms_version,
       marketing_consent, consent_timestamp, idempotency_key_hash, ip_hash, status
     ) VALUES ('PHX-REQ-' || substr(md5(random()::text), 1, 12), 'assessment', 'R7Gate3', 'Tester',
       $1, 'Acme', 'CAIO', 'idempotent finish QA r7', true, $2, $3, false, now(), $4, null, 'upload_invited')
     RETURNING *`,
    [`r7gate3-${randomUUID()}@acme.example`, CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION, randomUUID()]
  ).then((rows) => rows[0]);
}

async function createSessionWithToken(requestId: string): Promise<string> {
  const rawToken = generateRawUploadToken();
  await uploadSessionsRepo.createUploadSession(requestId, tokenHash(rawToken));
  return rawToken;
}

const fakeStorage = createFakeStorageAdapter();

async function main() {
  __setStorageForTests(fakeStorage);

  section('1. First finish finalizes normally; lost response + retry returns success');
  {
    __setEmailForTests(createFakeEmailSender('always_succeed'));
    const request = await createTestRequest();
    const rawToken = await createSessionWithToken(request.id);
    const sign = await signUploadObject(rawToken, { filename: `finish-lost-${randomUUID()}.pdf`, contentType: 'application/pdf', sizeBytes: 1000, reservationKey: randomUUID() });
    assert(sign.kind === 'ok', 'sign succeeds');
    if (sign.kind === 'ok') {
      fakeStorage.simulatedObjects.set(sign.storageObjectKey, { sizeBytes: 1000, contentType: 'application/pdf' });
      await completeUploadObject(rawToken, { storageObjectKey: sign.storageObjectKey });
    }
    const first = await finishUploadSession(rawToken);
    assert(first.ok === true && first.alreadyFinalized === false, 'first finish finalizes normally, not reported as a replay');

    const retry = await finishUploadSession(rawToken);
    assert(retry.ok === true && retry.alreadyFinalized === true, 'retry (simulating a lost first response) returns an idempotent already-finalized success receipt');
    assert(retry.fileCount === first.fileCount, 'the authoritative file count matches across the replay');
  }

  section('2. Session finalization event (upload.session_finalized) remains exactly once');
  {
    __setEmailForTests(createFakeEmailSender('always_succeed'));
    const request = await createTestRequest();
    const rawToken = await createSessionWithToken(request.id);
    const sign = await signUploadObject(rawToken, { filename: `event-once-${randomUUID()}.pdf`, contentType: 'application/pdf', sizeBytes: 1000, reservationKey: randomUUID() });
    assert(sign.kind === 'ok', 'sign succeeds');
    if (sign.kind === 'ok') {
      fakeStorage.simulatedObjects.set(sign.storageObjectKey, { sizeBytes: 1000, contentType: 'application/pdf' });
      await completeUploadObject(rawToken, { storageObjectKey: sign.storageObjectKey });
    }
    await finishUploadSession(rawToken);
    await finishUploadSession(rawToken);
    await finishUploadSession(rawToken);

    const finalizedEvents = await intakeQuery<{ count: string }>(
      `SELECT count(*) FROM public_intake_events WHERE request_id = $1 AND event_type = 'upload.session_finalized'`,
      [request.id]
    );
    assert(Number(finalizedEvents[0].count) === 1, `upload.session_finalized was recorded exactly once despite three finish calls (got ${finalizedEvents[0].count})`);
  }

  section('3. Request files_received event remains exactly once');
  {
    __setEmailForTests(createFakeEmailSender('always_succeed'));
    const request = await createTestRequest();
    const rawToken = await createSessionWithToken(request.id);
    const sign = await signUploadObject(rawToken, { filename: `files-received-once-${randomUUID()}.pdf`, contentType: 'application/pdf', sizeBytes: 1000, reservationKey: randomUUID() });
    assert(sign.kind === 'ok', 'sign succeeds');
    if (sign.kind === 'ok') {
      fakeStorage.simulatedObjects.set(sign.storageObjectKey, { sizeBytes: 1000, contentType: 'application/pdf' });
      await completeUploadObject(rawToken, { storageObjectKey: sign.storageObjectKey });
    }
    await finishUploadSession(rawToken);
    await finishUploadSession(rawToken);

    const filesReceivedEvents = await intakeQuery<{ count: string }>(
      `SELECT count(*) FROM public_intake_events WHERE request_id = $1 AND event_type = 'request.files_received'`,
      [request.id]
    );
    assert(Number(filesReceivedEvents[0].count) === 1, `request.files_received was recorded exactly once despite two finish calls (got ${filesReceivedEvents[0].count})`);

    const requestRow = await intakeRequestsRepo.findById(request.id);
    assert(requestRow?.status === 'files_received', 'the request genuinely transitioned exactly once');
  }

  section('4. Upload-complete email remains exactly once across repeated finish calls');
  {
    const fakeEmail = createFakeEmailSender('always_succeed');
    __setEmailForTests(fakeEmail);
    const request = await createTestRequest();
    const rawToken = await createSessionWithToken(request.id);
    const sign = await signUploadObject(rawToken, { filename: `email-once-${randomUUID()}.pdf`, contentType: 'application/pdf', sizeBytes: 1000, reservationKey: randomUUID() });
    assert(sign.kind === 'ok', 'sign succeeds');
    if (sign.kind === 'ok') {
      fakeStorage.simulatedObjects.set(sign.storageObjectKey, { sizeBytes: 1000, contentType: 'application/pdf' });
      await completeUploadObject(rawToken, { storageObjectKey: sign.storageObjectKey });
    }
    await finishUploadSession(rawToken);
    await finishUploadSession(rawToken);
    await finishUploadSession(rawToken);

    const completionEmails = fakeEmail.sentMessages.filter((m) => m.idempotencyKey?.startsWith('upload-complete/'));
    assert(completionEmails.length === 1, `exactly one upload-complete email was requested despite three finish calls (got ${completionEmails.length})`);
  }

  section('5. Revoked/expired/random token still denied, never treated as an idempotent finalized replay');
  {
    __setEmailForTests(createFakeEmailSender('always_succeed'));

    const randomTokenOutcome = await finishUploadSession(generateRawUploadToken());
    assert(randomTokenOutcome.ok === false, 'a random, never-issued token is denied');

    const revokedRequest = await createTestRequest();
    const revokedToken = await createSessionWithToken(revokedRequest.id);
    const revokedSessionRows = await intakeQuery<{ id: string }>(`SELECT id FROM public_upload_sessions WHERE request_id = $1`, [revokedRequest.id]);
    await intakeQuery(`UPDATE public_upload_sessions SET status = 'revoked', revoked_at = now() WHERE id = $1`, [revokedSessionRows[0].id]);
    const revokedOutcome = await finishUploadSession(revokedToken);
    assert(revokedOutcome.ok === false, 'a revoked (never-finalized) session is denied, not treated as an idempotent replay');

    const expiredRequest = await createTestRequest();
    const expiredToken = await createSessionWithToken(expiredRequest.id);
    const expiredSessionRows = await intakeQuery<{ id: string }>(`SELECT id FROM public_upload_sessions WHERE request_id = $1`, [expiredRequest.id]);
    await intakeQuery(`UPDATE public_upload_sessions SET expires_at = now() - interval '1 second' WHERE id = $1`, [expiredSessionRows[0].id]);
    const expiredOutcome = await finishUploadSession(expiredToken);
    assert(expiredOutcome.ok === false, 'an expired (never-finalized) session is denied, not treated as an idempotent replay');
  }

  __resetAdaptersForTests();
  printSummaryAndExit();
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('gate3-finish-receipt-r7.qa.ts failed:', error);
  process.exitCode = 1;
});
