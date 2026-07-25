// ============================================================
// QA: Reservation retry and cancellation recovery (R4)
// PHX-LAUNCH-001-R4 Section 2
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
import { checkUploadToken, signUploadObject, completeUploadObject, cancelUploadReservation } from '../../src/lib/intake/upload-flow.service';
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
     ) VALUES ('PHX-REQ-' || substr(md5(random()::text), 1, 12), 'assessment', 'R4Gate2', 'Tester',
       $1, 'Acme', 'CAIO', 'reservation recovery QA r4', true, $2, $3, false, now(), $4, null)
     RETURNING *`,
    [`r4gate2-${randomUUID()}@acme.example`, CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION, randomUUID()]
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

  section('1. Cancelling a reserved item releases quota');
  {
    const request = await createTestRequest();
    const { rawToken } = await createSessionWithToken(request.id);
    const sign = await signUploadObject(rawToken, { filename: 'cancel-me.pdf', contentType: 'application/pdf', sizeBytes: 1000 });
    assert(sign.kind === 'ok', 'sign succeeds');
    if (sign.kind === 'ok') {
      const beforeCancel = await checkUploadToken(rawToken);
      assert(beforeCancel.kind === 'ok' && beforeCancel.reservedCount === 1, 'quota shows 1 reserved before cancellation');

      const cancelOutcome = await cancelUploadReservation(rawToken, sign.storageObjectKey);
      assert(cancelOutcome.kind === 'ok' && cancelOutcome.cancelled === true, 'cancellation succeeds');

      const afterCancel = await checkUploadToken(rawToken);
      assert(afterCancel.kind === 'ok' && afterCancel.reservedCount === 0, 'reserved count returns to 0 after cancellation');
      assert(afterCancel.kind === 'ok' && afterCancel.remainingFileSlots === afterCancel.maxFiles, 'the full file-count quota is available again');
      assert(afterCancel.kind === 'ok' && afterCancel.pendingReservations.length === 0, 'the cancelled reservation no longer appears as pending');

      const row = await intakeQuery<{ reservation_status: string }>(`SELECT reservation_status FROM public_intake_files WHERE storage_object_key = $1`, [sign.storageObjectKey]);
      assert(row[0]?.reservation_status === 'cancelled', 'the underlying row is genuinely marked cancelled in the database');
    }
  }

  section('2. A NEW reservation can immediately reuse the freed quota after cancellation');
  {
    const request = await createTestRequest();
    const { rawToken } = await createSessionWithToken(request.id);
    // Fill every slot.
    const firstCheck = await checkUploadToken(rawToken);
    assert(firstCheck.kind === 'ok', 'token check succeeds');
    const maxFiles = firstCheck.kind === 'ok' ? firstCheck.maxFiles : 0;
    const keys: string[] = [];
    for (let i = 0; i < maxFiles; i += 1) {
      const sign = await signUploadObject(rawToken, { filename: `fill-${i}.pdf`, contentType: 'application/pdf', sizeBytes: 100 });
      assert(sign.kind === 'ok', `sign ${i} succeeds while filling all slots`);
      if (sign.kind === 'ok') keys.push(sign.storageObjectKey);
    }
    const fullOutcome = await signUploadObject(rawToken, { filename: 'overflow.pdf', contentType: 'application/pdf', sizeBytes: 100 });
    assert(fullOutcome.kind === 'rejected' && fullOutcome.reason === 'file_count_exceeded', 'signing a 6th file is rejected once all slots are filled');

    await cancelUploadReservation(rawToken, keys[0]);
    const retryOutcome = await signUploadObject(rawToken, { filename: 'reuse-freed-slot.pdf', contentType: 'application/pdf', sizeBytes: 100 });
    assert(retryOutcome.kind === 'ok', 'signing succeeds again immediately after cancelling one reservation frees its slot');
  }

  section('3. Completed item cannot be cancelled');
  {
    const request = await createTestRequest();
    const { rawToken } = await createSessionWithToken(request.id);
    const sign = await signUploadObject(rawToken, { filename: 'completed.pdf', contentType: 'application/pdf', sizeBytes: 1000 });
    assert(sign.kind === 'ok', 'sign succeeds');
    if (sign.kind === 'ok') {
      fakeStorage.simulatedObjects.set(sign.storageObjectKey, { sizeBytes: 1000, contentType: 'application/pdf' });
      const complete = await completeUploadObject(rawToken, { storageObjectKey: sign.storageObjectKey });
      assert(complete.kind === 'ok', 'completion succeeds');

      const cancelOutcome = await cancelUploadReservation(rawToken, sign.storageObjectKey);
      assert(
        cancelOutcome.kind === 'cancellation_denied' && cancelOutcome.reason === 'already_completed',
        'cancelling an already-completed reservation is denied'
      );
      const row = await intakeQuery<{ reservation_status: string }>(`SELECT reservation_status FROM public_intake_files WHERE storage_object_key = $1`, [sign.storageObjectKey]);
      assert(row[0]?.reservation_status === 'completed', 'the completed row is unaffected -- still completed, not cancelled');
    }
  }

  section('4. Duplicate cancel is idempotent');
  {
    const request = await createTestRequest();
    const { rawToken } = await createSessionWithToken(request.id);
    const sign = await signUploadObject(rawToken, { filename: 'double-cancel.pdf', contentType: 'application/pdf', sizeBytes: 1000 });
    assert(sign.kind === 'ok', 'sign succeeds');
    if (sign.kind === 'ok') {
      const first = await cancelUploadReservation(rawToken, sign.storageObjectKey);
      assert(first.kind === 'ok' && first.cancelled === true, 'first cancel actually cancels');
      const second = await cancelUploadReservation(rawToken, sign.storageObjectKey);
      assert(second.kind === 'ok' && second.cancelled === false, 'second cancel on the same key is a no-op success (idempotent), not an error');
    }
  }

  section('5. Retry uses the SAME reservation and does not increment quota');
  {
    const request = await createTestRequest();
    const { rawToken } = await createSessionWithToken(request.id);
    const sign = await signUploadObject(rawToken, { filename: 'retry-same.pdf', contentType: 'application/pdf', sizeBytes: 1000 });
    assert(sign.kind === 'ok', 'sign succeeds');
    if (sign.kind === 'ok') {
      // Simulate a failed-then-retried completion: verifyObjectExists
      // is absent the first time (as if the PUT hadn't landed yet or
      // was still propagating), then present on retry -- both calls
      // use the SAME storageObjectKey, never re-signing.
      const firstAttempt = await completeUploadObject(rawToken, { storageObjectKey: sign.storageObjectKey });
      assert(firstAttempt.kind === 'completion_denied' && firstAttempt.reason === 'provider_metadata_unavailable', 'first completion attempt fails because the object is not yet visible to the provider');

      const midState = await checkUploadToken(rawToken);
      assert(midState.kind === 'ok' && midState.reservedCount === 1, 'the reservation is still exactly 1 reserved item after the failed attempt -- no duplicate, no loss');

      fakeStorage.simulatedObjects.set(sign.storageObjectKey, { sizeBytes: 1000, contentType: 'application/pdf' });
      const retryAttempt = await completeUploadObject(rawToken, { storageObjectKey: sign.storageObjectKey });
      assert(retryAttempt.kind === 'ok', 'retrying completion with the SAME object key succeeds once the object becomes visible');

      const rows = await intakeQuery<{ count: string }>(`SELECT count(*) FROM public_intake_files WHERE storage_object_key = $1`, [sign.storageObjectKey]);
      assert(Number(rows[0].count) === 1, 'exactly ONE reservation row exists for this object key -- retry never created a second one');
    }
  }

  section('6. Cancellation requires session/request match (foreign session denied)');
  {
    const requestA = await createTestRequest();
    const { rawToken: tokenA } = await createSessionWithToken(requestA.id);
    const signA = await signUploadObject(tokenA, { filename: 'a.pdf', contentType: 'application/pdf', sizeBytes: 1000 });
    assert(signA.kind === 'ok', 'sign for session A succeeds');

    const requestB = await createTestRequest();
    const { rawToken: tokenB } = await createSessionWithToken(requestB.id);

    if (signA.kind === 'ok') {
      const crossOutcome = await cancelUploadReservation(tokenB, signA.storageObjectKey);
      assert(
        crossOutcome.kind === 'cancellation_denied' && crossOutcome.reason === 'unknown_object_key',
        "session B's token cannot cancel session A's reservation"
      );
    }
  }

  section('7. A cancelled reservation whose provider deletion failed remains eligible for normal orphan cleanup');
  {
    const request = await createTestRequest();
    const { rawToken } = await createSessionWithToken(request.id);
    const sign = await signUploadObject(rawToken, { filename: 'cancel-delete-fails.pdf', contentType: 'application/pdf', sizeBytes: 1000 });
    assert(sign.kind === 'ok', 'sign succeeds');
    if (sign.kind === 'ok') {
      fakeStorage.simulatedDeleteFailures.add(sign.storageObjectKey);
      const cancelOutcome = await cancelUploadReservation(rawToken, sign.storageObjectKey);
      assert(cancelOutcome.kind === 'ok' && cancelOutcome.cancelled === true, 'cancellation itself still succeeds even though the best-effort provider deletion fails');
      const orphans = await intakeFilesRepo.findOrphanReservations();
      assert(
        orphans.some((o) => o.storage_object_key === sign.storageObjectKey && o.reason === 'cancelled'),
        'the cancelled-but-not-deleted reservation is discoverable by the normal orphan cleanup scan, tagged with reason "cancelled"'
      );
    }
  }

  __resetAdaptersForTests();
  printSummaryAndExit();
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('gate2-reservation-recovery-r4.qa.ts failed:', error);
  process.exitCode = 1;
});
