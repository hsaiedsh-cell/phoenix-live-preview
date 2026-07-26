// ============================================================
// QA: Prevent finalization while reserved files still exist (R5)
// PHX-LAUNCH-001-R5 Section 3
// EXECUTED against a real local Postgres instance. Storage is an
// injected fake adapter.
// ============================================================

import { randomUUID } from 'node:crypto';
import { assert, section, printSummaryAndExit } from './assert';
import { intakeQuery } from '../../src/lib/intake/db';
import * as intakeRequestsRepo from '../../src/lib/intake/repositories/intake-requests.repository';
import * as uploadSessionsRepo from '../../src/lib/intake/repositories/upload-sessions.repository';
import * as intakeFilesRepo from '../../src/lib/intake/repositories/intake-files.repository';
import { generateRawUploadToken, tokenHash } from '../../src/lib/intake/hash';
import { signUploadObject, completeUploadObject, finishUploadSession, cancelUploadReservation } from '../../src/lib/intake/upload-flow.service';
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
     ) VALUES ('PHX-REQ-' || substr(md5(random()::text), 1, 12), 'assessment', 'R5Gate3', 'Tester',
       $1, 'Acme', 'CAIO', 'pending reservations QA r5', true, $2, $3, false, now(), $4, null, 'upload_invited')
     RETURNING *`,
    [`r5gate3-${randomUUID()}@acme.example`, CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION, randomUUID()]
  ).then((rows) => rows[0]);
}

async function createSessionWithToken(requestId: string): Promise<{ rawToken: string; sessionId: string }> {
  const rawToken = generateRawUploadToken();
  const session = await uploadSessionsRepo.createUploadSession(requestId, tokenHash(rawToken));
  return { rawToken, sessionId: session.id };
}

async function main() {
  __setEmailForTests(createFakeEmailSender('always_succeed'));
  const fakeStorage = createFakeStorageAdapter();
  __setStorageForTests(fakeStorage);

  section('1. Finish with a completed file AND a reserved file is rejected; session remains active; request remains upload_invited');
  {
    const request = await createTestRequest();
    const { rawToken, sessionId } = await createSessionWithToken(request.id);

    const completedSign = await signUploadObject(rawToken, { filename: 'completed.pdf', contentType: 'application/pdf', sizeBytes: 1000, reservationKey: randomUUID() });
    assert(completedSign.kind === 'ok', 'sign for the file we will complete succeeds');
    if (completedSign.kind === 'ok') {
      fakeStorage.simulatedObjects.set(completedSign.storageObjectKey, { sizeBytes: 1000, contentType: 'application/pdf' });
      await completeUploadObject(rawToken, { storageObjectKey: completedSign.storageObjectKey });
    }
    const pendingSign = await signUploadObject(rawToken, { filename: 'still-pending.pdf', contentType: 'application/pdf', sizeBytes: 500, reservationKey: randomUUID() });
    assert(pendingSign.kind === 'ok', 'sign for the file we leave pending succeeds (never completed)');

    const finish = await finishUploadSession(rawToken);
    assert(finish.ok === false && finish.reason === 'pending_reservations', 'finish is rejected with the distinct pending_reservations reason, not a generic failure');
    if (!finish.ok) {
      assert(finish.reservedCount === 1, 'the reported reservedCount matches the one genuinely-pending file');
    }

    const sessionRow = await intakeQuery<{ status: string; finalized_at: Date | null }>(`SELECT status, finalized_at FROM public_upload_sessions WHERE id = $1`, [sessionId]);
    assert(sessionRow[0].status === 'active' && sessionRow[0].finalized_at === null, 'the session remains active/not-finalized');
    const requestRow = await intakeRequestsRepo.findById(request.id);
    assert(requestRow?.status === 'upload_invited', 'the request remains upload_invited');
  }

  section('2. After the pending reservation is cancelled, finish succeeds');
  {
    const request = await createTestRequest();
    const { rawToken } = await createSessionWithToken(request.id);
    const completedSign = await signUploadObject(rawToken, { filename: 'completed2.pdf', contentType: 'application/pdf', sizeBytes: 1000, reservationKey: randomUUID() });
    if (completedSign.kind === 'ok') {
      fakeStorage.simulatedObjects.set(completedSign.storageObjectKey, { sizeBytes: 1000, contentType: 'application/pdf' });
      await completeUploadObject(rawToken, { storageObjectKey: completedSign.storageObjectKey });
    }
    const pendingSign = await signUploadObject(rawToken, { filename: 'to-cancel.pdf', contentType: 'application/pdf', sizeBytes: 500, reservationKey: randomUUID() });
    assert(pendingSign.kind === 'ok', 'sign for the file we will cancel succeeds');

    const blockedFinish = await finishUploadSession(rawToken);
    assert(blockedFinish.ok === false && blockedFinish.reason === 'pending_reservations', 'finish is blocked while the reservation remains pending');

    if (pendingSign.kind === 'ok') {
      const cancelResult = await cancelUploadReservation(rawToken, pendingSign.storageObjectKey);
      assert(cancelResult.kind === 'ok' && cancelResult.cancelled === true, 'cancelling the pending reservation succeeds');
    }
    const finishAfterCancel = await finishUploadSession(rawToken);
    assert(finishAfterCancel.ok === true, 'finish now succeeds once the reserved row is gone');
  }

  section('3. Completed rows never appear in orphan cleanup (regression, still holds)');
  {
    const request = await createTestRequest();
    const { rawToken, sessionId } = await createSessionWithToken(request.id);
    const sign = await signUploadObject(rawToken, { filename: 'completed3.pdf', contentType: 'application/pdf', sizeBytes: 1000, reservationKey: randomUUID() });
    if (sign.kind === 'ok') {
      fakeStorage.simulatedObjects.set(sign.storageObjectKey, { sizeBytes: 1000, contentType: 'application/pdf' });
      await completeUploadObject(rawToken, { storageObjectKey: sign.storageObjectKey });
      await intakeQuery(`UPDATE public_upload_sessions SET status = 'revoked' WHERE id = $1`, [sessionId]); // simulate a subsequent revoke
      const orphans = await intakeFilesRepo.findOrphanReservations();
      assert(!orphans.some((o) => o.storage_object_key === sign.storageObjectKey), 'the completed row never appears in orphan cleanup, even under a revoked session');
    }
  }

  section('4. Reserved rows under a REVOKED session appear in orphan cleanup immediately (no wait for expires_at)');
  {
    const request = await createTestRequest();
    const { rawToken, sessionId } = await createSessionWithToken(request.id);
    const sign = await signUploadObject(rawToken, { filename: 'revoked-orphan.pdf', contentType: 'application/pdf', sizeBytes: 500, reservationKey: randomUUID() });
    assert(sign.kind === 'ok', 'sign succeeds');
    await intakeQuery(`UPDATE public_upload_sessions SET status = 'revoked', revoked_at = now() WHERE id = $1`, [sessionId]);
    // expires_at is deliberately left untouched (still far in the future).
    const orphans = await intakeFilesRepo.findOrphanReservations();
    if (sign.kind === 'ok') {
      assert(orphans.some((o) => o.storage_object_key === sign.storageObjectKey), 'the reserved row under a revoked session is immediately discoverable, even though expires_at has not passed');
    }
  }

  section('5. Reserved rows under a USED session appear in orphan cleanup immediately');
  {
    const request = await createTestRequest();
    const { rawToken, sessionId } = await createSessionWithToken(request.id);
    const sign = await signUploadObject(rawToken, { filename: 'used-orphan.pdf', contentType: 'application/pdf', sizeBytes: 500, reservationKey: randomUUID() });
    assert(sign.kind === 'ok', 'sign succeeds');
    await intakeQuery(`UPDATE public_upload_sessions SET status = 'used', used_at = now(), finalized_at = now() WHERE id = $1`, [sessionId]);
    const orphans = await intakeFilesRepo.findOrphanReservations();
    if (sign.kind === 'ok') {
      assert(orphans.some((o) => o.storage_object_key === sign.storageObjectKey), 'the reserved row under a used session is immediately discoverable');
    }
  }

  section('6. Cancel-in-flight blocks Finish structurally (client-side, pure function proof)');
  {
    const { canFinish } = await import('../../src/components/intake/upload-client-state');
    const busyEntry = {
      clientEntryId: 'x',
      reservationKey: 'y',
      filename: 'f.pdf',
      declaredContentType: 'application/pdf',
      declaredSizeBytes: 100,
      phase: 'cancelling' as const,
    };
    const result = canFinish({ completedCount: 1, reservedCount: 0, entries: [busyEntry], finalized: false, finishing: false });
    assert(result === false, "canFinish returns false while any entry is in the 'cancelling' phase, even with completedCount>0 and reservedCount=0");
  }

  __resetAdaptersForTests();
  printSummaryAndExit();
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('gate3-pending-reservations-r5.qa.ts failed:', error);
  process.exitCode = 1;
});
