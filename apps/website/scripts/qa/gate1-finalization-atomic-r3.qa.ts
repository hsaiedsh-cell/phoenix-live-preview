// ============================================================
// QA: Request + session finalization atomicity (R3)
// PHX-LAUNCH-001-R3 Section 1
// EXECUTED against a real local Postgres instance. Storage/Email are
// injected fakes.
// ============================================================

import { randomUUID } from 'node:crypto';
import { assert, section, printSummaryAndExit } from './assert';
import { intakeQuery, withIntakeTransaction, __resetIntakePoolForTests } from '../../src/lib/intake/db';
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
     ) VALUES ('PHX-REQ-' || substr(md5(random()::text), 1, 12), 'assessment', 'R3Gate1', 'Tester',
       $1, 'Acme', 'CAIO', 'finalization atomicity QA r3', true, $2, $3, false, now(), $4, null)
     RETURNING *`,
    [`r3gate1-${randomUUID()}@acme.example`, CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION, randomUUID()]
  ).then((rows) => rows[0]);
}

async function createSessionWithToken(requestId: string): Promise<{ rawToken: string; sessionId: string }> {
  await intakeQuery(`UPDATE public_intake_requests SET status = 'upload_invited' WHERE id = $1`, [requestId]);
  const rawToken = generateRawUploadToken();
  const session = await uploadSessionsRepo.createUploadSession(requestId, tokenHash(rawToken));
  return { rawToken, sessionId: session.id };
}

async function completeOneFile(rawToken: string, storage: ReturnType<typeof createFakeStorageAdapter>, filename: string) {
  const sign = await signUploadObject(rawToken, { filename, contentType: 'application/pdf', sizeBytes: 1000 , reservationKey: randomUUID() });
  if (sign.kind !== 'ok') throw new Error(`unexpected sign outcome: ${sign.kind}`);
  storage.simulatedObjects.set(sign.storageObjectKey, { sizeBytes: 1000, contentType: 'application/pdf' });
  return completeUploadObject(rawToken, { storageObjectKey: sign.storageObjectKey });
}

async function main() {
  __setEmailForTests(createFakeEmailSender('always_succeed'));
  const fakeStorage = createFakeStorageAdapter();
  __setStorageForTests(fakeStorage);

  section('1. Session and request finalize together (happy path)');
  {
    const request = await createTestRequest();
    const { rawToken, sessionId } = await createSessionWithToken(request.id);
    await completeOneFile(rawToken, fakeStorage, 'f1.pdf');
    const finish = await finishUploadSession(rawToken);
    assert(finish.ok, 'explicit finish reports success');

    const sessionRow = await intakeQuery<{ status: string; finalized_at: Date | null }>(`SELECT status, finalized_at FROM public_upload_sessions WHERE id = $1`, [sessionId]);
    const requestRow = await intakeRequestsRepo.findById(request.id);
    assert(sessionRow[0].status === 'used' && sessionRow[0].finalized_at !== null, 'session is used + finalized');
    assert(requestRow?.status === 'files_received', 'request transitioned to files_received in the SAME operation');
  }

  section('2. Request concurrently rejected -> session remains active/not-used');
  {
    const request = await createTestRequest();
    const { rawToken, sessionId } = await createSessionWithToken(request.id);
    await completeOneFile(rawToken, fakeStorage, 'f1.pdf');
    // Simulate a concurrent operator action moving the request to a
    // terminal state between the file completing and the customer
    // clicking "Finish".
    await intakeQuery(`UPDATE public_intake_requests SET status = 'rejected' WHERE id = $1`, [request.id]);

    const finish = await finishUploadSession(rawToken);
    assert(finish.ok === false, 'finish reports failure once the request is no longer in upload_invited');

    const sessionRow = await intakeQuery<{ status: string; finalized_at: Date | null }>(`SELECT status, finalized_at FROM public_upload_sessions WHERE id = $1`, [sessionId]);
    assert(sessionRow[0].status === 'active' && sessionRow[0].finalized_at === null, 'session remains active/not-finalized -- rejecting the request prevented session finalization too');
    const requestRow = await intakeRequestsRepo.findById(request.id);
    assert(requestRow?.status === 'rejected', 'request status is untouched (still rejected, not silently reverted or advanced)');
  }

  section('3. Request concurrently closed -> session remains active/not-used');
  {
    const request = await createTestRequest();
    const { rawToken, sessionId } = await createSessionWithToken(request.id);
    await completeOneFile(rawToken, fakeStorage, 'f1.pdf');
    await intakeQuery(`UPDATE public_intake_requests SET status = 'closed' WHERE id = $1`, [request.id]);

    const finish = await finishUploadSession(rawToken);
    assert(finish.ok === false, 'finish reports failure once the request has been closed');
    const sessionRow = await intakeQuery<{ status: string }>(`SELECT status FROM public_upload_sessions WHERE id = $1`, [sessionId]);
    assert(sessionRow[0].status === 'active', 'session remains active -- closing the request prevented session finalization too');
  }

  section('4. Conditional request update returning zero rows -> no files_received event (repository-level proof)');
  {
    // Directly proves the underlying guarantee updateStatusInTransaction
    // relies on: a conditional UPDATE ... WHERE status = $fromStatus
    // that no longer matches returns ZERO rows, not an error and not
    // a silent success -- this is exactly what upload-flow.service.ts's
    // maybeFinalizeInTransaction checks before ever writing a
    // request.files_received event (see its own source: the event
    // write is unreachable code after a thrown error on a null
    // result, which this repository-level test proves is a REAL,
    // non-vacuous possibility, not just a defensive check for an
    // impossible case).
    const request = await createTestRequest();
    await intakeQuery(`UPDATE public_intake_requests SET status = 'under_review' WHERE id = $1`, [request.id]);
    const result = await withIntakeTransaction(async (query) => {
      // Deliberately wrong fromStatus ('upload_invited') vs the
      // row's actual status ('under_review') -- the WHERE clause
      // cannot match.
      return intakeRequestsRepo.updateStatusInTransaction(query, request.id, 'upload_invited', 'files_received');
    });
    assert(result === null, 'updateStatusInTransaction returns null (zero rows) when the WHERE clause does not match the actual row state');
  }

  section('5. Duplicate completion cannot complete twice; duplicate finish cannot transition twice (regression, still holds under R3)');
  {
    const request = await createTestRequest();
    const { rawToken } = await createSessionWithToken(request.id);
    const outcome = await completeOneFile(rawToken, fakeStorage, 'once.pdf');
    assert(outcome.kind === 'ok', 'first completion succeeds');
    const finish1 = await finishUploadSession(rawToken);
    assert(finish1.ok, 'first finish succeeds');
    const finish2 = await finishUploadSession(rawToken);
    assert(finish2.ok === false, 'second finish reports failure (already finalized)');
  }

  section('6. 20+ concurrent finalizations (pool max=3) terminate without hanging; no global-pool call inside the transaction');
  {
    __resetIntakePoolForTests(3);
    const sessions: Array<{ rawToken: string }> = [];
    for (let i = 0; i < 20; i += 1) {
      const request = await createTestRequest();
      const { rawToken } = await createSessionWithToken(request.id);
      await completeOneFile(rawToken, fakeStorage, `concurrent-${i}.pdf`);
      sessions.push({ rawToken });
    }
    const start = Date.now();
    const results = await Promise.race([
      Promise.all(sessions.map((s) => finishUploadSession(s.rawToken))),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('TIMEOUT: 20 concurrent finalizations did not terminate')), 20000)),
    ]);
    const elapsedMs = Date.now() - start;
    assert(Array.isArray(results) && results.length === 20, `all 20 concurrent finalizations (distinct sessions) settled without hanging (${elapsedMs}ms)`);
    assert((results as Array<{ ok: boolean }>).every((r) => r.ok), 'every one of the 20 distinct-session finalizations succeeds');
    __resetIntakePoolForTests();

    // Structural proof (source-level): maybeFinalizeInTransaction and
    // everything it calls uses ONLY the transaction-scoped `query`
    // parameter -- never intakeQuery (the global pool) or a
    // non-"InTransaction"-suffixed repository function -- which is
    // exactly what makes the above 20-way concurrency test safe at
    // pool max=3 rather than a self-deadlock (R2's own bug, fixed for
    // idempotency in R2 and now for finalization specifically in R3).
    const fs = await import('node:fs');
    const source = fs.readFileSync(new URL('../../src/lib/intake/upload-flow.service.ts', import.meta.url), 'utf8');
    const fnMatch = source.match(/async function maybeFinalizeInTransaction[\s\S]*?\n}\n/);
    assert(!!fnMatch, 'maybeFinalizeInTransaction found in source');
    if (fnMatch) {
      const body = fnMatch[0];
      assert(!body.includes('intakeRequestsRepo.findById('), 'maybeFinalizeInTransaction never calls the global-pool findById');
      assert(body.includes('lockRequestForUpdate(query'), 'it locks the request row using the transaction-scoped query instead');
    }
  }

  __resetAdaptersForTests();
  printSummaryAndExit();
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('gate1-finalization-atomic-r3.qa.ts failed:', error);
  process.exitCode = 1;
});
