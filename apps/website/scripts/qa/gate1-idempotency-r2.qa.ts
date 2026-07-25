// ============================================================
// QA: Gate 1 -- Lock-free idempotency state machine (R2)
// PHX-LAUNCH-001-R2 Section 1
// EXECUTED against a real local Postgres instance, deliberately
// configured with the pool max forced down to 3-5 connections (see
// db.ts's __resetIntakePoolForTests), specifically to prove the R1
// session-advisory-lock self-deadlock cannot recur. Turnstile/Email
// are injected fakes.
// ============================================================

import { randomUUID } from 'node:crypto';
import { assert, section, printSummaryAndExit } from './assert';
import { submitIntakeRequest } from '../../src/lib/intake/submit.service';
import { intakeQuery, __resetIntakePoolForTests } from '../../src/lib/intake/db';
import * as db from '../../src/lib/intake/db';
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

/** Rejects with a clear failure if `promise` doesn't settle within `ms` -- so a real deadlock fails this suite instead of hanging the whole QA run indefinitely. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`TIMEOUT after ${ms}ms: ${label}`)), ms)),
  ]);
}

async function main() {
  section('0. Structural: no session advisory lock exists in the intake runtime (R2 §1.2)');
  assert(
    typeof (db as unknown as Record<string, unknown>).withAdvisoryLock === 'undefined',
    'db.ts no longer exports withAdvisoryLock at all (removed, not merely unused)'
  );
  const submitServiceSource = await import('node:fs').then((fs) =>
    fs.readFileSync(new URL('../../src/lib/intake/submit.service.ts', import.meta.url), 'utf8')
  );
  assert(!submitServiceSource.includes('pg_advisory_lock'), 'submit.service.ts source contains no pg_advisory_lock reference');
  assert(!submitServiceSource.includes('withAdvisoryLock'), 'submit.service.ts source contains no withAdvisoryLock reference');
  const dbSource = await import('node:fs').then((fs) => fs.readFileSync(new URL('../../src/lib/intake/db.ts', import.meta.url), 'utf8'));
  assert(
    !dbSource.includes('pg_advisory_lock(') && !dbSource.includes('SELECT pg_advisory_lock'),
    'db.ts source contains no actual pg_advisory_lock SQL call (the bare term may still appear in comments explaining its removal)'
  );

  // R2 §1.3: deliberately force the pool down to a small max (3) for
  // every concurrency proof below.
  __resetIntakePoolForTests(3);

  section('1. R2 §1.3: 20+ concurrent SAME-key submissions terminate without hanging, create exactly one request');
  {
    __setTurnstileForTests(createFakeTurnstileVerifier(Array.from({ length: 25 }, () => ({ success: true }))));
    __setEmailForTests(createFakeEmailSender());
    const sameKey = randomUUID();
    const sameEmail = `same-key-25x-${randomUUID()}@acme.example`;
    const sameInput = baseInput({ idempotencyKey: sameKey, workEmail: sameEmail });

    const results = await withTimeout(
      Promise.all(Array.from({ length: 25 }, (_, i) => submitIntakeRequest(sameInput, { rawIp: `198.51.100.${i + 1}` }))),
      20000,
      '25 concurrent same-key submissions (pool max=3)'
    );
    assert(results.length === 25, 'all 25 calls settled (did not hang) -- pool max=3 does not deadlock');
    // Per R2 §1.2 item 5, a racer that observes the winner's claim
    // still 'pending' correctly receives submission_in_progress, NOT
    // an accepted duplicate -- so the only two legitimate outcomes
    // across 25 truly concurrent identical-key/identical-payload
    // calls are 'accepted' (the eventual winner, and any late-checking
    // caller who observes the already-completed row as a replay) and
    // 'submission_in_progress'. Anything else (an error, a conflict,
    // a rate limit) would be a real bug.
    const invalidOutcomes = results.filter((r) => r.kind !== 'accepted' && r.kind !== 'submission_in_progress');
    assert(invalidOutcomes.length === 0, `every one of the 25 concurrent same-key calls is either accepted or submission_in_progress, never an error (found: ${invalidOutcomes.map((r) => r.kind).join(',')})`);
    const acceptedResults = results.filter((r) => r.kind === 'accepted') as Array<{ kind: 'accepted'; publicReference: string }>;
    assert(acceptedResults.length >= 1, 'at least one of the 25 concurrent calls is accepted');
    const references = new Set(acceptedResults.map((r) => r.publicReference));
    assert(references.size === 1, `every ACCEPTED result among the 25 concurrent same-key calls carries the SAME public reference (got ${references.size} distinct references among ${acceptedResults.length} accepted results)`);

    const rows = await intakeQuery<{ count: string }>(`SELECT count(*) FROM public_intake_requests WHERE work_email_normalized = $1`, [sameEmail]);
    assert(Number(rows[0].count) === 1, 'exactly ONE database row exists for this 25-way concurrent same-key scenario');
  }
  __resetAdaptersForTests();

  section('2. R2 §1.3: same key never consumes more than one successful Turnstile acceptance');
  {
    // A fake verifier that would FAIL any call beyond the first --
    // if more than one concurrent caller ever reached Turnstile for
    // the same key, this test would see a turnstile_rejected outcome
    // instead of accepted/submission_in_progress.
    const turnstile = createFakeTurnstileVerifier([
      { success: true },
      ...Array.from({ length: 24 }, () => ({ success: false, reason: 'invalid_token' as const })),
    ]);
    __setTurnstileForTests(turnstile);
    __setEmailForTests(createFakeEmailSender());
    const key = randomUUID();
    const email = `turnstile-once-${randomUUID()}@acme.example`;
    const input = baseInput({ idempotencyKey: key, workEmail: email });

    const results = await withTimeout(
      Promise.all(Array.from({ length: 25 }, (_, i) => submitIntakeRequest(input, { rawIp: `198.51.101.${i + 1}` }))),
      20000,
      '25 concurrent same-key submissions with a verifier that fails after the 1st call'
    );
    const rejectedByTurnstile = results.filter((r) => r.kind === 'turnstile_rejected');
    assert(
      rejectedByTurnstile.length === 0,
      'none of the 25 calls come back turnstile_rejected -- proving no more than one of them ever actually reached Turnstile (only the true winner does, and it always succeeds)'
    );
    assert(turnstile.callCount === 1, `Turnstile.verify() was called exactly once across all 25 concurrent same-key attempts (got ${turnstile.callCount})`);
  }
  __resetAdaptersForTests();

  section('3. R2 §1.3: 20+ concurrent DISTINCT-key submissions terminate without hanging');
  {
    __setTurnstileForTests(createFakeTurnstileVerifier(Array.from({ length: 22 }, () => ({ success: true }))));
    __setEmailForTests(createFakeEmailSender());
    const inputs = Array.from({ length: 22 }, (_, i) =>
      baseInput({ idempotencyKey: randomUUID(), workEmail: `distinct-${i}-${randomUUID()}@acme.example` })
    );
    const results = await withTimeout(
      Promise.all(inputs.map((input, i) => submitIntakeRequest(input, { rawIp: `198.51.102.${i + 1}` }))),
      20000,
      '22 concurrent distinct-key submissions (pool max=3)'
    );
    assert(results.length === 22, 'all 22 distinct-key calls settled without hanging');
    const acceptedCount = results.filter((r) => r.kind === 'accepted').length;
    assert(acceptedCount === 22, `all 22 distinct-key calls are accepted (got ${acceptedCount})`);
    const references = new Set(results.map((r) => (r as { publicReference: string }).publicReference));
    assert(references.size === 22, 'each distinct key produced its OWN distinct public reference (no cross-contamination)');
  }
  __resetAdaptersForTests();

  section('4. R2 §1.2: completed replay returns the original public reference, no duplicate emails');
  {
    __setTurnstileForTests(createFakeTurnstileVerifier([{ success: true }]));
    const fakeEmail = createFakeEmailSender();
    __setEmailForTests(fakeEmail);
    const key = randomUUID();
    const input = baseInput({ idempotencyKey: key, workEmail: `replay-${randomUUID()}@acme.example` });
    const first = await submitIntakeRequest(input, { rawIp: '203.0.113.10' });
    assert(first.kind === 'accepted', 'first submission accepted');
    const second = await submitIntakeRequest(input, { rawIp: '203.0.113.11' });
    assert(second.kind === 'accepted', 'replay call also accepted');
    if (first.kind === 'accepted' && second.kind === 'accepted') {
      assert(first.publicReference === second.publicReference, 'replay returns the SAME public reference');
      assert(second.wasReplay === true, 'replay is marked as such');
    }
    assert(fakeEmail.sentMessages.length === 2, 'exactly 2 emails total (not duplicated by the replay)');
  }
  __resetAdaptersForTests();

  section('5. R2 §1.2: changed payload conflicts (pending OR completed row, same key)');
  {
    __setTurnstileForTests(createFakeTurnstileVerifier([{ success: true }]));
    __setEmailForTests(createFakeEmailSender());
    const key = randomUUID();
    const first = await submitIntakeRequest(baseInput({ idempotencyKey: key, workEmail: `conflict-a-${randomUUID()}@acme.example` }), {
      rawIp: '203.0.113.20',
    });
    assert(first.kind === 'accepted', 'first submission (completed claim) accepted');
    const second = await submitIntakeRequest(baseInput({ idempotencyKey: key, workEmail: `conflict-b-${randomUUID()}@acme.example` }), {
      rawIp: '203.0.113.21',
    });
    assert(second.kind === 'idempotency_conflict', 'same key + different email against a COMPLETED row is rejected as idempotency_conflict');
  }
  __resetAdaptersForTests();

  section('6. R2 §1.2: expired key can be reclaimed for a new attempt');
  {
    __setTurnstileForTests(createFakeTurnstileVerifier([{ success: true }, { success: true }]));
    __setEmailForTests(createFakeEmailSender());
    const key = randomUUID();
    const input = baseInput({ idempotencyKey: key, workEmail: `expire-reclaim-${randomUUID()}@acme.example` });
    const first = await submitIntakeRequest(input, { rawIp: '203.0.113.30' });
    assert(first.kind === 'accepted', 'first submission accepted');
    const { idempotencyKeyHash } = await import('../../src/lib/intake/hash');
    await intakeQuery(`UPDATE public_intake_idempotency_keys SET expires_at = now() - interval '1 minute' WHERE idempotency_key_hash = $1`, [
      idempotencyKeyHash(key),
    ]);
    const second = await submitIntakeRequest(input, { rawIp: '203.0.113.31' });
    assert(second.kind === 'accepted', 'second submission after expiry is accepted as a genuinely new request');
    if (first.kind === 'accepted' && second.kind === 'accepted') {
      assert(first.publicReference !== second.publicReference, 'the reclaimed key produces a DIFFERENT public reference');
      assert(second.wasReplay === false, 'the reclaimed submission is not marked as a replay');
    }
  }
  __resetAdaptersForTests();

  section('7. R2 §1.2: a failed row (Turnstile/rate-limit rejection) is immediately reclaimable');
  {
    __setTurnstileForTests(createFakeTurnstileVerifier([{ success: false, reason: 'invalid_token' }, { success: true }]));
    __setEmailForTests(createFakeEmailSender());
    const key = randomUUID();
    const email = `failed-reclaim-${randomUUID()}@acme.example`;
    const rejectedOutcome = await submitIntakeRequest(baseInput({ idempotencyKey: key, workEmail: email }), { rawIp: '203.0.113.40' });
    assert(rejectedOutcome.kind === 'turnstile_rejected', 'first attempt is rejected by Turnstile');
    const rows = await intakeQuery<{ state: string }>(
      `SELECT state FROM public_intake_idempotency_keys WHERE idempotency_key_hash = (SELECT $1)`,
      [(await import('../../src/lib/intake/hash')).idempotencyKeyHash(key)]
    );
    assert(rows[0]?.state === 'failed', "the claim was released to state='failed' after the Turnstile rejection");
    const retryOutcome = await submitIntakeRequest(baseInput({ idempotencyKey: key, workEmail: email }), { rawIp: '203.0.113.41' });
    assert(retryOutcome.kind === 'accepted', 'an immediate retry with the SAME key succeeds (failed row was reclaimable, no cooldown)');
  }
  __resetAdaptersForTests();

  section('8. R2 §1.2 item 5: pending replay returns a bounded submission_in_progress response');
  {
    // Simulate a still-pending claim directly (a real in-flight
    // concurrent request would look identical from a second caller's
    // perspective): insert a 'pending', non-expired row, then submit
    // with the same key + matching fingerprint.
    const idem = await import('../../src/lib/intake/hash');
    const idemRepo = await import('../../src/lib/intake/repositories/idempotency-keys.repository');
    const key = randomUUID();
    const email = `pending-inprogress-${randomUUID()}@acme.example`;
    const fingerprint = idem.payloadFingerprint(email, 'assessment');
    const ownerToken = idemRepo.generateOwnerToken();
    await idemRepo.claimIdempotencyKey({
      idempotencyKeyHash: idem.idempotencyKeyHash(key),
      payloadFingerprint: fingerprint,
      ownerTokenHash: idemRepo.hashOwnerToken(ownerToken),
    });
    __setTurnstileForTests(createFakeTurnstileVerifier([{ success: true }]));
    __setEmailForTests(createFakeEmailSender());
    const outcome = await submitIntakeRequest(baseInput({ idempotencyKey: key, workEmail: email }), { rawIp: '203.0.113.50' });
    assert(outcome.kind === 'submission_in_progress', 'a genuinely pending, unexpired, matching-fingerprint claim yields submission_in_progress, not a new request');
    const rows = await intakeQuery<{ count: string }>(`SELECT count(*) FROM public_intake_requests WHERE work_email_normalized = $1`, [email]);
    assert(Number(rows[0].count) === 0, 'no request row was created for the in-progress duplicate');
  }
  __resetAdaptersForTests();

  __resetIntakePoolForTests(); // restore default pool sizing for any later QA script sharing this process
  printSummaryAndExit();
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('gate1-idempotency-r2.qa.ts failed:', error);
  process.exitCode = 1;
});
