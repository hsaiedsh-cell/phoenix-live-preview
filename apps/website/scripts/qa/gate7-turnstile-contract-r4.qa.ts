// ============================================================
// QA: Turnstile hostname/action contract (R4)
// PHX-LAUNCH-001-R4 Section 7
// EXECUTED -- pure decision function, no network access, no real
// Cloudflare credentials. This does NOT claim live Turnstile
// validation (see PHX-LAUNCH-001-R4 §9) -- it proves the decision
// logic the live adapter applies to a Siteverify response, once one
// is actually received.
// ============================================================

import { assert, section, printSummaryAndExit } from './assert';
import { evaluateSiteverifyContract } from '../../src/lib/intake/adapters/turnstile.adapter';

function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T): T {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) {
    previous[key] = process.env[key];
    if (vars[key] === undefined) delete process.env[key];
    else process.env[key] = vars[key];
  }
  try {
    return fn();
  } finally {
    for (const key of Object.keys(previous)) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

async function main() {
  section('1. A response hostname matching the configured allowlist is accepted');
  withEnv({ TURNSTILE_ALLOWED_HOSTNAMES: 'phoenixops.ai,phoenix-preview.vercel.app', TURNSTILE_EXPECTED_ACTION: undefined }, () => {
    const result = evaluateSiteverifyContract({ success: true, hostname: 'phoenixops.ai' });
    assert(result.ok === true, 'an exact, configured hostname is accepted');
  });

  section('2. A response hostname NOT in the configured allowlist is rejected');
  withEnv({ TURNSTILE_ALLOWED_HOSTNAMES: 'phoenixops.ai', TURNSTILE_EXPECTED_ACTION: undefined }, () => {
    const result = evaluateSiteverifyContract({ success: true, hostname: 'attacker-controlled.example' });
    assert(result.ok === false && result.reason === 'hostname_mismatch', 'an unconfigured hostname is rejected as hostname_mismatch');
  });

  section('3. Hostname check is case-insensitive');
  withEnv({ TURNSTILE_ALLOWED_HOSTNAMES: 'PhoenixOps.AI', TURNSTILE_EXPECTED_ACTION: undefined }, () => {
    const result = evaluateSiteverifyContract({ success: true, hostname: 'phoenixops.ai' });
    assert(result.ok === true, 'hostname comparison is case-insensitive in both directions');
  });

  section('4. Hostname check is SKIPPED (not enforced) when TURNSTILE_ALLOWED_HOSTNAMES is unset');
  withEnv({ TURNSTILE_ALLOWED_HOSTNAMES: undefined, TURNSTILE_EXPECTED_ACTION: undefined }, () => {
    const result = evaluateSiteverifyContract({ success: true, hostname: 'anything-at-all.example' });
    assert(result.ok === true, 'with no allowlist configured, hostname is not checked at all -- safe default for environments that have not configured Turnstile widgets yet');
  });

  section('5. Missing hostname in the response is rejected when an allowlist IS configured (fail closed)');
  withEnv({ TURNSTILE_ALLOWED_HOSTNAMES: 'phoenixops.ai', TURNSTILE_EXPECTED_ACTION: undefined }, () => {
    const result = evaluateSiteverifyContract({ success: true });
    assert(result.ok === false && result.reason === 'hostname_mismatch', 'a response missing hostname entirely is rejected once an allowlist is configured, rather than silently passing');
  });

  section('6. A response action matching the expected action is accepted');
  withEnv({ TURNSTILE_ALLOWED_HOSTNAMES: undefined, TURNSTILE_EXPECTED_ACTION: 'public-intake' }, () => {
    const result = evaluateSiteverifyContract({ success: true, action: 'public-intake' });
    assert(result.ok === true, 'a matching action is accepted');
  });

  section('7. A response action NOT matching the expected action is rejected');
  withEnv({ TURNSTILE_ALLOWED_HOSTNAMES: undefined, TURNSTILE_EXPECTED_ACTION: 'public-intake' }, () => {
    const result = evaluateSiteverifyContract({ success: true, action: 'some-other-action' });
    assert(result.ok === false && result.reason === 'action_mismatch', 'a mismatched action is rejected as action_mismatch');
  });

  section('8. Action check is also skipped when neither an expected action is configured NOR does the response carry one');
  withEnv({ TURNSTILE_ALLOWED_HOSTNAMES: undefined, TURNSTILE_EXPECTED_ACTION: undefined }, () => {
    const result = evaluateSiteverifyContract({ success: true });
    assert(result.ok === true, 'with no action configured and no action in the response, the check is skipped entirely -- safe default');
  });

  section('9. Both checks combined: hostname passes, action fails -> overall rejected');
  withEnv({ TURNSTILE_ALLOWED_HOSTNAMES: 'phoenixops.ai', TURNSTILE_EXPECTED_ACTION: 'public-intake' }, () => {
    const result = evaluateSiteverifyContract({ success: true, hostname: 'phoenixops.ai', action: 'wrong-action' });
    assert(result.ok === false && result.reason === 'action_mismatch', 'hostname passing does not compensate for a failed action check');
  });

  section("10. Structural: the client widget supplies the 'action' parameter matching the server's default expected action");
  {
    const fs = await import('node:fs');
    const formSource = fs.readFileSync(new URL('../../src/components/intake/IntakeForm.tsx', import.meta.url), 'utf8');
    assert(formSource.includes("action: 'public-intake'"), 'IntakeForm.tsx supplies action: \'public-intake\' to the Turnstile widget render call, matching the server adapter\'s DEFAULT_EXPECTED_ACTION');
  }

  printSummaryAndExit();
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('gate7-turnstile-contract-r4.qa.ts failed:', error);
  process.exitCode = 1;
});
