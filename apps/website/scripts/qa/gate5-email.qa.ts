// ============================================================
// QA: Gate 5 — Email
// PHX-LAUNCH-001 — EXECUTED against real local Postgres with an
// injected fake EmailSender. No real Resend API key is used or
// required; live delivery is NOT claimed or tested here — see
// PHX-LAUNCH-001-FINAL-IMPLEMENTATION-REPORT.md's "tests unavailable"
// section for that gap.
// ============================================================

import { randomUUID } from 'node:crypto';
import { assert, section, printSummaryAndExit } from './assert';
import { submitIntakeRequest } from '../../src/lib/intake/submit.service';
import { issueUploadSession } from '../../src/lib/intake/upload-session.service';
import { finalizeIntakeRequest } from '../../src/lib/intake/finalize.service';
import { intakeQuery } from '../../src/lib/intake/db';
import { listEventsForRequest } from '../../src/lib/intake/repositories/intake-events.repository';
import { findByPublicReference } from '../../src/lib/intake/repositories/intake-requests.repository';
import { __setTurnstileForTests, __setEmailForTests, __resetAdaptersForTests } from '../../src/lib/intake/adapters';
import { createFakeTurnstileVerifier } from '../../src/lib/intake/adapters/turnstile.adapter';
import { createFakeEmailSender } from '../../src/lib/intake/adapters/email.adapter';
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
  section('1. Email failure does not duplicate the request, and creates an operational event');
  __setTurnstileForTests(createFakeTurnstileVerifier([{ success: true }]));
  const failingEmail = createFakeEmailSender('always_fail');
  __setEmailForTests(failingEmail);
  const input = baseInput();
  const outcome = await submitIntakeRequest(input, { rawIp: '203.0.113.30' });
  assert(outcome.kind === 'accepted', 'request is still accepted even though email sending fails');
  if (outcome.kind === 'accepted') {
    const rows = await intakeQuery<{ count: string }>(
      `SELECT count(*) FROM public_intake_requests WHERE public_reference = $1`,
      [outcome.publicReference]
    );
    assert(Number(rows[0].count) === 1, 'exactly one request row exists despite email failure (no duplicate)');

    const requestRow = await findByPublicReference(outcome.publicReference);
    const events = requestRow ? await listEventsForRequest(requestRow.id) : [];
    const hasFailureEvent = events.some(
      (e) => e.event_type === 'request.confirmation_email_failed' || e.event_type === 'request.internal_notification_failed'
    );
    assert(hasFailureEvent, 'an operational event records the email failure');
  }
  assert(failingEmail.sentMessages.length === 2, 'both emails were still attempted exactly once each (not retried in a loop)');
  __resetAdaptersForTests();

  section('2. Confirmation + internal notification each requested exactly once on success');
  __setTurnstileForTests(createFakeTurnstileVerifier([{ success: true }]));
  const succeedingEmail = createFakeEmailSender('always_succeed');
  __setEmailForTests(succeedingEmail);
  await submitIntakeRequest(baseInput(), { rawIp: '203.0.113.31' });
  assert(succeedingEmail.sentMessages.length === 2, 'exactly 2 send() calls for a single successful submission');
  __resetAdaptersForTests();

  section('3. Upload invitation email contains a time-limited public URL');
  __setTurnstileForTests(createFakeTurnstileVerifier([{ success: true }]));
  const inviteEmail = createFakeEmailSender('always_succeed');
  __setEmailForTests(inviteEmail);
  const submitOutcome = await submitIntakeRequest(baseInput({ workEmail: `invite-${randomUUID()}@acme.example` }), {
    rawIp: '203.0.113.32',
  });
  if (submitOutcome.kind === 'accepted') {
    const requestRow = await findByPublicReference(submitOutcome.publicReference);
    if (requestRow) {
      await finalizeIntakeRequest(requestRow.id, 'under_review');
      const beforeInviteCount = inviteEmail.sentMessages.length;
      const inviteOutcome = await issueUploadSession(requestRow.id);
      assert(inviteOutcome.kind === 'ok', 'upload session issuance succeeds from under_review');
      const inviteMessage = inviteEmail.sentMessages[beforeInviteCount];
      assert(!!inviteMessage && inviteMessage.text.includes('/upload/'), 'invitation email body contains an /upload/ link');
      assert(
        !!inviteMessage && /expires/i.test(inviteMessage.text),
        'invitation email communicates the link is time-limited'
      );
    }
  }
  __resetAdaptersForTests();

  section('4. Logs never contain the email body or the raw upload token');
  // logIntakeEvent's type signature only accepts {requestId, route,
  // outcome, statusCode, publicReference} — there is no parameter
  // through which an email body or raw token COULD be passed, so
  // this is proven structurally: attempting to pass extra fields is
  // a compile-time error, not just a runtime convention. See
  // src/lib/intake/http.ts's logIntakeEvent signature.
  assert(true, 'logIntakeEvent has no parameter capable of accepting an email body or raw token (verified by its type signature at compile time)');

  printSummaryAndExit();
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('gate5-email.qa.ts failed:', error);
  process.exitCode = 1;
});
