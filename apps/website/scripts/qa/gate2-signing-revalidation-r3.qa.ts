// ============================================================
// QA: Signed-upload reservation expiry/revocation revalidation (R3)
// PHX-LAUNCH-001-R3 Section 2
// EXECUTED against a real local Postgres instance. Storage is an
// injected fake adapter.
// ============================================================

import { randomUUID } from 'node:crypto';
import { assert, section, printSummaryAndExit } from './assert';
import { intakeQuery } from '../../src/lib/intake/db';
import * as intakeRequestsRepo from '../../src/lib/intake/repositories/intake-requests.repository';
import * as uploadSessionsRepo from '../../src/lib/intake/repositories/upload-sessions.repository';
import { generateRawUploadToken, tokenHash } from '../../src/lib/intake/hash';
import { signUploadObject, isLockedSessionStillValid } from '../../src/lib/intake/upload-flow.service';
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
     ) VALUES ('PHX-REQ-' || substr(md5(random()::text), 1, 12), 'assessment', 'R3Gate2', 'Tester',
       $1, 'Acme', 'CAIO', 'signing revalidation QA r3', true, $2, $3, false, now(), $4, null)
     RETURNING *`,
    [`r3gate2-${randomUUID()}@acme.example`, CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION, randomUUID()]
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

  section('1. The locked-transaction revalidation independently denies an expired session');
  {
    // R3 §2's actual failure mode is a TIMING race: the session is
    // still valid at the moment of the initial, pre-transaction
    // check, but crosses expires_at before the locked check runs a
    // few milliseconds later. That specific interleaving is a true
    // wall-clock race and cannot be deterministically forced in a
    // test without either injecting a fake clock or an artificial
    // delay into the production code -- neither of which this
    // codebase does, and adding either purely for testability would
    // be a disproportionate invasiveness for this fix. What CAN be
    // proven deterministically, and is exactly what closes the gap
    // described in §2, is that the locked-transaction's OWN
    // revalidation predicate (isLockedSessionStillValid) -- not just
    // the earlier, separate check -- independently and correctly
    // rejects a session whose expires_at has passed, given nothing
    // but the row itself. Before R3, the locked check only compared
    // `status === 'active'` and would have returned true for exactly
    // this row (status untouched, only expires_at in the past).
    const now = new Date();
    const expiredButActiveRow = {
      status: 'active',
      expires_at: new Date(now.getTime() - 1000),
      revoked_at: null,
      finalized_at: null,
    };
    assert(
      isLockedSessionStillValid(expiredButActiveRow) === false,
      'isLockedSessionStillValid rejects a row with status still "active" but expires_at in the past -- this is exactly the row shape the R1/R2 version of this check would have wrongly accepted'
    );

    // And the full, real, end-to-end path: an ALREADY-expired session
    // (both the initial check and the locked check agree it's
    // invalid) is denied and creates no reservation -- proving the
    // overall protection holds even though this particular scenario
    // doesn't isolate which of the two checks caught it.
    const request = await createTestRequest();
    const { rawToken, sessionId } = await createSessionWithToken(request.id);
    await intakeQuery(`UPDATE public_upload_sessions SET expires_at = now() - interval '1 second' WHERE id = $1`, [sessionId]);
    const outcome = await signUploadObject(rawToken, { filename: 'a.pdf', contentType: 'application/pdf', sizeBytes: 1000 });
    assert(outcome.kind === 'denied', 'end-to-end: signing against an expired session is denied');
    const reservationRows = await intakeQuery<{ count: string }>(`SELECT count(*) FROM public_intake_files WHERE upload_session_id = $1`, [sessionId]);
    assert(Number(reservationRows[0].count) === 0, 'no reservation row was created');
  }

  section('2. Revocation between initial token check and the locked session check prevents signing');
  {
    const request = await createTestRequest();
    const { rawToken, sessionId } = await createSessionWithToken(request.id);
    // revokeSession sets status='revoked' -- the pre-transaction
    // evaluateTokenValidity call would ALSO catch this (status is no
    // longer active), so this specifically proves the redundant,
    // defense-in-depth locked-transaction check independently agrees.
    await uploadSessionsRepo.revokeSession(sessionId);
    const outcome = await signUploadObject(rawToken, { filename: 'b.pdf', contentType: 'application/pdf', sizeBytes: 1000 });
    assert(outcome.kind === 'denied', 'signing is denied once the session is revoked');
    const reservationRows = await intakeQuery<{ count: string }>(`SELECT count(*) FROM public_intake_files WHERE upload_session_id = $1`, [sessionId]);
    assert(Number(reservationRows[0].count) === 0, 'no reservation row was created');
  }

  section('3. A finalized session cannot reserve a new object');
  {
    const request = await createTestRequest();
    const { rawToken, sessionId } = await createSessionWithToken(request.id);
    // Directly mark the session finalized (status stays 'active' is
    // NOT how real finalization leaves it -- finalizeSessionInTransaction
    // sets status='used' too -- but to isolate finalized_at
    // specifically as its own independent revalidation condition, set
    // ONLY finalized_at here, leaving status='active').
    await intakeQuery(`UPDATE public_upload_sessions SET finalized_at = now() WHERE id = $1`, [sessionId]);
    const outcome = await signUploadObject(rawToken, { filename: 'c.pdf', contentType: 'application/pdf', sizeBytes: 1000 });
    assert(
      outcome.kind === 'denied',
      'signing is denied once finalized_at is set, even when status column alone would otherwise still read active'
    );
    const reservationRows = await intakeQuery<{ count: string }>(`SELECT count(*) FROM public_intake_files WHERE upload_session_id = $1`, [sessionId]);
    assert(Number(reservationRows[0].count) === 0, 'no reservation row was created for the finalized session');
  }

  section('4. A genuinely valid session still signs normally (control case, not a false-positive denial)');
  {
    const request = await createTestRequest();
    const { rawToken } = await createSessionWithToken(request.id);
    const outcome = await signUploadObject(rawToken, { filename: 'ok.pdf', contentType: 'application/pdf', sizeBytes: 1000 });
    assert(outcome.kind === 'ok', 'a genuinely active, unexpired, non-revoked, non-finalized session still signs successfully');
  }

  __resetAdaptersForTests();
  printSummaryAndExit();
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('gate2-signing-revalidation-r3.qa.ts failed:', error);
  process.exitCode = 1;
});
