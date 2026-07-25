// ============================================================
// QA: Gate 4 -- Intake security (R1: PHX-LAUNCH-001-R1 §2)
// EXECUTED against a real local Postgres instance. Turnstile and
// Email are injected fakes -- this file never calls the real
// Cloudflare or Resend APIs. Every assertion below is genuinely run.
//
// Requires env vars: INTAKE_DATABASE_URL, INTAKE_HASH_SECRET,
// INTAKE_INTERNAL_TO_EMAIL
// ============================================================

import { randomUUID } from 'node:crypto';
import { assert, section, printSummaryAndExit } from './assert';
import { submitIntakeRequest } from '../../src/lib/intake/submit.service';
import { isValidPublicReference } from '../../src/lib/intake/reference';
import { intakeQuery } from '../../src/lib/intake/db';
import { __setTurnstileForTests, __setEmailForTests, __resetAdaptersForTests } from '../../src/lib/intake/adapters';
import { createFakeTurnstileVerifier } from '../../src/lib/intake/adapters/turnstile.adapter';
import { createFakeEmailSender } from '../../src/lib/intake/adapters/email.adapter';
import { CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION } from '../../src/lib/intake/config';
import { genericErrorResponse, readBoundedJsonBody, requireJsonContentType, isCrossSiteBrowserRequest, isOriginAllowed } from '../../src/lib/intake/http';

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
  assert(
    fakeEmail1.idempotencyKeysUsed.every((k) => k.length > 0) && new Set(fakeEmail1.idempotencyKeysUsed).size === 2,
    'each email carries a distinct, non-empty provider idempotency key'
  );
  __resetAdaptersForTests();

  section('2. Invalid fields rejected');
  __setTurnstileForTests(createFakeTurnstileVerifier([{ success: true }]));
  __setEmailForTests(createFakeEmailSender());
  const invalidOutcome = await submitIntakeRequest(baseInput({ workEmail: 'not-an-email' }), { rawIp: '203.0.113.11' });
  assert(invalidOutcome.kind === 'validation_error', 'malformed work email rejected with validation_error');
  __resetAdaptersForTests();

  section('3. R1 §2.1: replay resolution happens BEFORE Turnstile is consumed');
  {
    // Fake Turnstile: succeeds on the 1st call only; every subsequent
    // call would fail, simulating a real single-use token already
    // being spent. If replay resolution correctly runs before
    // Turnstile, the 2nd identical submission must NEVER call
    // verify() a second time at all.
    const turnstile = createFakeTurnstileVerifier([{ success: true }, { success: false, reason: 'invalid_token' }]);
    __setTurnstileForTests(turnstile);
    const fakeEmail = createFakeEmailSender();
    __setEmailForTests(fakeEmail);
    const replayInput = baseInput({ workEmail: `replay-before-turnstile-${randomUUID()}@acme.example` });
    const first = await submitIntakeRequest(replayInput, { rawIp: '203.0.113.40' });
    const second = await submitIntakeRequest(replayInput, { rawIp: '203.0.113.41' });
    assert(first.kind === 'accepted' && second.kind === 'accepted', 'both calls return accepted');
    if (first.kind === 'accepted' && second.kind === 'accepted') {
      assert(first.publicReference === second.publicReference, 'replay returns the SAME public reference');
      assert(second.wasReplay === true, 'second call is marked as a replay');
    }
    assert(turnstile.callCount === 1, 'Turnstile.verify() was called exactly once -- the replay never touched Turnstile at all');
    assert(fakeEmail.sentMessages.length === 2, 'emails were sent only once (2 total for the single underlying request), not duplicated on replay');
  }
  __resetAdaptersForTests();

  section('4. R1 §2.1: replay bound to safe matching fields -- changed payload is rejected as a conflict');
  {
    __setTurnstileForTests(createFakeTurnstileVerifier([{ success: true }, { success: true }]));
    __setEmailForTests(createFakeEmailSender());
    const sharedKey = randomUUID();
    const firstEmail = `conflict-a-${randomUUID()}@acme.example`;
    const first = await submitIntakeRequest(baseInput({ idempotencyKey: sharedKey, workEmail: firstEmail }), { rawIp: '203.0.113.42' });
    assert(first.kind === 'accepted', 'first submission with this key succeeds');
    // Same key, DIFFERENT email -> different payload fingerprint.
    const second = await submitIntakeRequest(
      baseInput({ idempotencyKey: sharedKey, workEmail: `conflict-b-${randomUUID()}@acme.example` }),
      { rawIp: '203.0.113.43' }
    );
    assert(second.kind === 'idempotency_conflict', 'same key + changed payload (different email) is rejected as idempotency_conflict, not silently accepted');
  }
  __resetAdaptersForTests();

  section('5. R1 §2.2: same key after expiry is eligible for a new request');
  {
    __setTurnstileForTests(createFakeTurnstileVerifier([{ success: true }, { success: true }]));
    __setEmailForTests(createFakeEmailSender());
    const expiryKey = randomUUID();
    const expiryInput = baseInput({ idempotencyKey: expiryKey, workEmail: `expiry-${randomUUID()}@acme.example` });
    const first = await submitIntakeRequest(expiryInput, { rawIp: '203.0.113.44' });
    assert(first.kind === 'accepted', 'first submission succeeds');
    // Directly simulate the 15-minute window having elapsed, rather
    // than actually waiting 15 real minutes in this QA run.
    const { idempotencyKeyHash } = await import('../../src/lib/intake/hash');
    await intakeQuery(
      `UPDATE public_intake_idempotency_keys SET expires_at = now() - interval '1 minute' WHERE idempotency_key_hash = $1`,
      [idempotencyKeyHash(expiryKey)]
    );
    const second = await submitIntakeRequest(expiryInput, { rawIp: '203.0.113.45' });
    assert(second.kind === 'accepted', 'second submission with the now-expired key is accepted as a NEW request');
    if (first.kind === 'accepted' && second.kind === 'accepted') {
      assert(first.publicReference !== second.publicReference, 'the new request has a DIFFERENT public reference than the expired one');
      assert(second.wasReplay === false, 'the new request is not marked as a replay');
    }
  }
  __resetAdaptersForTests();

  section('6. R1 §2.2/concurrency: concurrent same-key submissions create exactly one request row');
  {
    __setTurnstileForTests(createFakeTurnstileVerifier(Array.from({ length: 10 }, () => ({ success: true }))));
    __setEmailForTests(createFakeEmailSender());
    const concurrentKey = randomUUID();
    const concurrentEmail = `concurrent-${randomUUID()}@acme.example`;
    const concurrentInput = baseInput({ idempotencyKey: concurrentKey, workEmail: concurrentEmail });
    const results = await Promise.all([
      submitIntakeRequest(concurrentInput, { rawIp: '203.0.113.50' }),
      submitIntakeRequest(concurrentInput, { rawIp: '203.0.113.51' }),
      submitIntakeRequest(concurrentInput, { rawIp: '203.0.113.52' }),
      submitIntakeRequest(concurrentInput, { rawIp: '203.0.113.53' }),
      submitIntakeRequest(concurrentInput, { rawIp: '203.0.113.54' }),
    ]);
    const references = new Set(results.filter((r) => r.kind === 'accepted').map((r) => (r as { publicReference: string }).publicReference));
    assert(results.every((r) => r.kind === 'accepted'), 'all 5 truly concurrent calls with the same key resolve to accepted (none crash or error)');
    assert(references.size === 1, `all 5 concurrent calls resolve to the SAME single public reference (got ${references.size} distinct references)`);
    const rows = await intakeQuery<{ count: string }>(
      `SELECT count(*) FROM public_intake_requests WHERE work_email_normalized = $1`,
      [concurrentEmail]
    );
    assert(Number(rows[0].count) === 1, 'exactly ONE row exists in the database for this concurrent-key scenario, not 5');
  }
  __resetAdaptersForTests();

  section('7. R1 §2.3: rate-limit ordering -- invalid Turnstile cannot consume the victim email quota');
  {
    const victimEmail = `victim-${randomUUID()}@acme.example`;
    // Attacker: 5 attempts using the VICTIM's email, all with an
    // INVALID Turnstile token, from 5 different attacker IPs (so the
    // IP limit -- 5/hour -- doesn't itself become the confound).
    __setTurnstileForTests(createFakeTurnstileVerifier(Array.from({ length: 5 }, () => ({ success: false, reason: 'invalid_token' as const }))));
    __setEmailForTests(createFakeEmailSender());
    for (let i = 0; i < 5; i += 1) {
      const outcome = await submitIntakeRequest(baseInput({ workEmail: victimEmail, idempotencyKey: randomUUID() }), {
        rawIp: `198.51.100.${10 + i}`,
      });
      assert(outcome.kind === 'turnstile_rejected', `attacker attempt ${i + 1} with invalid Turnstile is rejected as turnstile_rejected, not rate_limited`);
    }
    __resetAdaptersForTests();

    // Now the VICTIM legitimately submits with a VALID Turnstile
    // token and the SAME email, from their own IP. If the email
    // quota had been consumed by the attacker's invalid attempts
    // above, this would incorrectly come back rate_limited.
    __setTurnstileForTests(createFakeTurnstileVerifier([{ success: true }]));
    __setEmailForTests(createFakeEmailSender());
    const victimOutcome = await submitIntakeRequest(baseInput({ workEmail: victimEmail, idempotencyKey: randomUUID() }), {
      rawIp: '203.0.113.60',
    });
    assert(
      victimOutcome.kind === 'accepted',
      "the victim's legitimate submission with a valid Turnstile token still succeeds -- the attacker's invalid attempts never consumed the victim email's rate-limit quota"
    );
  }
  __resetAdaptersForTests();

  section('8. R1 §2.3: IP rate limit is still enforced BEFORE Turnstile (attacker\'s own IP gets limited)');
  {
    __setTurnstileForTests(createFakeTurnstileVerifier(Array.from({ length: 6 }, () => ({ success: false, reason: 'invalid_token' as const }))));
    __setEmailForTests(createFakeEmailSender());
    const sharedIp = `198.51.100.${Math.floor(Math.random() * 50) + 100}`;
    let ipLimited = false;
    for (let i = 0; i < 6; i += 1) {
      const outcome = await submitIntakeRequest(baseInput({ workEmail: `ip6-${i}-${randomUUID()}@acme.example`, idempotencyKey: randomUUID() }), {
        rawIp: sharedIp,
      });
      if (outcome.kind === 'rate_limited' && outcome.scope === 'ip') ipLimited = true;
    }
    assert(ipLimited, "the attacker's own IP is still rate-limited after enough invalid-Turnstile attempts (limit is 5/hour), proving IP limiting runs independently of Turnstile outcome");
  }
  __resetAdaptersForTests();

  section('9. R1 §2.5: Turnstile provider timeout fails safely (never accepted)');
  {
    // A fake verifier that simulates the real adapter's own timeout
    // handling: any provider-side failure (including a timeout) maps
    // to 'provider_error', which submitIntakeRequest must NEVER treat
    // as a success.
    __setTurnstileForTests(createFakeTurnstileVerifier([{ success: false, reason: 'provider_error' }]));
    __setEmailForTests(createFakeEmailSender());
    const outcome = await submitIntakeRequest(baseInput(), { rawIp: '203.0.113.70' });
    assert(outcome.kind === 'turnstile_provider_error', 'a Turnstile provider failure/timeout results in turnstile_provider_error, never accepted');
  }
  __resetAdaptersForTests();

  section('10. Oversized / malformed body rejected before reaching validation');
  const oversizedRequest = new Request('https://example.test/api/intake', {
    method: 'POST',
    headers: { 'content-length': String(1024 * 1024) },
    body: JSON.stringify({ hello: 'world' }),
  });
  const oversizedResult = await readBoundedJsonBody(oversizedRequest);
  assert(oversizedResult.ok === false, 'request declaring a 1MB content-length is rejected by size check alone');

  section('11. Public error responses contain no sensitive detail');
  const genericResponse = genericErrorResponse(422, 'Some fields could not be validated.', 'req-123');
  const genericBody = (await genericResponse.json()) as Record<string, unknown>;
  const bodyKeys = Object.keys(genericBody).sort();
  assert(
    JSON.stringify(bodyKeys) === JSON.stringify(['error', 'requestId']),
    `generic error body has ONLY {error, requestId} keys (got: ${bodyKeys.join(',')})`
  );

  section('12. R1 §2.4: unsupported Content-Type is rejected (415)');
  const wrongContentType = new Request('https://example.test/api/intake', {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: '{}',
  });
  assert(requireJsonContentType(wrongContentType) === false, 'text/plain Content-Type is rejected');
  const noContentType = new Request('https://example.test/api/intake', { method: 'POST', body: '{}' });
  assert(requireJsonContentType(noContentType) === false, 'missing Content-Type is rejected');
  const rightContentType = new Request('https://example.test/api/intake', {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: '{}',
  });
  assert(requireJsonContentType(rightContentType) === true, 'application/json (with charset parameter) is accepted');

  section('13. R1 §2.4: cross-site browser submission is denied');
  const crossSiteRequest = new Request('https://example.test/api/intake', {
    method: 'POST',
    headers: { 'sec-fetch-site': 'cross-site' },
  });
  assert(isCrossSiteBrowserRequest(crossSiteRequest) === true, 'Sec-Fetch-Site: cross-site is detected and would be denied');
  const sameSiteRequest = new Request('https://example.test/api/intake', {
    method: 'POST',
    headers: { 'sec-fetch-site': 'same-origin' },
  });
  assert(isCrossSiteBrowserRequest(sameSiteRequest) === false, 'Sec-Fetch-Site: same-origin is not denied by this check');
  const noHeaderRequest = new Request('https://example.test/api/intake', { method: 'POST' });
  assert(isCrossSiteBrowserRequest(noHeaderRequest) === false, 'absent Sec-Fetch-Site header (e.g. non-browser client) is not denied by this check alone');

  section('14. R1 §2.4: Origin validation');
  const badOriginRequest = new Request('https://example.test/api/intake', {
    method: 'POST',
    headers: { origin: 'https://attacker.example' },
  });
  assert(isOriginAllowed(badOriginRequest) === false, 'a present, mismatched Origin is rejected');
  const vercelPreviewRequest = new Request('https://example.test/api/intake', {
    method: 'POST',
    headers: { origin: 'https://phoenix-preview-abc123-team.vercel.app' },
  });
  assert(isOriginAllowed(vercelPreviewRequest) === true, 'a Vercel Preview origin is allowed by the documented policy');
  const noOriginRequest = new Request('https://example.test/api/intake', { method: 'POST' });
  assert(isOriginAllowed(noOriginRequest) === true, 'an absent Origin header is not rejected by this check');

  section('15. Raw IP is never stored -- only its HMAC hash');
  __setTurnstileForTests(createFakeTurnstileVerifier([{ success: true }]));
  __setEmailForTests(createFakeEmailSender());
  const ipCheckOutcome = await submitIntakeRequest(baseInput({ workEmail: `ipcheck-${randomUUID()}@acme.example` }), {
    rawIp: '203.0.113.99',
  });
  if (ipCheckOutcome.kind === 'accepted') {
    const rows = await intakeQuery<{ ip_hash: string | null }>(
      'SELECT ip_hash FROM public_intake_requests WHERE public_reference = $1',
      [ipCheckOutcome.publicReference]
    );
    const storedHash = rows[0]?.ip_hash;
    assert(!!storedHash && storedHash !== '203.0.113.99', 'stored ip_hash is not equal to the raw IP');
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
