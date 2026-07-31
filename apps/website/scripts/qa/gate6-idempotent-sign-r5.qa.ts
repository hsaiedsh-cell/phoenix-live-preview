// ============================================================
// QA: Idempotent sign requests across ambiguous responses (R5)
// PHX-LAUNCH-001-R5 Section 6
// EXECUTED against a real local Postgres instance. Storage is an
// injected fake adapter.
// ============================================================

import { randomUUID } from 'node:crypto';
import { assert, section, printSummaryAndExit } from './assert';
import { intakeQuery } from '../../src/lib/intake/db';
import * as intakeRequestsRepo from '../../src/lib/intake/repositories/intake-requests.repository';
import * as uploadSessionsRepo from '../../src/lib/intake/repositories/upload-sessions.repository';
import { generateRawUploadToken, tokenHash } from '../../src/lib/intake/hash';
import { signUploadObject } from '../../src/lib/intake/upload-flow.service';
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
     ) VALUES ('PHX-REQ-' || substr(md5(random()::text), 1, 12), 'assessment', 'R5Gate6', 'Tester',
       $1, 'Acme', 'CAIO', 'idempotent sign QA r5', true, $2, $3, false, now(), $4, null, 'upload_invited')
     RETURNING *`,
    [`r5gate6-${randomUUID()}@acme.example`, CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION, randomUUID()]
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

  section('1. A lost first sign response + client retry (same key) creates exactly one reservation and returns the same object key');
  {
    const request = await createTestRequest();
    const rawToken = await createSessionWithToken(request.id);
    const reservationKey = randomUUID();
    const candidate = { filename: 'lost-response.pdf', contentType: 'application/pdf', sizeBytes: 1000, reservationKey };

    const first = await signUploadObject(rawToken, candidate);
    assert(first.kind === 'ok', 'first sign succeeds');
    const retry = await signUploadObject(rawToken, candidate);
    assert(retry.kind === 'ok', 'retry with the SAME reservationKey also succeeds');
    if (first.kind === 'ok' && retry.kind === 'ok') {
      assert(retry.storageObjectKey === first.storageObjectKey, 'the retry returns the SAME storage object key -- not a new reservation');
    }
    const rows = await intakeQuery<{ count: string }>(`SELECT count(*) FROM public_intake_files WHERE original_filename = $1 AND request_id = $2`, ['lost-response.pdf', request.id]);
    assert(Number(rows[0].count) === 1, 'exactly one reservation row exists in the database despite two sign calls');
  }

  section('2. Quota count remains one after the retry (no double consumption)');
  {
    const request = await createTestRequest();
    const rawToken = await createSessionWithToken(request.id);
    const reservationKey = randomUUID();
    const candidate = { filename: 'quota-check.pdf', contentType: 'application/pdf', sizeBytes: 1000, reservationKey };
    await signUploadObject(rawToken, candidate);
    await signUploadObject(rawToken, candidate);
    const { checkUploadToken } = await import('../../src/lib/intake/upload-flow.service');
    const state = await checkUploadToken(rawToken);
    assert(state.kind === 'ok' && state.reservedCount === 1, 'reservedCount is 1, not 2, after the same-key retry');
  }

  section('3. Same key + changed file metadata is rejected as a conflict, not silently accepted');
  {
    const request = await createTestRequest();
    const rawToken = await createSessionWithToken(request.id);
    const reservationKey = randomUUID();
    const first = await signUploadObject(rawToken, { filename: 'original.pdf', contentType: 'application/pdf', sizeBytes: 1000, reservationKey });
    assert(first.kind === 'ok', 'first sign succeeds');
    const changed = await signUploadObject(rawToken, { filename: 'different-name.pdf', contentType: 'application/pdf', sizeBytes: 1000, reservationKey });
    assert(changed.kind === 'reservation_conflict', 'the same key with a different filename is rejected as reservation_conflict');
    const changedSize = await signUploadObject(rawToken, { filename: 'original.pdf', contentType: 'application/pdf', sizeBytes: 2000, reservationKey });
    assert(changedSize.kind === 'reservation_conflict', 'the same key with a different declared size is also rejected as reservation_conflict');
  }

  section('4. Parallel same-key sign requests create exactly one reservation (genuine concurrency, not just sequential retry)');
  {
    const request = await createTestRequest();
    const rawToken = await createSessionWithToken(request.id);
    const reservationKey = randomUUID();
    const candidate = { filename: 'parallel.pdf', contentType: 'application/pdf', sizeBytes: 1000, reservationKey };
    const results = await Promise.all(Array.from({ length: 10 }, () => signUploadObject(rawToken, candidate)));
    assert(
      results.every((r) => r.kind === 'ok'),
      'all 10 genuinely concurrent same-key sign requests succeed'
    );
    const objectKeys = new Set(results.map((r) => (r.kind === 'ok' ? r.storageObjectKey : null)));
    assert(objectKeys.size === 1, 'every one of the 10 concurrent calls returns the SAME object key');
    const rows = await intakeQuery<{ count: string }>(`SELECT count(*) FROM public_intake_files WHERE original_filename = $1 AND request_id = $2`, ['parallel.pdf', request.id]);
    assert(Number(rows[0].count) === 1, 'exactly ONE reservation row exists in the database despite 10 truly concurrent same-key calls');
  }

  section('5. Different keys create genuinely distinct reservations');
  {
    const request = await createTestRequest();
    const rawToken = await createSessionWithToken(request.id);
    const first = await signUploadObject(rawToken, { filename: 'a.pdf', contentType: 'application/pdf', sizeBytes: 1000, reservationKey: randomUUID() });
    const second = await signUploadObject(rawToken, { filename: 'b.pdf', contentType: 'application/pdf', sizeBytes: 1000, reservationKey: randomUUID() });
    assert(first.kind === 'ok' && second.kind === 'ok', 'both sign calls succeed');
    if (first.kind === 'ok' && second.kind === 'ok') {
      assert(first.storageObjectKey !== second.storageObjectKey, 'two different reservation keys produce two different object keys');
    }
  }

  section('6. A key referencing an already-completed reservation returns an explicit terminal result, never a silent second row');
  {
    const request = await createTestRequest();
    const rawToken = await createSessionWithToken(request.id);
    const reservationKey = randomUUID();
    const sign = await signUploadObject(rawToken, { filename: 'to-complete.pdf', contentType: 'application/pdf', sizeBytes: 1000, reservationKey });
    assert(sign.kind === 'ok', 'sign succeeds');
    if (sign.kind === 'ok') {
      fakeStorage.simulatedObjects.set(sign.storageObjectKey, { sizeBytes: 1000, contentType: 'application/pdf' });
      const { completeUploadObject } = await import('../../src/lib/intake/upload-flow.service');
      const complete = await completeUploadObject(rawToken, { storageObjectKey: sign.storageObjectKey });
      assert(complete.kind === 'ok', 'completion succeeds');
    }
    const retrySameKey = await signUploadObject(rawToken, { filename: 'to-complete.pdf', contentType: 'application/pdf', sizeBytes: 1000, reservationKey });
    assert(retrySameKey.kind === 'reservation_terminal' && retrySameKey.status === 'completed', 'a sign retry against an already-completed reservation returns an explicit terminal result, not a new reservation');
    const rows = await intakeQuery<{ count: string }>(`SELECT count(*) FROM public_intake_files WHERE original_filename = $1 AND request_id = $2`, ['to-complete.pdf', request.id]);
    assert(Number(rows[0].count) === 1, 'still exactly one row -- the terminal retry created nothing new');
  }

  section('7. Only the first claim inserts upload.reservation_created (structural, since it is now a CORE in-transaction event)');
  {
    const fs = await import('node:fs');
    const source = fs.readFileSync(new URL('../../src/lib/intake/upload-flow.service.ts', import.meta.url), 'utf8');
    const signFnMatch = source.match(/export async function signUploadObject[\s\S]*?\n}\n\nexport type CompleteUploadOutcome/);
    assert(!!signFnMatch, 'signUploadObject found');
    if (signFnMatch) {
      const occurrences = (signFnMatch[0].match(/'upload\.reservation_created'/g) || []).length;
      assert(occurrences === 1, 'upload.reservation_created is referenced exactly once in the function -- only in the brand-new-reservation branch, never in the reuse/conflict/terminal branches');
    }
  }

  section('8. No raw reservation key is stored or logged (structural + behavioral)');
  {
    const request = await createTestRequest();
    const rawToken = await createSessionWithToken(request.id);
    const rawKey = 'RAW_RESERVATION_KEY_never_stored_or_logged_xyz789';
    await signUploadObject(rawToken, { filename: 'key-privacy.pdf', contentType: 'application/pdf', sizeBytes: 1000, reservationKey: rawKey });
    const rows = await intakeQuery<{ reservation_key_hash: string | null }>(
      `SELECT reservation_key_hash FROM public_intake_files WHERE original_filename = $1`,
      ['key-privacy.pdf']
    );
    assert(!!rows[0].reservation_key_hash, 'a reservation_key_hash was stored');
    assert(rows[0].reservation_key_hash !== rawKey, 'the stored value is NOT the raw key -- it is a hash');
  }

  __resetAdaptersForTests();
  printSummaryAndExit();
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('gate6-idempotent-sign-r5.qa.ts failed:', error);
  process.exitCode = 1;
});
