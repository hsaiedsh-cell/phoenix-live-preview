// ============================================================
// QA: Idempotent completion receipt (R7)
// PHX-LAUNCH-001-R7 Section 2 / Section 7 ("Completion receipt")
// EXECUTED against a real local Postgres instance. Storage is an
// injected fake adapter.
// ============================================================

import { randomUUID } from 'node:crypto';
import { assert, section, printSummaryAndExit } from './assert';
import { intakeQuery } from '../../src/lib/intake/db';
import * as intakeRequestsRepo from '../../src/lib/intake/repositories/intake-requests.repository';
import * as uploadSessionsRepo from '../../src/lib/intake/repositories/upload-sessions.repository';
import { generateRawUploadToken, tokenHash } from '../../src/lib/intake/hash';
import { signUploadObject, completeUploadObject } from '../../src/lib/intake/upload-flow.service';
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
     ) VALUES ('PHX-REQ-' || substr(md5(random()::text), 1, 12), 'assessment', 'R7Gate2', 'Tester',
       $1, 'Acme', 'CAIO', 'idempotent completion QA r7', true, $2, $3, false, now(), $4, null, 'upload_invited')
     RETURNING *`,
    [`r7gate2-${randomUUID()}@acme.example`, CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION, randomUUID()]
  ).then((rows) => rows[0]);
}

async function createSessionWithToken(requestId: string): Promise<string> {
  const rawToken = generateRawUploadToken();
  await uploadSessionsRepo.createUploadSession(requestId, tokenHash(rawToken));
  return rawToken;
}

async function main() {
  const fakeStorage = createFakeStorageAdapter();
  __setStorageForTests(fakeStorage);

  section('1. Lost completion response + retry returns success (active session)');
  {
    __setEmailForTests(createFakeEmailSender('always_succeed'));
    const request = await createTestRequest();
    const rawToken = await createSessionWithToken(request.id);
    const filename = `active-replay-${randomUUID()}.pdf`;
    const sign = await signUploadObject(rawToken, { filename, contentType: 'application/pdf', sizeBytes: 1000, reservationKey: randomUUID() });
    assert(sign.kind === 'ok', 'sign succeeds');
    if (sign.kind === 'ok') {
      fakeStorage.simulatedObjects.set(sign.storageObjectKey, { sizeBytes: 1000, contentType: 'application/pdf' });
      const first = await completeUploadObject(rawToken, { storageObjectKey: sign.storageObjectKey });
      assert(first.kind === 'ok' && first.replayed === false, 'first completion commits normally, not a replay');

      section('2. Completed reservation is not completed twice (repository state proof)');
      const rowsBefore = await intakeQuery<{ reservation_status: string; completed_at: Date }>(
        `SELECT reservation_status, completed_at FROM public_intake_files WHERE storage_object_key = $1`,
        [sign.storageObjectKey]
      );
      const originalCompletedAt = rowsBefore[0].completed_at;

      const retry = await completeUploadObject(rawToken, { storageObjectKey: sign.storageObjectKey });
      assert(retry.kind === 'ok' && retry.replayed === true, 'second identical completion returns a replay success, not a denial');
      if (retry.kind === 'ok' && first.kind === 'ok') {
        assert(retry.fileCount === first.fileCount, 'the file count is authoritative and identical across the replay');
      }

      const rowsAfter = await intakeQuery<{ reservation_status: string; completed_at: Date }>(
        `SELECT reservation_status, completed_at FROM public_intake_files WHERE storage_object_key = $1`,
        [sign.storageObjectKey]
      );
      assert(rowsAfter[0].reservation_status === 'completed', 'the row remains completed');
      assert(new Date(rowsAfter[0].completed_at).getTime() === new Date(originalCompletedAt).getTime(), 'completed_at is UNCHANGED by the replay -- the row was never re-written');
    }
  }

  section('3. Provider verification is called exactly once across a completion + replay');
  {
    __setEmailForTests(createFakeEmailSender('always_succeed'));
    const request = await createTestRequest();
    const rawToken = await createSessionWithToken(request.id);
    const filename = `verify-once-${randomUUID()}.pdf`;
    const sign = await signUploadObject(rawToken, { filename, contentType: 'application/pdf', sizeBytes: 1000, reservationKey: randomUUID() });
    assert(sign.kind === 'ok', 'sign succeeds');
    if (sign.kind === 'ok') {
      fakeStorage.simulatedObjects.set(sign.storageObjectKey, { sizeBytes: 1000, contentType: 'application/pdf' });
      const verifyCallsBefore = fakeStorage.verifyObjectExistsCalls?.length ?? 0;
      await completeUploadObject(rawToken, { storageObjectKey: sign.storageObjectKey });
      const verifyCallsAfterFirst = fakeStorage.verifyObjectExistsCalls?.length ?? 0;
      await completeUploadObject(rawToken, { storageObjectKey: sign.storageObjectKey });
      const verifyCallsAfterReplay = fakeStorage.verifyObjectExistsCalls?.length ?? 0;
      assert(
        verifyCallsAfterFirst - verifyCallsBefore === 1,
        `the first completion calls the provider's verifyObjectExists exactly once (delta ${verifyCallsAfterFirst - verifyCallsBefore})`
      );
      assert(
        verifyCallsAfterReplay === verifyCallsAfterFirst,
        'the replay calls verifyObjectExists ZERO additional times -- the idempotent-replay branch never touches the provider at all'
      );
    }
  }

  section('4. Completion event (upload.completion_verified) remains exactly once across a replay');
  {
    __setEmailForTests(createFakeEmailSender('always_succeed'));
    const request = await createTestRequest();
    const rawToken = await createSessionWithToken(request.id);
    const filename = `event-once-${randomUUID()}.pdf`;
    const sign = await signUploadObject(rawToken, { filename, contentType: 'application/pdf', sizeBytes: 1000, reservationKey: randomUUID() });
    assert(sign.kind === 'ok', 'sign succeeds');
    if (sign.kind === 'ok') {
      fakeStorage.simulatedObjects.set(sign.storageObjectKey, { sizeBytes: 1000, contentType: 'application/pdf' });
      await completeUploadObject(rawToken, { storageObjectKey: sign.storageObjectKey });
      await completeUploadObject(rawToken, { storageObjectKey: sign.storageObjectKey });
      const eventRows = await intakeQuery<{ count: string }>(
        `SELECT count(*) FROM public_intake_events WHERE request_id = $1 AND event_type = 'upload.completion_verified'`,
        [request.id]
      );
      assert(Number(eventRows[0].count) === 1, `upload.completion_verified was recorded exactly once despite two completion calls (got ${eventRows[0].count})`);
    }
  }

  section('5. No duplicate email on a completed retry (finalizing completion + replay)');
  {
    const fakeEmail = createFakeEmailSender('always_succeed');
    __setEmailForTests(fakeEmail);
    const request = await createTestRequest();
    const rawToken = await createSessionWithToken(request.id);
    const filename = `no-dup-email-${randomUUID()}.pdf`;
    const sign = await signUploadObject(rawToken, { filename, contentType: 'application/pdf', sizeBytes: 1000, reservationKey: randomUUID() });
    assert(sign.kind === 'ok', 'sign succeeds');
    if (sign.kind === 'ok') {
      fakeStorage.simulatedObjects.set(sign.storageObjectKey, { sizeBytes: 1000, contentType: 'application/pdf' });
      const first = await completeUploadObject(rawToken, { storageObjectKey: sign.storageObjectKey, finishSession: true });
      assert(first.kind === 'ok' && first.finalized === true, 'the single completion finalizes the session (one-file quota)');
      const completionEmailsAfterFirst = fakeEmail.sentMessages.filter((m) => m.idempotencyKey?.startsWith('upload-complete/')).length;

      const retry = await completeUploadObject(rawToken, { storageObjectKey: sign.storageObjectKey });
      assert(retry.kind === 'ok' && retry.replayed === true && retry.finalized === true, 'the retry against the now-finalized session reports an idempotent finalized replay');

      const completionEmailsAfterRetry = fakeEmail.sentMessages.filter((m) => m.idempotencyKey?.startsWith('upload-complete/')).length;
      assert(completionEmailsAfterRetry === completionEmailsAfterFirst, 'no additional upload-complete email was requested by the replay');
    }
  }

  section('6. Active-session replay reports the correct authoritative file count');
  {
    __setEmailForTests(createFakeEmailSender('always_succeed'));
    const request = await createTestRequest();
    const rawToken = await createSessionWithToken(request.id);
    const sign1 = await signUploadObject(rawToken, { filename: `two-files-a-${randomUUID()}.pdf`, contentType: 'application/pdf', sizeBytes: 500, reservationKey: randomUUID() });
    const sign2 = await signUploadObject(rawToken, { filename: `two-files-b-${randomUUID()}.pdf`, contentType: 'application/pdf', sizeBytes: 500, reservationKey: randomUUID() });
    assert(sign1.kind === 'ok' && sign2.kind === 'ok', 'both sign calls succeed');
    if (sign1.kind === 'ok' && sign2.kind === 'ok') {
      fakeStorage.simulatedObjects.set(sign1.storageObjectKey, { sizeBytes: 500, contentType: 'application/pdf' });
      fakeStorage.simulatedObjects.set(sign2.storageObjectKey, { sizeBytes: 500, contentType: 'application/pdf' });
      await completeUploadObject(rawToken, { storageObjectKey: sign1.storageObjectKey });
      await completeUploadObject(rawToken, { storageObjectKey: sign2.storageObjectKey });
      const replay = await completeUploadObject(rawToken, { storageObjectKey: sign1.storageObjectKey });
      assert(replay.kind === 'ok' && replay.replayed === true && replay.fileCount === 2, `the replay reports the authoritative count of BOTH completed files (got ${replay.kind === 'ok' ? replay.fileCount : 'n/a'})`);
    }
  }

  section('7. Finalized-session replay reports finalized:true (session already used/finalized)');
  {
    __setEmailForTests(createFakeEmailSender('always_succeed'));
    const request = await createTestRequest();
    const rawToken = await createSessionWithToken(request.id);
    const sign = await signUploadObject(rawToken, { filename: `finalized-replay-${randomUUID()}.pdf`, contentType: 'application/pdf', sizeBytes: 1000, reservationKey: randomUUID() });
    assert(sign.kind === 'ok', 'sign succeeds');
    if (sign.kind === 'ok') {
      fakeStorage.simulatedObjects.set(sign.storageObjectKey, { sizeBytes: 1000, contentType: 'application/pdf' });
      const complete = await completeUploadObject(rawToken, { storageObjectKey: sign.storageObjectKey, finishSession: true });
      assert(complete.kind === 'ok' && complete.finalized === true, 'the completion, combined with an explicit finishSession request, finalizes the session');

      const replay = await completeUploadObject(rawToken, { storageObjectKey: sign.storageObjectKey });
      assert(replay.kind === 'ok' && replay.replayed === true && replay.finalized === true, 'a completion retry against a session already finalized/used reports both replayed:true and finalized:true');
    }
  }

  __resetAdaptersForTests();
  printSummaryAndExit();
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('gate2-completion-receipt-r7.qa.ts failed:', error);
  process.exitCode = 1;
});
