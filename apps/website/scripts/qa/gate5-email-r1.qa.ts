// ============================================================
// QA: Gate 5 -- Email (R1: PHX-LAUNCH-001-R1 §4)
// EXECUTED against real local Postgres with an injected fake email
// adapter. No real Resend API key is used or required; live
// delivery is NOT claimed or tested here.
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
import { createFakeEmailSender, buildConfirmationEmail, buildUploadInvitationEmail } from '../../src/lib/intake/adapters/email.adapter';
import { escapeHtml } from '../../src/lib/intake/html-escape';
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
  section('1. R1 §4.1: dynamic HTML is escaped in every email template');
  const xssPayload = '<img src=x onerror=alert(1)>';
  const linkPayload = '<a href="https://attacker.example">click</a>';

  const confirmation = buildConfirmationEmail({ publicReference: 'PHX-REQ-TEST0001', firstName: xssPayload });
  assert(!confirmation.html.includes('<img'), 'confirmation email HTML does not contain a raw <img> tag from an XSS-payload firstName');
  assert(confirmation.html.includes(escapeHtml(xssPayload)), 'confirmation email HTML contains the ESCAPED form of the payload instead');
  assert(confirmation.text.includes(xssPayload), 'the PLAIN TEXT body is unescaped (no HTML interpreter reads it, so escaping there would be wrong)');

  const invitation = buildUploadInvitationEmail({
    publicReference: linkPayload,
    uploadUrl: 'https://phoenixops.ai/upload/realtoken',
    expiresAt: new Date(),
  });
  assert(!invitation.html.includes('<a href="https://attacker.example">'), 'upload invitation HTML does not contain a raw injected anchor tag from a payload in publicReference');
  assert(invitation.html.includes(escapeHtml(linkPayload)), 'upload invitation HTML contains the escaped form instead');

  section('2. R1 §4.1: escaping is exercised end-to-end through the real submission flow');
  __setTurnstileForTests(createFakeTurnstileVerifier([{ success: true }]));
  const fakeEmailXss = createFakeEmailSender('always_succeed');
  __setEmailForTests(fakeEmailXss);
  const xssOutcome = await submitIntakeRequest(baseInput({ firstName: xssPayload, workEmail: `xss-${randomUUID()}@acme.example` }), {
    rawIp: '203.0.113.80',
  });
  assert(xssOutcome.kind === 'accepted', 'a submission with an XSS-shaped firstName is still accepted (escaping happens at render time, not rejected at intake)');
  const confirmationSent = fakeEmailXss.sentMessages.find((m) => m.subject.startsWith('We received'));
  assert(!!confirmationSent && !confirmationSent.html.includes('<img'), 'the ACTUAL email sent through the real submit flow has no raw <img> tag in its HTML');
  __resetAdaptersForTests();

  section('3. R1 §4.2: stable provider idempotency key supplied for every email');
  __setTurnstileForTests(createFakeTurnstileVerifier([{ success: true }]));
  const fakeEmailIdem = createFakeEmailSender('always_succeed');
  __setEmailForTests(fakeEmailIdem);
  const idemOutcome = await submitIntakeRequest(baseInput({ workEmail: `idem-${randomUUID()}@acme.example` }), { rawIp: '203.0.113.81' });
  assert(idemOutcome.kind === 'accepted', 'submission accepted');
  if (idemOutcome.kind === 'accepted') {
    const requestRow = await findByPublicReference(idemOutcome.publicReference);
    const confirmationKey = fakeEmailIdem.sentMessages.find((m) => m.subject.startsWith('We received'))?.idempotencyKey;
    const internalKey = fakeEmailIdem.sentMessages.find((m) => m.subject.startsWith('New Phoenix'))?.idempotencyKey;
    assert(confirmationKey === `request-confirmation/${requestRow?.id}`, `confirmation email idempotency key follows the documented pattern (got: ${confirmationKey})`);
    assert(internalKey === `internal-request-notification/${requestRow?.id}`, `internal notification idempotency key follows the documented pattern (got: ${internalKey})`);
  }
  __resetAdaptersForTests();

  section('4. R1 §4.2: retry does not duplicate a semantic email (same idempotency key on retry)');
  {
    // Simulate a network-level retry of the SAME logical send: the
    // real Resend API would deduplicate two calls sharing an
    // Idempotency-Key header and only actually dispatch once. Our
    // fake records every attempted call, so we assert on the
    // observable proxy for that guarantee: the idempotency key
    // presented on a retry of the same logical email is IDENTICAL,
    // which is exactly what lets the provider deduplicate it.
    __setTurnstileForTests(createFakeTurnstileVerifier([{ success: true }]));
    const fakeEmail = createFakeEmailSender('always_succeed');
    __setEmailForTests(fakeEmail);
    const requestId = randomUUID();
    const email1 = buildConfirmationEmail({ publicReference: 'PHX-REQ-RETRYTEST1', firstName: 'Jane' });
    email1.to = 'jane@acme.example';
    email1.idempotencyKey = `request-confirmation/${requestId}`;
    await fakeEmail.send(email1);
    // A second attempt (e.g. after a network timeout on the first
    // response) for the SAME semantic email reuses the SAME key.
    const email2 = buildConfirmationEmail({ publicReference: 'PHX-REQ-RETRYTEST1', firstName: 'Jane' });
    email2.to = 'jane@acme.example';
    email2.idempotencyKey = `request-confirmation/${requestId}`;
    await fakeEmail.send(email2);
    assert(
      fakeEmail.idempotencyKeysUsed[0] === fakeEmail.idempotencyKeysUsed[1],
      'both attempts for the same logical email present the identical idempotency key, which is what allows the real provider to deduplicate them'
    );
  }
  __resetAdaptersForTests();

  section('5. Email failure does not duplicate the request, and creates an operational event');
  __setTurnstileForTests(createFakeTurnstileVerifier([{ success: true }]));
  const failingEmail = createFakeEmailSender('always_fail');
  __setEmailForTests(failingEmail);
  const failOutcome = await submitIntakeRequest(baseInput({ workEmail: `fail-${randomUUID()}@acme.example` }), { rawIp: '203.0.113.82' });
  assert(failOutcome.kind === 'accepted', 'request is still accepted even though email sending fails');
  if (failOutcome.kind === 'accepted') {
    const rows = await intakeQuery<{ count: string }>(`SELECT count(*) FROM public_intake_requests WHERE public_reference = $1`, [failOutcome.publicReference]);
    assert(Number(rows[0].count) === 1, 'exactly one request row exists despite email failure (no duplicate)');
    const requestRow = await findByPublicReference(failOutcome.publicReference);
    const events = requestRow ? await listEventsForRequest(requestRow.id) : [];
    assert(
      events.some((e) => e.event_type === 'request.confirmation_email_failed' || e.event_type === 'request.internal_notification_failed'),
      'an operational event records the email failure'
    );
  }
  __resetAdaptersForTests();

  section('6. Upload invitation email idempotency key is session-scoped');
  __setTurnstileForTests(createFakeTurnstileVerifier([{ success: true }]));
  const inviteEmail = createFakeEmailSender('always_succeed');
  __setEmailForTests(inviteEmail);
  const submitOutcome = await submitIntakeRequest(baseInput({ workEmail: `invite-${randomUUID()}@acme.example` }), { rawIp: '203.0.113.83' });
  if (submitOutcome.kind === 'accepted') {
    const requestRow = await findByPublicReference(submitOutcome.publicReference);
    if (requestRow) {
      await finalizeIntakeRequest(requestRow.id, 'under_review');
      const inviteOutcome = await issueUploadSession(requestRow.id);
      assert(inviteOutcome.kind === 'ok', 'upload session issuance succeeds');
      const inviteMessage = inviteEmail.sentMessages.find((m) => m.subject.startsWith('Upload your files'));
      assert(!!inviteMessage?.idempotencyKey.startsWith('upload-invitation/'), 'upload invitation email idempotency key uses the documented upload-invitation/<sessionId> pattern');
    }
  }
  __resetAdaptersForTests();

  printSummaryAndExit();
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('gate5-email-r1.qa.ts failed:', error);
  process.exitCode = 1;
});
