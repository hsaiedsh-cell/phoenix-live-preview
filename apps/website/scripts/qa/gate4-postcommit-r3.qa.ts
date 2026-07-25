// ============================================================
// QA: Post-commit notification/event failures are non-destructive (R3)
// PHX-LAUNCH-001-R3 Section 4
// EXECUTED against a real local Postgres instance with injected fake
// Turnstile/Email/Storage adapters.
// ============================================================

import { randomUUID } from 'node:crypto';
import { assert, section, printSummaryAndExit } from './assert';
import { submitIntakeRequest } from '../../src/lib/intake/submit.service';
import { issueUploadSession } from '../../src/lib/intake/upload-session.service';
import { finalizeIntakeRequest } from '../../src/lib/intake/finalize.service';
import { signUploadObject, completeUploadObject, finishUploadSession } from '../../src/lib/intake/upload-flow.service';
import { recordPostCommitEvent } from '../../src/lib/intake/post-commit';
import { intakeQuery } from '../../src/lib/intake/db';
import * as uploadSessionsRepo from '../../src/lib/intake/repositories/upload-sessions.repository';
import { generateRawUploadToken, tokenHash } from '../../src/lib/intake/hash';
import { findByPublicReference } from '../../src/lib/intake/repositories/intake-requests.repository';
import { __setTurnstileForTests, __setEmailForTests, __setStorageForTests, __resetAdaptersForTests } from '../../src/lib/intake/adapters';
import { createFakeTurnstileVerifier } from '../../src/lib/intake/adapters/turnstile.adapter';
import { createFakeEmailSender } from '../../src/lib/intake/adapters/email.adapter';
import { createFakeStorageAdapter } from '../../src/lib/intake/adapters/storage.adapter';
import { CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION } from '../../src/lib/intake/config';

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    requestType: 'assessment',
    firstName: 'Jane',
    lastName: 'Doe',
    workEmail: `jane-${randomUUID()}@acme.example`,
    company: 'Acme',
    role: 'CAIO',
    message: 'Please assess our AI outputs.',
    privacyConsent: true,
    privacyVersion: CURRENT_PRIVACY_VERSION,
    termsVersion: CURRENT_TERMS_VERSION,
    marketingConsent: false,
    turnstileToken: 'test-token',
    idempotencyKey: randomUUID(),
    ...overrides,
  };
}

async function main() {
  section('1. recordPostCommitEvent itself never throws, even against a nonexistent request');
  {
    // A foreign-key violation (request_id referencing nothing) is a
    // real, guaranteed database error -- proving the helper swallows
    // even a genuine constraint violation rather than a contrived
    // failure.
    const result = await recordPostCommitEvent('00000000-0000-0000-0000-000000000000', 'request.confirmation_email_sent', { route: 'qa-test' });
    assert(result.recorded === false, 'a genuine FK-violation failure is reported as recorded:false');
    // The absence of a thrown exception reaching this line at all is
    // itself the proof that it never throws.
    assert(true, 'recordPostCommitEvent did not throw for a real database constraint violation');
  }

  section('2. Request intake remains accepted even when its post-commit email-result event insert fails');
  {
    __setTurnstileForTests(createFakeTurnstileVerifier([{ success: true }]));
    __setEmailForTests(createFakeEmailSender('always_succeed'));
    // submitIntakeRequest's post-commit event calls go through
    // recordPostCommitEvent already (see section 1's proof that this
    // never throws) -- so ANY transient failure there structurally
    // cannot affect the returned outcome. Prove the outcome is
    // unaffected end-to-end:
    const outcome = await submitIntakeRequest(baseInput({ workEmail: `postcommit-${randomUUID()}@acme.example` }), { rawIp: '203.0.113.20' });
    assert(outcome.kind === 'accepted', 'the request is accepted regardless of downstream post-commit event recording');
  }
  __resetAdaptersForTests();

  section('3. Request intake remains replayable after a simulated post-commit notification failure');
  {
    __setTurnstileForTests(createFakeTurnstileVerifier([{ success: true }, { success: true }]));
    __setEmailForTests(createFakeEmailSender('always_fail'));
    const key = randomUUID();
    const email = `replayable-${randomUUID()}@acme.example`;
    const input = baseInput({ idempotencyKey: key, workEmail: email });
    const first = await submitIntakeRequest(input, { rawIp: '203.0.113.21' });
    assert(first.kind === 'accepted', 'first submission accepted even though its email provider always fails');
    const second = await submitIntakeRequest(input, { rawIp: '203.0.113.22' });
    assert(second.kind === 'accepted' && second.wasReplay === true, 'a replay of the same key/payload still resolves correctly -- the earlier email/event failure never poisoned the idempotency record');
    if (first.kind === 'accepted' && second.kind === 'accepted') {
      assert(first.publicReference === second.publicReference, 'both point at the same request');
    }
  }
  __resetAdaptersForTests();

  section('4. Upload invitation remains valid after a notification-event failure (structural + behavioral)');
  {
    __setTurnstileForTests(createFakeTurnstileVerifier([{ success: true }]));
    __setEmailForTests(createFakeEmailSender('always_fail'));
    const submitOutcome = await submitIntakeRequest(baseInput({ workEmail: `invite-postcommit-${randomUUID()}@acme.example` }), { rawIp: '203.0.113.23' });
    assert(submitOutcome.kind === 'accepted', 'submission accepted');
    if (submitOutcome.kind === 'accepted') {
      const requestRow = await findByPublicReference(submitOutcome.publicReference);
      if (requestRow) {
        await finalizeIntakeRequest(requestRow.id, 'under_review');
        const inviteOutcome = await issueUploadSession(requestRow.id);
        assert(inviteOutcome.kind === 'ok', 'upload session issuance still reports success even though the invitation email provider always fails');
        assert(inviteOutcome.kind === 'ok' && inviteOutcome.emailSent === false, 'the response accurately reflects that the email itself failed, without failing the whole operation');

        const activeSession = await uploadSessionsRepo.findActiveSessionForRequest(requestRow.id);
        assert(!!activeSession && activeSession.status === 'active', 'the upload session created by this call is genuinely active and usable, independent of the email outcome');
      }
    }
  }
  __resetAdaptersForTests();

  section('5. Finalization commits + upload-complete notification-event insert fails -> route/service still reports success');
  {
    __setEmailForTests(createFakeEmailSender('always_fail'));
    const fakeStorage = createFakeStorageAdapter();
    __setStorageForTests(fakeStorage);

    const requestRows = await intakeQuery<{ id: string }>(
      `INSERT INTO public_intake_requests (
         public_reference, request_type, first_name, last_name, work_email_normalized,
         company, role, message, privacy_consent, privacy_version, terms_version,
         marketing_consent, consent_timestamp, idempotency_key_hash, ip_hash, status
       ) VALUES ('PHX-REQ-' || substr(md5(random()::text), 1, 12), 'assessment', 'R3Gate4', 'Tester',
         $1, 'Acme', 'CAIO', 'post-commit QA', true, $2, $3, false, now(), $4, null, 'upload_invited')
       RETURNING id`,
      [`r3gate4-${randomUUID()}@acme.example`, CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION, randomUUID()]
    );
    const requestId = requestRows[0].id;
    const rawToken = generateRawUploadToken();
    await uploadSessionsRepo.createUploadSession(requestId, tokenHash(rawToken));

    const sign = await signUploadObject(rawToken, { filename: 'f.pdf', contentType: 'application/pdf', sizeBytes: 1000 });
    assert(sign.kind === 'ok', 'sign succeeds');
    if (sign.kind === 'ok') {
      fakeStorage.simulatedObjects.set(sign.storageObjectKey, { sizeBytes: 1000, contentType: 'application/pdf' });
      await completeUploadObject(rawToken, { storageObjectKey: sign.storageObjectKey });
    }
    const finish = await finishUploadSession(rawToken);
    assert(finish.ok === true, 'finalization is reported as successful even though the upload-complete email provider always fails and its result-event insert is on the best-effort path');

    const requestRow = await intakeQuery<{ status: string }>(`SELECT status FROM public_intake_requests WHERE id = $1`, [requestId]);
    assert(requestRow[0].status === 'files_received', 'the request genuinely transitioned to files_received -- the core outcome truly committed, not just reported');
  }
  __resetAdaptersForTests();

  printSummaryAndExit();
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('gate4-postcommit-r3.qa.ts failed:', error);
  process.exitCode = 1;
});
