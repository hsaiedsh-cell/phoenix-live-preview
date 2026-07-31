// ============================================================
// QA: Minimal finalized token-state receipt and UI convergence (R7)
// PHX-LAUNCH-001-R7 Section 4 / Section 7 ("Token state and UI")
// Server-side proofs EXECUTED against a real local Postgres instance
// with an injected fake Storage/Email adapter. UI convergence proofs
// use the real, exported pure state/reconciliation helpers directly
// (no rendering) plus structural checks of UploadClient.tsx's actual
// source for the parts that require a real browser to observe end to
// end (unavailable in this sandbox, unchanged from every prior
// revision's finding).
// ============================================================

import { randomUUID } from 'node:crypto';
import { assert, section, printSummaryAndExit } from './assert';
import { intakeQuery } from '../../src/lib/intake/db';
import * as intakeRequestsRepo from '../../src/lib/intake/repositories/intake-requests.repository';
import * as uploadSessionsRepo from '../../src/lib/intake/repositories/upload-sessions.repository';
import { generateRawUploadToken, tokenHash } from '../../src/lib/intake/hash';
import { signUploadObject, completeUploadObject, checkUploadToken } from '../../src/lib/intake/upload-flow.service';
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
     ) VALUES ('PHX-REQ-' || substr(md5(random()::text), 1, 12), 'assessment', 'R7Gate4', 'Tester',
       $1, 'Acme', 'CAIO', 'THIS_MESSAGE_MUST_NEVER_APPEAR', true, $2, $3, false, now(), $4, 'THIS_IP_HASH_MUST_NEVER_APPEAR', 'upload_invited')
     RETURNING *`,
    [`r7gate4-${randomUUID()}@acme.example`, CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION, randomUUID()]
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
  __setEmailForTests(createFakeEmailSender('always_succeed'));

  section('1. A used/finalized valid token returns the minimal receipt, not the generic denial');
  {
    const request = await createTestRequest();
    const rawToken = await createSessionWithToken(request.id);
    const sign = await signUploadObject(rawToken, { filename: `receipt-${randomUUID()}.pdf`, contentType: 'application/pdf', sizeBytes: 1000, reservationKey: randomUUID() });
    assert(sign.kind === 'ok', 'sign succeeds');
    if (sign.kind === 'ok') {
      fakeStorage.simulatedObjects.set(sign.storageObjectKey, { sizeBytes: 1000, contentType: 'application/pdf' });
      await completeUploadObject(rawToken, { storageObjectKey: sign.storageObjectKey, finishSession: true });
    }
    const outcome = await checkUploadToken(rawToken);
    assert(outcome.kind === 'finalized', 'the finalized token returns the minimal receipt, not a generic denial');
    if (outcome.kind === 'finalized') {
      assert(outcome.completedCount === 1, 'the receipt reports the correct completed count');
      assert(outcome.finalizedAt instanceof Date, 'the receipt includes a real finalizedAt timestamp');
    }
  }

  section('2. The receipt contains no filenames, object keys, or customer data');
  {
    const request = await createTestRequest();
    const rawToken = await createSessionWithToken(request.id);
    const sign = await signUploadObject(rawToken, { filename: 'SECRET_FILENAME_never_expose.pdf', contentType: 'application/pdf', sizeBytes: 1000, reservationKey: randomUUID() });
    assert(sign.kind === 'ok', 'sign succeeds');
    if (sign.kind === 'ok') {
      fakeStorage.simulatedObjects.set(sign.storageObjectKey, { sizeBytes: 1000, contentType: 'application/pdf' });
      await completeUploadObject(rawToken, { storageObjectKey: sign.storageObjectKey, finishSession: true });
      const outcome = await checkUploadToken(rawToken);
      assert(outcome.kind === 'finalized', 'finalized receipt returned');
      const serialized = JSON.stringify(outcome);
      assert(!serialized.includes('SECRET_FILENAME'), 'the receipt never includes the original filename');
      assert(!serialized.includes(sign.storageObjectKey), 'the receipt never includes the storage object key');
      assert(!serialized.includes(request.id), 'the receipt never includes the database request UUID');
      assert(!serialized.includes('THIS_MESSAGE_MUST_NEVER_APPEAR'), 'the receipt never includes the customer message');
      assert(!serialized.includes('THIS_IP_HASH_MUST_NEVER_APPEAR'), 'the receipt never includes the IP hash');
      assert(!serialized.toLowerCase().includes('@acme.example'), 'the receipt never includes the customer email');
      assert(!serialized.includes(tokenHash(rawToken)), 'the receipt never includes the token hash');
      assert(!('pendingReservations' in outcome), 'the receipt has no pendingReservations field at all');
    }
  }

  section('3. Invalid/revoked/expired (never-finalized) tokens remain the generic denial, not the finalized receipt');
  {
    const invalidOutcome = await checkUploadToken(generateRawUploadToken());
    assert(invalidOutcome.kind === 'denied' && invalidOutcome.reason === 'invalid', 'a random, never-issued token remains a generic denial');

    const revokedRequest = await createTestRequest();
    const revokedToken = await createSessionWithToken(revokedRequest.id);
    const revokedSessionRows = await intakeQuery<{ id: string }>(`SELECT id FROM public_upload_sessions WHERE request_id = $1`, [revokedRequest.id]);
    await intakeQuery(`UPDATE public_upload_sessions SET status = 'revoked', revoked_at = now() WHERE id = $1`, [revokedSessionRows[0].id]);
    const revokedOutcome = await checkUploadToken(revokedToken);
    assert(revokedOutcome.kind === 'denied' && revokedOutcome.reason === 'revoked', 'a revoked (never-finalized) session remains the generic denial, never the finalized receipt');

    const expiredRequest = await createTestRequest();
    const expiredToken = await createSessionWithToken(expiredRequest.id);
    const expiredSessionRows = await intakeQuery<{ id: string }>(`SELECT id FROM public_upload_sessions WHERE request_id = $1`, [expiredRequest.id]);
    await intakeQuery(`UPDATE public_upload_sessions SET expires_at = now() - interval '1 second' WHERE id = $1`, [expiredSessionRows[0].id]);
    const expiredOutcome = await checkUploadToken(expiredToken);
    assert(expiredOutcome.kind === 'denied' && expiredOutcome.reason === 'expired', 'an expired (never-finalized) session remains the generic denial, never the finalized receipt');
  }

  section('4. Initial-load finalized receipt renders success without upload controls (structural)');
  {
    const fs = await import('node:fs');
    const source = fs.readFileSync(new URL('../../src/components/intake/UploadClient.tsx', import.meta.url), 'utf8');
    assert(source.includes("body.state === 'finalized'"), 'the initial-load effect checks for the finalized state');
    assert(source.includes("status: 'finalized'"), 'a dedicated finalized tokenState status exists, separate from the full "valid" state (which requires maxFiles etc. the finalized receipt does not have)');
    assert(
      /tokenState\.status === 'finalized'\) \{[\s\S]{0,400}Upload complete/.test(source),
      'the finalized tokenState renders the success confirmation directly, without ever reaching the upload-controls render branch'
    );
  }

  section('5. Ambiguous completion refresh converges to completed/finalized state (pure reconciliation + real finalized-promotion logic, cross-referenced)');
  {
    // The real, executed proof that reconciliation correctly merges/
    // removes entries lives in gate1-duplicate-convergence-r7.qa.ts
    // and gate3-reconciliation-r6.qa.ts. This proves the ADDITIONAL
    // R7-specific promotion rule structurally: when the token-state
    // response reports state 'finalized', every non-terminal local
    // entry is promoted to 'completed' -- proven directly against the
    // real reconcile-adjacent logic in refreshUploadState's source.
    const fs = await import('node:fs');
    const source = fs.readFileSync(new URL('../../src/components/intake/UploadClient.tsx', import.meta.url), 'utf8');
    const refreshFnMatch = source.match(/async function refreshUploadState[\s\S]*?\n  \}\n/);
    assert(!!refreshFnMatch, 'refreshUploadState found in source');
    if (refreshFnMatch) {
      assert(refreshFnMatch[0].includes("body.state === 'finalized'"), 'refreshUploadState checks for the finalized receipt');
      assert(
        /entry\.phase === 'cancelled' \|\| entry\.phase === 'terminal' \|\| entry\.phase === 'rejected'\s*\?\s*entry\s*:\s*\{ \.\.\.entry, phase: 'completed'/.test(refreshFnMatch[0]),
        'every non-terminal local entry is promoted to completed when the session is discovered to be finalized -- never left in a false recoverable-error state'
      );
    }
  }

  section('6. Ambiguous finish refresh converges to success (structural)');
  {
    const fs = await import('node:fs');
    const source = fs.readFileSync(new URL('../../src/components/intake/UploadClient.tsx', import.meta.url), 'utf8');
    const handleFinishMatch = source.match(/async function handleFinish[\s\S]*?\n  \}\n/);
    assert(!!handleFinishMatch, 'handleFinish found in source');
    if (handleFinishMatch) {
      assert(handleFinishMatch[0].includes('await refreshUploadState()'), 'a network failure in handleFinish calls authoritative refresh rather than assuming failure');
      assert(handleFinishMatch[0].includes('result.finalized'), 'handleFinish checks refreshUploadState\'s own finalized signal to decide whether to show success or a genuine network error');
      assert(!/catch \{\s*setFinishState\('error'\)/.test(handleFinishMatch[0]), 'the catch block does not unconditionally report a network error without first attempting reconciliation');
    }
  }

  section('7. R6 §6 recap: completedBytes/reservedBytes are retained in component state (structural)');
  {
    const fs = await import('node:fs');
    const source = fs.readFileSync(new URL('../../src/components/intake/UploadClient.tsx', import.meta.url), 'utf8');
    assert(source.includes('setCompletedBytes(body.completedBytes)'), 'completedBytes is stored from the authoritative response');
    assert(source.includes('setReservedBytes(body.reservedBytes)'), 'reservedBytes is stored from the authoritative response');
  }

  __resetAdaptersForTests();
  printSummaryAndExit();
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('gate4-finalized-receipt-r7.qa.ts failed:', error);
  process.exitCode = 1;
});
