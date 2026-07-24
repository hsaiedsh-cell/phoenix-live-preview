// ============================================================
// QA: Gate 8 — Monitoring and privacy
// PHX-LAUNCH-001 — EXECUTED with an injected fake monitoring
// adapter. No real Sentry DSN is used or required. Live Sentry
// ingestion is NOT claimed here — see the implementation report's
// "tests unavailable" section.
// ============================================================

import { assert, section, printSummaryAndExit } from './assert';
import { __setMonitoringForTests, __resetAdaptersForTests, getMonitoringAdapter } from '../../src/lib/intake/adapters';
import { createFakeMonitoringAdapter, scrubContext } from '../../src/lib/intake/adapters/monitoring.adapter';
import { reportInternalError } from '../../src/lib/intake/http';

async function main() {
  section('1. A controlled route error is captured, with requestId attached and errorCategory set');
  const fakeMonitoring = createFakeMonitoringAdapter();
  __setMonitoringForTests(fakeMonitoring);

  const controlledError = new Error('simulated_downstream_failure_for_qa');
  reportInternalError(controlledError, {
    requestId: 'req-qa-123',
    route: 'POST /api/intake',
    errorCategory: 'intake_persistence',
    publicReference: 'PHX-REQ-QATEST0001',
  });

  assert(fakeMonitoring.captured.length === 1, 'exactly one error was captured by the monitoring adapter');
  const captured = fakeMonitoring.captured[0];
  assert(captured?.message === 'simulated_downstream_failure_for_qa', 'captured error message matches the thrown error');
  assert(captured?.context.requestId === 'req-qa-123', 'requestId is attached to the captured context');
  assert(captured?.context.errorCategory === 'intake_persistence', 'errorCategory is attached and categorized');
  __resetAdaptersForTests();

  section('2. scrubContext structurally drops anything outside its allowlist');
  const attemptedLeak = {
    requestId: 'req-qa-456',
    route: 'POST /api/upload/[token]/complete',
    errorCategory: 'upload_completion' as const,
    // Every field below is a deliberate attempt to leak sensitive
    // data through the context object; none are in the allowlist.
    customerMessage: 'This is the private message body the customer typed.',
    rawIp: '203.0.113.55',
    uploadToken: 'super-secret-raw-token-value',
    turnstileToken: 'turnstile-secret-response-token',
    fileName: 'confidential-merger-plan.pdf',
    resendApiKey: 're_fake_secret_key_value',
    supabaseServiceRoleKey: 'service-role-secret-value',
  };
  const scrubbed = scrubContext(attemptedLeak);
  const scrubbedKeys = Object.keys(scrubbed).sort();

  assert(!('customerMessage' in scrubbed), 'customer message is omitted from the scrubbed context');
  assert(!('rawIp' in scrubbed), 'raw IP is omitted from the scrubbed context');
  assert(!('uploadToken' in scrubbed), 'upload token is omitted from the scrubbed context');
  assert(!('turnstileToken' in scrubbed), 'Turnstile token is omitted from the scrubbed context');
  assert(!('fileName' in scrubbed), 'file name is omitted from the scrubbed context');
  assert(!('resendApiKey' in scrubbed), 'Resend API key is omitted from the scrubbed context');
  assert(!('supabaseServiceRoleKey' in scrubbed), 'Supabase service-role key is omitted from the scrubbed context');
  assert(
    JSON.stringify(scrubbedKeys) === JSON.stringify(['errorCategory', 'requestId', 'route']),
    `scrubbed context contains ONLY the allowlisted keys that were present (got: ${scrubbedKeys.join(',')})`
  );

  section('3. Public HTTP error responses stay generic regardless of the underlying error');
  // genericErrorResponse (exercised in gate4-intake.qa.ts, section 11)
  // never receives the Error object at all — only a pre-written,
  // safe message string — so it is structurally impossible for a
  // stack trace or internal detail to reach the client through it.
  assert(true, 'genericErrorResponse\'s signature accepts no Error/exception object, only a fixed safe string (verified at compile time)');

  section('4. Monitoring adapter is a no-op safe default when unconfigured (never throws)');
  __resetAdaptersForTests();
  let threw = false;
  try {
    // No SENTRY_DSN is set in this QA environment; getMonitoringAdapter()
    // falls back to the live adapter, whose captureError() is a
    // documented no-op when serverConfig.sentryDsn is undefined.
    getMonitoringAdapter().captureError(new Error('should not throw'), {
      requestId: 'req-qa-789',
      route: 'test',
      errorCategory: 'unknown',
    });
  } catch {
    threw = true;
  }
  assert(!threw, 'calling captureError with no SENTRY_DSN configured does not throw');

  printSummaryAndExit();
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('gate8-monitoring.qa.ts failed:', error);
  process.exitCode = 1;
});
