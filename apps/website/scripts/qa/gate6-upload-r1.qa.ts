// ============================================================
// QA: Gate 6 -- Upload security, R1 reservation model
// PHX-LAUNCH-001-R1 §1
// EXECUTED against a real local Postgres instance. Storage is an
// injected fake adapter -- no hosted Supabase project or credentials
// are used or required. Live Supabase Storage validation is NOT
// claimed here.
// ============================================================

import { randomUUID } from 'node:crypto';
import { assert, section, printSummaryAndExit } from './assert';
import { intakeQuery } from '../../src/lib/intake/db';
import * as intakeRequestsRepo from '../../src/lib/intake/repositories/intake-requests.repository';
import * as uploadSessionsRepo from '../../src/lib/intake/repositories/upload-sessions.repository';
import * as intakeFilesRepo from '../../src/lib/intake/repositories/intake-files.repository';
import { generateRawUploadToken, tokenHash } from '../../src/lib/intake/hash';
import { checkUploadToken, signUploadObject, completeUploadObject, finishUploadSession } from '../../src/lib/intake/upload-flow.service';
import { __setStorageForTests, __setEmailForTests, __resetAdaptersForTests } from '../../src/lib/intake/adapters';
import { createFakeStorageAdapter, type StorageAdapter } from '../../src/lib/intake/adapters/storage.adapter';
import { createFakeEmailSender } from '../../src/lib/intake/adapters/email.adapter';
import { CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION } from '../../src/lib/intake/config';

async function createTestRequest(): Promise<intakeRequestsRepo.IntakeRequestRow> {
  return intakeQuery<intakeRequestsRepo.IntakeRequestRow>(
    `INSERT INTO public_intake_requests (
       public_reference, request_type, first_name, last_name, work_email_normalized,
       company, role, message, privacy_consent, privacy_version, terms_version,
       marketing_consent, consent_timestamp, idempotency_key_hash, ip_hash
     ) VALUES ('PHX-REQ-' || substr(md5(random()::text), 1, 12), 'assessment', 'Gate6R1', 'Tester',
       $1, 'Acme', 'CAIO', 'upload security QA r1', true, $2, $3, false, now(), $4, null)
     RETURNING *`,
    [`gate6r1-${randomUUID()}@acme.example`, CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION, randomUUID()]
  ).then((rows) => rows[0]);
}

async function createSessionWithToken(requestId: string): Promise<{ rawToken: string; sessionId: string }> {
  // Match the real flow's precondition: an upload session only ever
  // exists once the request has already moved to 'upload_invited'
  // (see upload-session.service.ts). Setting this directly via SQL
  // here is test setup, not a shortcut in application code -- the
  // real transition path (received -> under_review -> upload_invited)
  // is covered by other QA/finalize-service tests, not this file's
  // concern.
  await intakeQuery(`UPDATE public_intake_requests SET status = 'upload_invited' WHERE id = $1`, [requestId]);
  const rawToken = generateRawUploadToken();
  const session = await uploadSessionsRepo.createUploadSession(requestId, tokenHash(rawToken));
  return { rawToken, sessionId: session.id };
}

async function main() {
  __setEmailForTests(createFakeEmailSender('always_succeed'));

  section('1. Token validity (unchanged behavior, reservation model does not affect this layer)');
  const fakeStorage = createFakeStorageAdapter();
  __setStorageForTests(fakeStorage);
  const anonOutcome = await checkUploadToken('never-issued-token-xyz');
  assert(anonOutcome.kind === 'denied' && anonOutcome.reason === 'invalid', 'a never-issued token is denied');

  section('2. R1 §1.2: parallel sign requests never exceed 5 reservations (concurrency proof)');
  {
    const request = await createTestRequest();
    const { rawToken } = await createSessionWithToken(request.id);
    const signResults = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        signUploadObject(rawToken, { filename: `concurrent-${i}.pdf`, contentType: 'application/pdf', sizeBytes: 1000 })
      )
    );
    const accepted = signResults.filter((r) => r.kind === 'ok');
    const rejected = signResults.filter((r) => r.kind === 'rejected' && r.reason === 'file_count_exceeded');
    assert(accepted.length === 5, `exactly 5 of 8 truly concurrent sign requests are accepted (got ${accepted.length})`);
    assert(rejected.length === 3, `the other 3 are rejected as file_count_exceeded (got ${rejected.length})`);
    const dbRows = await intakeQuery<{ count: string }>(
      `SELECT count(*) FROM public_intake_files WHERE upload_session_id = (SELECT id FROM public_upload_sessions WHERE token_hash = $1) AND reservation_status IN ('reserved','completed')`,
      [tokenHash(rawToken)]
    );
    assert(Number(dbRows[0].count) === 5, `the database itself has exactly 5 non-failed reservations for this session (got ${dbRows[0].count})`);
  }

  section('3. R1 §1.2: parallel sign requests never exceed 60MB total (concurrency proof)');
  {
    const request = await createTestRequest();
    const { rawToken } = await createSessionWithToken(request.id);
    // 4 concurrent requests of 20MB each = 80MB if all accepted;
    // only 3 fit under the 60MB budget (60MB exactly, boundary
    // allowed), the 4th must be rejected.
    const twentyMb = 20 * 1024 * 1024;
    const results = await Promise.all(
      Array.from({ length: 4 }, (_, i) =>
        signUploadObject(rawToken, { filename: `big-${i}.pdf`, contentType: 'application/pdf', sizeBytes: twentyMb })
      )
    );
    const accepted = results.filter((r) => r.kind === 'ok');
    const rejectedTotal = results.filter((r) => r.kind === 'rejected' && r.reason === 'total_size_exceeded');
    assert(accepted.length === 3, `exactly 3 of 4 concurrent 20MB sign requests are accepted (60MB budget, got ${accepted.length})`);
    assert(rejectedTotal.length === 1, `the 4th is rejected as total_size_exceeded (got ${rejectedTotal.length})`);
  }

  section('4. R1 §1.1: reservation is bound to one session; foreign-session/unknown-key completion denied');
  {
    const requestA = await createTestRequest();
    const { rawToken: tokenA } = await createSessionWithToken(requestA.id);
    const requestB = await createTestRequest();
    const { rawToken: tokenB } = await createSessionWithToken(requestB.id);

    const signA = await signUploadObject(tokenA, { filename: 'a.pdf', contentType: 'application/pdf', sizeBytes: 1000 });
    assert(signA.kind === 'ok', 'session A successfully reserves an object');

    if (signA.kind === 'ok') {
      fakeStorage.simulatedObjects.set(signA.storageObjectKey, { sizeBytes: 1000, contentType: 'application/pdf' });
      // Attempt to complete session A's object key using session B's token.
      const crossComplete = await completeUploadObject(tokenB, { storageObjectKey: signA.storageObjectKey });
      assert(
        crossComplete.kind === 'completion_denied' && crossComplete.reason === 'foreign_session',
        'completing session A\'s object key with session B\'s token is denied as foreign_session'
      );
    }

    const unknownKeyComplete = await completeUploadObject(tokenA, { storageObjectKey: 'never-reserved-key-xyz' });
    assert(
      unknownKeyComplete.kind === 'completion_denied' && unknownKeyComplete.reason === 'unknown_object_key',
      'completing a never-reserved object key is denied as unknown_object_key'
    );
  }

  section('5. R1 §1.1: already-completed object cannot complete twice');
  {
    const request = await createTestRequest();
    const { rawToken } = await createSessionWithToken(request.id);
    const sign = await signUploadObject(rawToken, { filename: 'once.pdf', contentType: 'application/pdf', sizeBytes: 1000 });
    assert(sign.kind === 'ok', 'sign succeeds');
    if (sign.kind === 'ok') {
      fakeStorage.simulatedObjects.set(sign.storageObjectKey, { sizeBytes: 1000, contentType: 'application/pdf' });
      const first = await completeUploadObject(rawToken, { storageObjectKey: sign.storageObjectKey });
      assert(first.kind === 'ok', 'first completion succeeds');
      const second = await completeUploadObject(rawToken, { storageObjectKey: sign.storageObjectKey });
      assert(
        second.kind === 'completion_denied' && second.reason === 'not_reserved',
        'a second completion attempt for the SAME object key is denied (cannot complete twice)'
      );
    }
  }

  section('6. R1 §1.3: completion content type comes from provider metadata; provider MIME mismatch denied');
  {
    const request = await createTestRequest();
    const { rawToken } = await createSessionWithToken(request.id);
    const sign = await signUploadObject(rawToken, { filename: 'claim.pdf', contentType: 'application/pdf', sizeBytes: 1000 });
    assert(sign.kind === 'ok', 'sign with declared application/pdf succeeds');
    if (sign.kind === 'ok') {
      // Simulate the provider observing a DIFFERENT actual content
      // type than what was declared at sign time (e.g. a renamed
      // file whose real bytes are something else).
      fakeStorage.simulatedObjects.set(sign.storageObjectKey, { sizeBytes: 1000, contentType: 'image/png' });
      const outcome = await completeUploadObject(rawToken, { storageObjectKey: sign.storageObjectKey });
      assert(
        outcome.kind === 'completion_denied' && outcome.reason === 'metadata_mismatch',
        'provider-observed content type (image/png) differing from declared (application/pdf) is denied as metadata_mismatch'
      );
    }
  }

  section('7. R1 §1.3: declared/actual size mismatch is denied');
  {
    const request = await createTestRequest();
    const { rawToken } = await createSessionWithToken(request.id);
    const sign = await signUploadObject(rawToken, { filename: 'sizecheck.pdf', contentType: 'application/pdf', sizeBytes: 1000 });
    assert(sign.kind === 'ok', 'sign succeeds');
    if (sign.kind === 'ok') {
      // Provider reports a DIFFERENT size than declared.
      fakeStorage.simulatedObjects.set(sign.storageObjectKey, { sizeBytes: 999999, contentType: 'application/pdf' });
      const outcome = await completeUploadObject(rawToken, { storageObjectKey: sign.storageObjectKey });
      assert(
        outcome.kind === 'completion_denied' && outcome.reason === 'metadata_mismatch',
        'provider-observed size differing from declared size is denied as metadata_mismatch'
      );
    }
  }

  section('8. R1 §1.4: macro extension with an otherwise-allowed MIME is denied at sign time');
  {
    const request = await createTestRequest();
    const { rawToken } = await createSessionWithToken(request.id);
    const outcome = await signUploadObject(rawToken, {
      filename: 'budget.docm',
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      sizeBytes: 1000,
    });
    assert(
      outcome.kind === 'rejected' && outcome.reason === 'extension_not_allowed',
      '.docm with the .docx MIME type is denied as extension_not_allowed (macro extension always denied)'
    );
  }

  section('9. R1 §1.4: archive/executable/script extension with an allowed MIME is denied');
  {
    const request = await createTestRequest();
    const { rawToken } = await createSessionWithToken(request.id);
    for (const filename of ['payload.exe', 'archive.zip', 'script.sh', 'malware.js']) {
      const outcome = await signUploadObject(rawToken, { filename, contentType: 'application/pdf', sizeBytes: 1000 });
      assert(
        outcome.kind === 'rejected' && outcome.reason === 'extension_not_allowed',
        `${filename} claiming application/pdf is denied as extension_not_allowed`
      );
    }
  }

  section('10. R1 §1.5: first file does not finalize the session; explicit finish finalizes exactly once');
  {
    const request = await createTestRequest();
    const { rawToken, sessionId } = await createSessionWithToken(request.id);
    const emailForFinalize = createFakeEmailSender('always_succeed');
    __setEmailForTests(emailForFinalize);

    const sign1 = await signUploadObject(rawToken, { filename: 'f1.pdf', contentType: 'application/pdf', sizeBytes: 1000 });
    assert(sign1.kind === 'ok', 'first file signs');
    if (sign1.kind === 'ok') {
      fakeStorage.simulatedObjects.set(sign1.storageObjectKey, { sizeBytes: 1000, contentType: 'application/pdf' });
      const complete1 = await completeUploadObject(rawToken, { storageObjectKey: sign1.storageObjectKey });
      assert(complete1.kind === 'ok', 'first file completes');
    }

    const sessionAfterFirst = await intakeQuery<{ status: string; finalized_at: Date | null }>(
      `SELECT status, finalized_at FROM public_upload_sessions WHERE id = $1`,
      [sessionId]
    );
    assert(sessionAfterFirst[0].status === 'active', 'session remains ACTIVE after only the first of five allowed files completes');
    assert(sessionAfterFirst[0].finalized_at === null, 'session is NOT finalized after only the first file');

    const requestAfterFirst = await intakeRequestsRepo.findById(request.id);
    assert(requestAfterFirst?.status === 'upload_invited', 'the parent request status is UNCHANGED after only the first file (still "upload_invited", not yet files_received)');
    assert(emailForFinalize.sentMessages.length === 0, 'no upload-complete notification has been sent yet');

    // Explicit finish -- called twice, simulating a duplicate client call.
    const finish1 = await finishUploadSession(rawToken);
    assert(finish1.ok, 'explicit finish succeeds');
    const finish2 = await finishUploadSession(rawToken);
    assert(
      finish2.ok === false,
      'a second explicit finish call reports ok:false (the session is already used/consumed) rather than silently repeating the finalization work'
    );

    const sessionAfterFinish = await intakeQuery<{ status: string; finalized_at: Date | null }>(
      `SELECT status, finalized_at FROM public_upload_sessions WHERE id = $1`,
      [sessionId]
    );
    assert(sessionAfterFinish[0].status === 'used', 'session is USED after explicit finish');
    assert(sessionAfterFinish[0].finalized_at !== null, 'session finalized_at is set exactly once');

    const requestAfterFinish = await intakeRequestsRepo.findById(request.id);
    assert(requestAfterFinish?.status === 'files_received', 'the parent request transitions to files_received exactly once, after explicit finish');

    assert(
      emailForFinalize.sentMessages.length === 1,
      `upload-complete notification requested EXACTLY ONCE despite finish being called twice (got ${emailForFinalize.sentMessages.length})`
    );
    assert(
      emailForFinalize.sentMessages[0]?.idempotencyKey === `upload-complete/${sessionId}`,
      'the upload-complete email carries a stable, session-scoped provider idempotency key'
    );
  }
  __setEmailForTests(createFakeEmailSender('always_succeed'));

  section('11. R1 §1.5: reaching the exact maximum file count auto-finalizes exactly once');
  {
    const request = await createTestRequest();
    const { rawToken, sessionId } = await createSessionWithToken(request.id);
    const emailForMax = createFakeEmailSender('always_succeed');
    __setEmailForTests(emailForMax);

    for (let i = 0; i < 5; i += 1) {
      const sign = await signUploadObject(rawToken, { filename: `max-${i}.pdf`, contentType: 'application/pdf', sizeBytes: 1000 });
      assert(sign.kind === 'ok', `file ${i + 1}/5 signs`);
      if (sign.kind === 'ok') {
        fakeStorage.simulatedObjects.set(sign.storageObjectKey, { sizeBytes: 1000, contentType: 'application/pdf' });
        const complete = await completeUploadObject(rawToken, { storageObjectKey: sign.storageObjectKey });
        assert(complete.kind === 'ok', `file ${i + 1}/5 completes`);
      }
    }
    const sessionAfterMax = await intakeQuery<{ status: string }>(`SELECT status FROM public_upload_sessions WHERE id = $1`, [sessionId]);
    assert(sessionAfterMax[0].status === 'used', 'session auto-finalizes to used upon reaching exactly 5 completed files, with no explicit finish call');
    assert(emailForMax.sentMessages.length === 1, 'upload-complete notification requested exactly once when auto-finalized by reaching max file count');
  }
  __setEmailForTests(createFakeEmailSender('always_succeed'));

  section('12. R1 §1.2: a failed provider signing call releases/marks the reservation failed');
  {
    const request = await createTestRequest();
    const { rawToken, sessionId } = await createSessionWithToken(request.id);
    const failingStorage: StorageAdapter = {
      async createSignedUploadUrl(): Promise<never> {
        throw new Error('simulated provider outage');
      },
      async verifyObjectExists() {
        return null;
      },
    };
    __setStorageForTests(failingStorage);
    const outcome = await signUploadObject(rawToken, { filename: 'fail.pdf', contentType: 'application/pdf', sizeBytes: 1000 });
    assert(outcome.kind === 'signing_failed', 'a storage-provider failure during signing surfaces as signing_failed, not a crash');
    const reservationRows = await intakeQuery<{ reservation_status: string }>(
      `SELECT reservation_status FROM public_intake_files WHERE upload_session_id = $1`,
      [sessionId]
    );
    assert(
      reservationRows.length === 1 && reservationRows[0].reservation_status === 'failed',
      'the reservation created before the failed signing call is marked failed, not left as reserved forever'
    );
    __setStorageForTests(fakeStorage);

    // And it does NOT count against the quota -- a subsequent real
    // sign attempt for the same session should still succeed.
    const retrySign = await signUploadObject(rawToken, { filename: 'retry.pdf', contentType: 'application/pdf', sizeBytes: 1000 });
    assert(retrySign.kind === 'ok', 'after the failed reservation, a fresh sign attempt for the same session still succeeds (failed reservation does not consume the quota)');
  }

  section('13. R1 §1.6: orphan cleanup dry-run and apply');
  {
    const request = await createTestRequest();
    const { sessionId } = await createSessionWithToken(request.id);
    // Manufacture an expired session with a still-reserved file, to
    // simulate a customer who was signed a URL but never completed
    // (or never even started) the actual upload before the link expired.
    await intakeQuery(`UPDATE public_upload_sessions SET expires_at = now() - interval '1 hour' WHERE id = $1`, [sessionId]);
    await intakeQuery(
      `INSERT INTO public_intake_files (request_id, upload_session_id, storage_object_key, original_filename, declared_content_type, declared_size_bytes, reservation_status)
       VALUES ($1, $2, $3, 'orphan.pdf', 'application/pdf', 1000, 'reserved')`,
      [request.id, sessionId, `orphan-key-${randomUUID()}`]
    );

    const orphansBefore = await intakeFilesRepo.findOrphanReservations();
    assert(orphansBefore.some((o) => o.upload_session_id === sessionId), 'dry-run orphan scan finds the manufactured expired-still-reserved reservation');

    const expired = await intakeFilesRepo.expireOrphanReservations();
    assert(expired.some((f) => f.upload_session_id === sessionId), 'apply mode actually marks the orphan reservation as expired');

    const afterRows = await intakeQuery<{ reservation_status: string }>(
      `SELECT reservation_status FROM public_intake_files WHERE upload_session_id = $1 AND original_filename = 'orphan.pdf'`,
      [sessionId]
    );
    assert(afterRows[0]?.reservation_status === 'expired', 'the orphan row is now marked expired in the database');

    const orphansAfter = await intakeFilesRepo.findOrphanReservations();
    assert(!orphansAfter.some((o) => o.upload_session_id === sessionId), 're-running the orphan scan no longer finds it (already cleaned)');
  }

  __resetAdaptersForTests();
  printSummaryAndExit();
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('gate6-upload-r1.qa.ts failed:', error);
  process.exitCode = 1;
});
