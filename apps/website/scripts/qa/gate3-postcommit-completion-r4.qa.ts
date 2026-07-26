// ============================================================
// QA: No post-commit query required for a successful completion
// response (R4)
// PHX-LAUNCH-001-R4 Section 3
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
       marketing_consent, consent_timestamp, idempotency_key_hash, ip_hash
     ) VALUES ('PHX-REQ-' || substr(md5(random()::text), 1, 12), 'assessment', 'R4Gate3', 'Tester',
       $1, 'Acme', 'CAIO', 'post-commit completion QA r4', true, $2, $3, false, now(), $4, null)
     RETURNING *`,
    [`r4gate3-${randomUUID()}@acme.example`, CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION, randomUUID()]
  ).then((rows) => rows[0]);
}

async function createSessionWithToken(requestId: string): Promise<{ rawToken: string; sessionId: string }> {
  await intakeQuery(`UPDATE public_intake_requests SET status = 'upload_invited' WHERE id = $1`, [requestId]);
  const rawToken = generateRawUploadToken();
  const session = await uploadSessionsRepo.createUploadSession(requestId, tokenHash(rawToken));
  return { rawToken, sessionId: session.id };
}

async function main() {
  __setEmailForTests(createFakeEmailSender('always_succeed'));
  const fakeStorage = createFakeStorageAdapter();
  __setStorageForTests(fakeStorage);

  section('1. Structural: the POST-TRANSACTION segment of completeUploadObject/finishUploadSession issues no redundant countCompletedForSession query');
  {
    const fs = await import('node:fs');
    const source = fs.readFileSync(new URL('../../src/lib/intake/upload-flow.service.ts', import.meta.url), 'utf8');
    const completeFnMatch = source.match(/export async function completeUploadObject[\s\S]*?\n}\n\nexport type FinishUploadSessionOutcome/);
    const finishFnMatch = source.match(/export async function finishUploadSession[\s\S]*?\n}\n\nexport type CancelReservationOutcome/);
    assert(!!completeFnMatch, 'completeUploadObject found in source');
    assert(!!finishFnMatch, 'finishUploadSession found in source');
    // R7 (§2/§3): both functions now legitimately call
    // countCompletedForSession in their PRE-transaction idempotent-
    // replay branches (there is no transaction to carry a count out
    // of when nothing new is being written at all) -- what still must
    // never happen is a query issued AFTER the transaction that
    // actually performs a state-changing commit, which is the
    // specific redundant-query failure mode R4 fixed. Isolate just
    // the segment from the transaction call onward to prove that.
    if (completeFnMatch) {
      const postTransactionSegment = completeFnMatch[0].split('const result = await withIntakeTransaction(')[1] ?? '';
      assert(postTransactionSegment.length > 0, 'the transaction call was found inside completeUploadObject');
      assert(!postTransactionSegment.includes('intakeFilesRepo.countCompletedForSession('), 'the code that runs AFTER the state-changing transaction never calls the global-pool countCompletedForSession');
    }
    if (finishFnMatch) {
      const postTransactionSegment = finishFnMatch[0].split('const result = await withIntakeTransaction(')[1] ?? '';
      assert(postTransactionSegment.length > 0, 'the transaction call was found inside finishUploadSession');
      assert(!postTransactionSegment.includes('intakeFilesRepo.countCompletedForSession('), 'the code that runs AFTER the state-changing transaction never calls the global-pool countCompletedForSession either');
    }
    const finalizeFnMatch = source.match(/async function maybeFinalizeInTransaction[\s\S]*?\n}\n/);
    assert(!!finalizeFnMatch, 'maybeFinalizeInTransaction found in source');
    if (finalizeFnMatch) {
      assert(/return \{ kind: 'not_finalized', completedCount \}/.test(finalizeFnMatch[0]), 'the not_finalized branch returns completedCount too (not just the finalized branch)');
      assert(/return \{\s*kind: 'finalized'[\s\S]*?completedCount,?\s*\}/.test(finalizeFnMatch[0]), 'the finalized branch returns completedCount computed inside the same transaction');
    }
  }

  section('2. Completion response count equals the count inside the committing transaction');
  {
    const request = await createTestRequest();
    const { rawToken, sessionId } = await createSessionWithToken(request.id);
    const sign = await signUploadObject(rawToken, { filename: 'count-check.pdf', contentType: 'application/pdf', sizeBytes: 1000 , reservationKey: randomUUID() });
    assert(sign.kind === 'ok', 'sign succeeds');
    if (sign.kind === 'ok') {
      fakeStorage.simulatedObjects.set(sign.storageObjectKey, { sizeBytes: 1000, contentType: 'application/pdf' });
      const complete = await completeUploadObject(rawToken, { storageObjectKey: sign.storageObjectKey });
      assert(complete.kind === 'ok', 'completion succeeds');
      if (complete.kind === 'ok') {
        const dbCount = await intakeQuery<{ cnt: string }>(`SELECT count(*) AS cnt FROM public_intake_files WHERE upload_session_id = $1 AND reservation_status = 'completed'`, [sessionId]);
        assert(complete.fileCount === Number(dbCount[0].cnt), `the response's fileCount (${complete.fileCount}) matches the actual committed count in the database (${dbCount[0].cnt})`);
      }
    }
  }

  section('3. Finish response count equals the count inside the committing transaction');
  {
    const request = await createTestRequest();
    const { rawToken, sessionId } = await createSessionWithToken(request.id);
    const sign1 = await signUploadObject(rawToken, { filename: 'f1.pdf', contentType: 'application/pdf', sizeBytes: 500 , reservationKey: randomUUID() });
    const sign2 = await signUploadObject(rawToken, { filename: 'f2.pdf', contentType: 'application/pdf', sizeBytes: 500 , reservationKey: randomUUID() });
    if (sign1.kind === 'ok' && sign2.kind === 'ok') {
      fakeStorage.simulatedObjects.set(sign1.storageObjectKey, { sizeBytes: 500, contentType: 'application/pdf' });
      fakeStorage.simulatedObjects.set(sign2.storageObjectKey, { sizeBytes: 500, contentType: 'application/pdf' });
      await completeUploadObject(rawToken, { storageObjectKey: sign1.storageObjectKey });
      await completeUploadObject(rawToken, { storageObjectKey: sign2.storageObjectKey });
      const finish = await finishUploadSession(rawToken);
      assert(finish.ok, 'finish succeeds');
      const dbCount = await intakeQuery<{ cnt: string }>(`SELECT count(*) AS cnt FROM public_intake_files WHERE upload_session_id = $1 AND reservation_status = 'completed'`, [sessionId]);
      assert(finish.fileCount === Number(dbCount[0].cnt), `finish's fileCount (${finish.fileCount}) matches the actual committed count in the database (${dbCount[0].cnt})`);
      assert(finish.fileCount === 2, 'both completed files are counted');
    }
  }

  section('4. Post-commit pool/query failure cannot turn a committed completion into HTTP 500 (behavioral proof)');
  {
    // The strongest available proof without monkey-patching an ESM
    // module's live bindings (not possible from an external script):
    // completeUploadObject/finishUploadSession's only database
    // access AFTER their core transaction commits is the (already
    // proven, R3) never-throwing sendUploadCompleteNotification path
    // -- there is no OTHER post-commit query in either function
    // (confirmed structurally in section 1 above). Therefore, ANY
    // failure that could occur after commit is already routed through
    // a call proven not to throw; this test proves the full,
    // realistic end-to-end flow still returns 'ok' even when that
    // post-commit notification's underlying email send always fails.
    __setEmailForTests(createFakeEmailSender('always_fail'));
    const request = await createTestRequest();
    const { rawToken } = await createSessionWithToken(request.id);
    const sign = await signUploadObject(rawToken, { filename: 'postcommit-proof.pdf', contentType: 'application/pdf', sizeBytes: 1000 , reservationKey: randomUUID() });
    assert(sign.kind === 'ok', 'sign succeeds');
    if (sign.kind === 'ok') {
      fakeStorage.simulatedObjects.set(sign.storageObjectKey, { sizeBytes: 1000, contentType: 'application/pdf' });
      const complete = await completeUploadObject(rawToken, { storageObjectKey: sign.storageObjectKey, finishSession: true });
      assert(complete.kind === 'ok', 'the response is still a genuine success even though every post-commit step (email + its event) fails');
      assert(complete.kind === 'ok' && complete.finalized === true, 'finalization still genuinely happened');
    }
    __setEmailForTests(createFakeEmailSender('always_succeed'));
  }

  __resetAdaptersForTests();
  printSummaryAndExit();
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('gate3-postcommit-completion-r4.qa.ts failed:', error);
  process.exitCode = 1;
});
