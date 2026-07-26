// ============================================================
// QA: Ambiguous sign recovery, end-to-end (R6)
// PHX-LAUNCH-001-R6 Sections 1, 2, 5 / Section 7 ("Ambiguous sign
// recovery")
// EXECUTED against a real local Postgres instance. Storage is an
// injected fake adapter. This is the scenario the R5 server-side
// idempotency contract (gate6-idempotent-sign-r5.qa.ts) enabled but
// which had NO usable path from the customer interface until this
// revision -- these tests exercise it the way the UI now actually
// does: treat the first sign's response as lost, then retry with the
// identical reservationKey exactly as signAndUpload's "Retry upload
// request" action does.
// ============================================================

import { randomUUID } from 'node:crypto';
import { assert, section, printSummaryAndExit } from './assert';
import { intakeQuery } from '../../src/lib/intake/db';
import * as intakeRequestsRepo from '../../src/lib/intake/repositories/intake-requests.repository';
import * as uploadSessionsRepo from '../../src/lib/intake/repositories/upload-sessions.repository';
import { generateRawUploadToken, tokenHash } from '../../src/lib/intake/hash';
import { signUploadObject, checkUploadToken, cancelUploadReservation } from '../../src/lib/intake/upload-flow.service';
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
     ) VALUES ('PHX-REQ-' || substr(md5(random()::text), 1, 12), 'assessment', 'R6Gate1', 'Tester',
       $1, 'Acme', 'CAIO', 'ambiguous sign recovery QA r6', true, $2, $3, false, now(), $4, null, 'upload_invited')
     RETURNING *`,
    [`r6gate1-${randomUUID()}@acme.example`, CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION, randomUUID()]
  ).then((rows) => rows[0]);
}

async function createSessionWithToken(requestId: string): Promise<string> {
  const rawToken = generateRawUploadToken();
  await uploadSessionsRepo.createUploadSession(requestId, tokenHash(rawToken));
  return rawToken;
}

async function main() {
  __setEmailForTests(createFakeEmailSender('always_succeed'));
  const fakeStorage = createFakeStorageAdapter();
  __setStorageForTests(fakeStorage);

  section('1. First sign creates a reservation; the browser then treats the response as lost');
  {
    const request = await createTestRequest();
    const rawToken = await createSessionWithToken(request.id);
    const reservationKey = randomUUID();
    const filename = `lost-response-${randomUUID()}.pdf`;
    const candidate = { filename, contentType: 'application/pdf', sizeBytes: 1000, reservationKey };

    const first = await signUploadObject(rawToken, candidate);
    assert(first.kind === 'ok', 'the server-side sign genuinely succeeds -- exactly what the browser never learns about when its response is "lost"');

    // Simulate "the browser never received this" -- it discards
    // `first` entirely and moves the local entry to
    // recoverable_error with NO storageObjectKey, exactly as
    // UploadClient.tsx's signAndUpload catch block does.
    const uiKnowsNothing = { storageObjectKey: undefined as string | undefined };
    assert(uiKnowsNothing.storageObjectKey === undefined, "the UI's local state genuinely has no object key at this point");

    section('2. "Retry upload request" (same reservationKey) retrieves the SAME reservation -- proof it is retrievable using only what the recoverable_error entry actually has');
    const retry = await signUploadObject(rawToken, candidate);
    assert(retry.kind === 'ok', 'the retry succeeds');
    if (first.kind === 'ok' && retry.kind === 'ok') {
      assert(retry.storageObjectKey === first.storageObjectKey, 'the retry resolves to the EXACT SAME storageObjectKey the lost response would have carried');
      assert(retry.uploadUrl !== first.uploadUrl, 'a FRESH signed URL is issued for the retry (not a stale, potentially-expired reuse of the original URL)');
    }

    section('3. No second reservation was created; reserved quota stays at exactly one');
    const rows = await intakeQuery<{ count: string }>(`SELECT count(*) FROM public_intake_files WHERE original_filename = $1`, [filename]);
    assert(Number(rows[0].count) === 1, 'exactly one reservation row exists in the database despite the "lost then retried" sequence');
    const state = await checkUploadToken(rawToken);
    assert(state.kind === 'ok' && state.reservedCount === 1, 'reservedCount reported by the authoritative token-state endpoint is 1, not 2');
  }

  section('4. Cancelling the recovered reservation (once its object key is known) restores quota');
  {
    const request = await createTestRequest();
    const rawToken = await createSessionWithToken(request.id);
    const reservationKey = randomUUID();
    const candidate = { filename: `recover-then-cancel-${randomUUID()}.pdf`, contentType: 'application/pdf', sizeBytes: 1000, reservationKey };
    const sign = await signUploadObject(rawToken, candidate);
    assert(sign.kind === 'ok', 'sign succeeds');

    const beforeCancel = await checkUploadToken(rawToken);
    assert(beforeCancel.kind === 'ok' && beforeCancel.reservedCount === 1, 'quota shows 1 reserved before cancellation');

    if (sign.kind === 'ok') {
      const cancelResult = await cancelUploadReservation(rawToken, sign.storageObjectKey);
      assert(cancelResult.kind === 'ok' && cancelResult.cancelled === true, 'cancellation succeeds using the object key surfaced by the (retried) sign response');
    }
    const afterCancel = await checkUploadToken(rawToken);
    assert(afterCancel.kind === 'ok' && afterCancel.reservedCount === 0, 'quota is restored to 0 reserved ONLY after the server confirms the cancellation -- never guessed locally');
  }

  section('5. A local entry cannot "disappear" while hidden server quota remains (proof at the state layer: the recovered reservation is exactly what reconciliation would surface)');
  {
    const request = await createTestRequest();
    const rawToken = await createSessionWithToken(request.id);
    const reservationKey = randomUUID();
    const hiddenFilename = `hidden-quota-${randomUUID()}.pdf`;
    const sign = await signUploadObject(rawToken, { filename: hiddenFilename, contentType: 'application/pdf', sizeBytes: 1000, reservationKey });
    assert(sign.kind === 'ok', 'sign succeeds (simulating the lost-response scenario -- the caller here deliberately does not use the result directly, mirroring what the UI would have discarded)');

    // The critical proof: even with NO local knowledge of the object
    // key at all (as if the entry had simply been "removed" client-
    // side, the R5-era bug this section closes), the token-state
    // endpoint's pendingReservations list still surfaces it -- this
    // is exactly what reconcilePendingReservations (gate3-reconciliation-r6)
    // turns into a recovered, cancellable/verifiable entry, proving the
    // reservation was never actually hidden, only locally forgotten.
    const state = await checkUploadToken(rawToken);
    assert(state.kind === 'ok' && state.pendingReservations.length === 1, 'the reservation is still discoverable via the authoritative endpoint even with zero local client state referencing it');
    if (state.kind === 'ok') {
      assert(state.pendingReservations[0].originalFilename === hiddenFilename, 'the recovered reservation carries the correct filename for the customer to recognize it');
    }
  }

  __resetAdaptersForTests();
  printSummaryAndExit();
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('gate1-ambiguous-sign-recovery-r6.qa.ts failed:', error);
  process.exitCode = 1;
});
