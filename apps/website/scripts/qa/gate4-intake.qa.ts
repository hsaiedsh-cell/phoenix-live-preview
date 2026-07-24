// ============================================================
// QA: Gate 4 — Intake security
// PHX-LAUNCH-001 — EXECUTED against a real, local, isolated
// PostgreSQL instance (see PHX-LAUNCH-001-FINAL-IMPLEMENTATION-
// REPORT.md). Turnstile and Email are injected fakes — this file
// never calls the real Cloudflare or Resend APIs. Every assertion
// below is genuinely run, not simulated in prose.
//
// Requires env vars (see scripts/qa/README.md):
//   INTAKE_DATABASE_URL, INTAKE_HASH_SECRET, INTAKE_INTERNAL_TO_EMAIL
// ============================================================

import { randomUUID } from 'node:crypto';
import { assert, section, printSummaryAndExit } from './assert';
import { submitIntakeRequest } from '../../src/lib/intake/submit.service';
import { isValidPublicReference } from '../../src/lib/intake/reference';
import { intakeQuery } from '../../src/lib/intake/db';
import {
  __setTurnstileForTests,
  __setEmailForTests,
  __resetAdaptersForTests,
} from '../../src/lib/intake/adapters';
import { createFakeTurnstileVerifier } from '../../src/lib/intake/adapters/turnstile.adapter';
import { createFakeEmailSender } from '../../src/lib/intake/adapters/email.adapter';
import { CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION } from '../../src/lib/intake/config';
import { genericErrorResponse } from '../../src/lib/intake/http';
import { readBoundedJsonBody } from '../../src/lib/intake/http';

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
  section('1. Valid intake accepted');
  __setTurnstileForTests(createFakeTurnstileVerifier([{ success: true }]));
  const fakeEmail1 = createFakeEmailSender('always_succeed');
  __setEmailForTests(fakeEmail1);
  const validInput = baseInput();
  const outcome1 = await submitIntakeRequest(validInput, { rawIp: '203.0.113.10' });
  assert(outcome1.kind === 'accepted', 'valid submission is accepted');
  if (outcome1.kind === 'accepted') {
    assert(isValidPublicReference(outcome1.publicReference), 'accepted response has a valid public reference format');
    assert(outcome1.wasReplay === false, 'first submission is not marked as a replay');
  }
  assert(fakeEmail1.sentMessages.length === 2, 'exactly 2 emails requested (confirmation + internal)');
  __resetAdaptersForTests();

  section('2. Invalid fields rejected');
  __setTurnstileForTests(createFakeTurnstileVerifier([{ success: true }]));
  __setEmailForTests(createFakeEmailSender());
  const invalidOutcome = await submitIntakeRequest(baseInput({ workEmail: 'not-an-email' }), { rawIp: '203.0.113.11' });
  assert(invalidOutcome.kind === 'validation_error', 'malformed work email rejected with validation_error');
  __resetAdaptersForTests();

  section('3. Missing consent rejected');
  __setTurnstileForTests(createFakeTurnstileVerifier([{ success: true }]));
  __setEmailForTests(createFakeEmailSender());
  const noConsentOutcome = await submitIntakeRequest(baseInput({ privacyConsent: false }), { rawIp: '203.0.113.12' });
  assert(noConsentOutcome.kind === 'validation_error', 'missing/false privacyConsent rejected with validation_error');
  __resetAdaptersForTests();

  section('4. Invalid Turnstile rejected');
  __setTurnstileForTests(createFakeTurnstileVerifier([{ success: false, reason: 'invalid_token' }]));
  __setEmailForTests(createFakeEmailSender());
  const turnstileBadOutcome = await submitIntakeRequest(baseInput(), { rawIp: '203.0.113.13' });
  assert(turnstileBadOutcome.kind === 'turnstile_rejected', 'invalid Turnstile token rejected distinctly');
  __resetAdaptersForTests();

  section('5. Turnstile provider failure handled safely (not treated as invalid)');
  __setTurnstileForTests(createFakeTurnstileVerifier([{ success: false, reason: 'provider_error' }]));
  __setEmailForTests(createFakeEmailSender());
  const turnstileProviderErrorOutcome = await submitIntakeRequest(baseInput(), { rawIp: '203.0.113.14' });
  assert(
    turnstileProviderErrorOutcome.kind === 'turnstile_provider_error',
    'Turnstile provider failure surfaces as a distinct, safe outcome (no crash, no false rejection)'
  );
  __resetAdaptersForTests();

  section('6. Rate limit by IP hash enforced');
  __setTurnstileForTests(createFakeTurnstileVerifier([{ success: true }]));
  __setEmailForTests(createFakeEmailSender());
  const sharedIp = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;
  let ipLimited = false;
  for (let i = 0; i < 6; i += 1) {
    const outcome = await submitIntakeRequest(baseInput({ workEmail: `ip-test-${i}-${randomUUID()}@acme.example` }), {
      rawIp: sharedIp,
    });
    if (outcome.kind === 'rate_limited' && outcome.scope === 'ip') ipLimited = true;
  }
  assert(ipLimited, '6th submission from the same IP within the hour window is rate-limited (limit is 5/hour)');
  __resetAdaptersForTests();

  section('7. Rate limit by email enforced');
  __setTurnstileForTests(createFakeTurnstileVerifier([{ success: true }]));
  __setEmailForTests(createFakeEmailSender());
  const sharedEmail = `email-test-${randomUUID()}@acme.example`;
  let emailLimited = false;
  for (let i = 0; i < 4; i += 1) {
    const outcome = await submitIntakeRequest(baseInput({ workEmail: sharedEmail }), {
      rawIp: `198.51.100.${200 + i}`,
    });
    if (outcome.kind === 'rate_limited' && outcome.scope === 'email') emailLimited = true;
  }
  assert(emailLimited, '4th submission with the same email within the hour window is rate-limited (limit is 3/hour)');
  __resetAdaptersForTests();

  section('8/9. Idempotent replay returns same request; duplicate row not created');
  __setTurnstileForTests(createFakeTurnstileVerifier([{ success: true }, { success: true }]));
  __setEmailForTests(createFakeEmailSender());
  const idemKey = randomUUID();
  const replayInput = baseInput({ idempotencyKey: idemKey, workEmail: `replay-${randomUUID()}@acme.example` });
  const first = await submitIntakeRequest(replayInput, { rawIp: '203.0.113.20' });
  const second = await submitIntakeRequest(replayInput, { rawIp: '203.0.113.21' });
  assert(first.kind === 'accepted' && second.kind === 'accepted', 'both calls return accepted');
  if (first.kind === 'accepted' && second.kind === 'accepted') {
    assert(first.publicReference === second.publicReference, 'replay returns the SAME public reference, not a new one');
    assert(second.wasReplay === true, 'second call is marked as a replay');
  }
  const idemHashRows = await intakeQuery<{ count: string }>(
    `SELECT count(*) FROM public_intake_requests WHERE idempotency_key_hash = (
       SELECT idempotency_key_hash FROM public_intake_requests WHERE public_reference = $1
     )`,
    [first.kind === 'accepted' ? first.publicReference : '']
  );
  assert(Number(idemHashRows[0].count) === 1, 'exactly one database row exists for this idempotency key (no duplicate)');
  __resetAdaptersForTests();

  section('10. Oversized / malformed body rejected before reaching validation');
  const oversizedRequest = new Request('https://example.test/api/intake', {
    method: 'POST',
    headers: { 'content-length': String(1024 * 1024) },
    body: JSON.stringify({ hello: 'world' }),
  });
  const oversizedResult = await readBoundedJsonBody(oversizedRequest);
  assert(oversizedResult.ok === false, 'request declaring a 1MB content-length is rejected by size check alone');

  const malformedRequest = new Request('https://example.test/api/intake', {
    method: 'POST',
    body: '{not valid json',
  });
  const malformedResult = await readBoundedJsonBody(malformedRequest);
  assert(malformedResult.ok === false, 'malformed JSON body is rejected');

  section('11. Public error responses contain no sensitive detail');
  const genericResponse = genericErrorResponse(422, 'Some fields could not be validated.', 'req-123');
  const genericBody = (await genericResponse.json()) as Record<string, unknown>;
  const bodyKeys = Object.keys(genericBody).sort();
  assert(
    JSON.stringify(bodyKeys) === JSON.stringify(['error', 'requestId']),
    `generic error body has ONLY {error, requestId} keys, nothing else (got: ${bodyKeys.join(',')})`
  );

  section('12. Raw IP is never stored — only its HMAC hash');
  const ipCheckInput = baseInput({ workEmail: `ipcheck-${randomUUID()}@acme.example` });
  __setTurnstileForTests(createFakeTurnstileVerifier([{ success: true }]));
  __setEmailForTests(createFakeEmailSender());
  const rawIpUsed = '203.0.113.99';
  const ipCheckOutcome = await submitIntakeRequest(ipCheckInput, { rawIp: rawIpUsed });
  if (ipCheckOutcome.kind === 'accepted') {
    const rows = await intakeQuery<{ ip_hash: string | null }>(
      'SELECT ip_hash FROM public_intake_requests WHERE public_reference = $1',
      [ipCheckOutcome.publicReference]
    );
    const storedHash = rows[0]?.ip_hash;
    assert(storedHash !== null && storedHash !== rawIpUsed, 'stored ip_hash is not equal to the raw IP');
    assert(!!storedHash && /^[0-9a-f]{64}$/.test(storedHash), 'stored ip_hash looks like a 64-hex-char SHA-256 HMAC, not raw data');
  } else {
    assert(false, `expected acceptance for ip-hash check but got ${ipCheckOutcome.kind}`);
  }
  __resetAdaptersForTests();

  printSummaryAndExit();
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('gate4-intake.qa.ts failed:', error);
  process.exitCode = 1;
});
