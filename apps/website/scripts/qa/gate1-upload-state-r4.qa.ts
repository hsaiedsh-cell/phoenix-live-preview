// ============================================================
// QA: Authoritative upload-session state (R4)
// PHX-LAUNCH-001-R4 Section 1
// EXECUTED against a real local Postgres instance. Storage is an
// injected fake adapter.
// ============================================================

import { randomUUID } from 'node:crypto';
import { assert, section, printSummaryAndExit } from './assert';
import { intakeQuery } from '../../src/lib/intake/db';
import * as intakeRequestsRepo from '../../src/lib/intake/repositories/intake-requests.repository';
import * as uploadSessionsRepo from '../../src/lib/intake/repositories/upload-sessions.repository';
import { generateRawUploadToken, tokenHash } from '../../src/lib/intake/hash';
import { checkUploadToken, signUploadObject, completeUploadObject } from '../../src/lib/intake/upload-flow.service';
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
     ) VALUES ('PHX-REQ-' || substr(md5(random()::text), 1, 12), 'assessment', 'R4Gate1', 'Tester',
       $1, 'Acme', 'CAIO', 'THIS_IS_THE_SECRET_CUSTOMER_MESSAGE_never_expose', true, $2, $3, false, now(), $4, 'THIS_IS_THE_IP_HASH_never_expose')
     RETURNING *`,
    [`r4gate1-${randomUUID()}@acme.example`, CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION, randomUUID()]
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

  section('1. GET token state returns actual completed count and remaining count/bytes');
  {
    const request = await createTestRequest();
    const { rawToken } = await createSessionWithToken(request.id);
    const initial = await checkUploadToken(rawToken);
    assert(initial.kind === 'ok', 'token check succeeds');
    if (initial.kind === 'ok') {
      assert(initial.completedCount === 0, 'freshly issued session reports completedCount 0');
      assert(initial.remainingFileSlots === initial.maxFiles, 'remaining file slots equals maxFiles before anything is reserved');
    }

    const sign = await signUploadObject(rawToken, { filename: 'a.pdf', contentType: 'application/pdf', sizeBytes: 1000 });
    assert(sign.kind === 'ok', 'sign succeeds');
    if (sign.kind === 'ok') {
      fakeStorage.simulatedObjects.set(sign.storageObjectKey, { sizeBytes: 1000, contentType: 'application/pdf' });
      await completeUploadObject(rawToken, { storageObjectKey: sign.storageObjectKey });
    }
    const afterOne = await checkUploadToken(rawToken);
    assert(afterOne.kind === 'ok', 'token check still succeeds after one completion');
    if (afterOne.kind === 'ok') {
      assert(afterOne.completedCount === 1, `completedCount reflects the real completed file (got ${afterOne.completedCount})`);
      assert(afterOne.completedBytes === 1000, 'completedBytes reflects the real completed file size');
      assert(afterOne.remainingFileSlots === afterOne.maxFiles - 1, 'remainingFileSlots decreases by exactly one');
      assert(afterOne.remainingBytes === afterOne.maxTotalSizeBytes - 1000, 'remainingBytes decreases by exactly the completed file size');
    }
  }

  section('2. Reload after one completed file enables Finish (server reports completedCount > 0)');
  {
    // "Enabling Finish" is a client-side computation
    // (gate4-upload-ui-r2.qa.ts already proves canFinish's exact
    // logic); this proves the SERVER SIDE of that contract: the
    // token-state response the client initializes from genuinely
    // reports a positive completedCount after a completion, as if
    // the page had just been reloaded with no other client state at all.
    const request = await createTestRequest();
    const { rawToken } = await createSessionWithToken(request.id);
    const sign = await signUploadObject(rawToken, { filename: 'reload.pdf', contentType: 'application/pdf', sizeBytes: 500 });
    if (sign.kind === 'ok') {
      fakeStorage.simulatedObjects.set(sign.storageObjectKey, { sizeBytes: 500, contentType: 'application/pdf' });
      await completeUploadObject(rawToken, { storageObjectKey: sign.storageObjectKey });
    }
    // Simulate "reload": call checkUploadToken completely fresh, as
    // the GET route would on page load, with no prior in-memory state.
    const reloaded = await checkUploadToken(rawToken);
    assert(reloaded.kind === 'ok' && reloaded.completedCount > 0, 'a fresh token check after reload reports completedCount > 0, which is exactly what the client uses to enable Finish immediately');
  }

  section('3. Pending reservation survives reload and is exposed with only the minimum safe fields');
  {
    const request = await createTestRequest();
    const { rawToken } = await createSessionWithToken(request.id);
    const sign = await signUploadObject(rawToken, { filename: 'pending-recover.pdf', contentType: 'application/pdf', sizeBytes: 750 });
    assert(sign.kind === 'ok', 'sign succeeds (reservation created, never completed -- simulating an interrupted upload)');

    const reloaded = await checkUploadToken(rawToken);
    assert(reloaded.kind === 'ok', 'token check succeeds');
    if (reloaded.kind === 'ok') {
      assert(reloaded.pendingReservations.length === 1, 'exactly one pending reservation is reported');
      const pending = reloaded.pendingReservations[0];
      assert(pending.originalFilename === 'pending-recover.pdf', 'the pending reservation exposes its original filename');
      assert(pending.declaredContentType === 'application/pdf', 'the pending reservation exposes its declared content type');
      assert(pending.declaredSizeBytes === 750, 'the pending reservation exposes its declared size');
      assert(pending.reservationStatus === 'reserved', 'the pending reservation exposes its status');
      assert(sign.kind === 'ok' && pending.storageObjectKey === sign.storageObjectKey, 'the pending reservation exposes the same storage object key issued at sign time');

      const serialized = JSON.stringify(reloaded);
      assert(!serialized.includes(request.id), 'the response never includes the database request UUID');
      assert(!serialized.includes('THIS_IS_THE_SECRET_CUSTOMER_MESSAGE'), 'the response never includes the customer message');
      assert(!serialized.includes('THIS_IS_THE_IP_HASH'), 'the response never includes the IP hash');
      assert(!serialized.toLowerCase().includes('@acme.example'), 'the response never includes the customer email');
      assert(!serialized.includes(tokenHash(rawToken)), 'the response never includes the token hash');
    }
  }

  section('4. A finalized/used session still shows the generic invalid-link behavior (unchanged)');
  {
    const request = await createTestRequest();
    const { rawToken, sessionId } = await createSessionWithToken(request.id);
    await intakeQuery(`UPDATE public_upload_sessions SET status = 'used', finalized_at = now() WHERE id = $1`, [sessionId]);
    const outcome = await checkUploadToken(rawToken);
    assert(outcome.kind === 'denied' && outcome.reason === 'used', 'a finalized/used session is still denied with the generic "used" reason, exactly as before R4');
  }

  __resetAdaptersForTests();
  printSummaryAndExit();
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('gate1-upload-state-r4.qa.ts failed:', error);
  process.exitCode = 1;
});
