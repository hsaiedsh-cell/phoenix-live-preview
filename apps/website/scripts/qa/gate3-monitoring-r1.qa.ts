// ============================================================
// QA: Gate 3 -- Monitoring and privacy (R1: PHX-LAUNCH-001-R1 §3)
// EXECUTED with an injected fake monitoring adapter and, for the
// Sentry event-sanitization proof, the REAL sanitizeSentryEvent
// function operating on a synthetic event object -- no real Sentry
// DSN or network access is used or required.
// ============================================================

import { assert, section, printSummaryAndExit } from './assert';
import { __setMonitoringForTests, __resetAdaptersForTests, getMonitoringAdapter } from '../../src/lib/intake/adapters';
import { createFakeMonitoringAdapter, scrubContext, sanitizeSentryEvent, redactUploadTokenFromUrl } from '../../src/lib/intake/adapters/monitoring.adapter';
import { reportInternalError, safeInternalErrorCode, SanitizedInternalError } from '../../src/lib/intake/http';

async function main() {
  section('1. A controlled route error is captured, with requestId/route/errorCategory retained');
  const fakeMonitoring = createFakeMonitoringAdapter();
  __setMonitoringForTests(fakeMonitoring);

  const controlledError = new TypeError('simulated_downstream_failure_containing_secret_object_key_abc123');
  reportInternalError(controlledError, {
    requestId: 'req-qa-123',
    route: 'POST /api/intake',
    errorCategory: 'intake_persistence',
    statusCode: 500,
    publicReference: 'PHX-REQ-QATEST0001',
  });

  assert(fakeMonitoring.captured.length === 1, 'exactly one error was captured');
  const captured = fakeMonitoring.captured[0];
  assert(captured?.context.requestId === 'req-qa-123', 'requestId is attached to the captured context');
  assert(captured?.context.errorCategory === 'intake_persistence', 'errorCategory is attached');
  assert(typeof captured?.context.safeErrorCode === 'string' && captured.context.safeErrorCode.length > 0, 'a safe internal error code is attached');

  section('2. R1 §3.1: the RAW exception message never reaches monitoring -- only a safe code derived from its type');
  assert(
    captured?.message !== controlledError.message,
    'the captured message is NOT the raw exception message'
  );
  assert(
    !String(captured?.message).includes('secret_object_key_abc123'),
    'the captured message does not contain the sensitive substring that was in the raw error message'
  );
  assert(captured?.message === 'TypeError', 'the captured message is exactly the safe error code (the error constructor name)');
  assert(safeInternalErrorCode(controlledError) === 'TypeError', 'safeInternalErrorCode() derives the code from the constructor name, not the message');
  assert(safeInternalErrorCode('a raw string, not even an Error object') === 'UnknownError', 'a non-Error thrown value maps to a generic UnknownError code, never echoing its content');
  __resetAdaptersForTests();

  section('3. R1 §3.1: SanitizedInternalError is the ONLY thing ever passed to the monitoring adapter\'s captureError');
  const sanitized = new SanitizedInternalError('DatabaseError');
  assert(sanitized.message === 'DatabaseError', 'SanitizedInternalError\'s message IS the safe code and nothing else');
  assert(sanitized instanceof Error, 'SanitizedInternalError is a real Error subclass (so Sentry.captureException handles it normally)');

  section('4. scrubContext structurally drops anything outside its allowlist');
  const attemptedLeak = {
    requestId: 'req-qa-456',
    route: 'POST /api/upload/[token]/complete',
    errorCategory: 'upload_completion' as const,
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
  assert(!('customerMessage' in scrubbed), 'customer message is omitted');
  assert(!('rawIp' in scrubbed), 'raw IP is omitted');
  assert(!('uploadToken' in scrubbed), 'upload token is omitted');
  assert(!('turnstileToken' in scrubbed), 'Turnstile token is omitted');
  assert(!('fileName' in scrubbed), 'file name is omitted');
  assert(!('resendApiKey' in scrubbed), 'Resend API key is omitted');
  assert(!('supabaseServiceRoleKey' in scrubbed), 'Supabase service-role key is omitted');
  assert(
    JSON.stringify(scrubbedKeys) === JSON.stringify(['errorCategory', 'requestId', 'route']),
    `scrubbed context contains ONLY allowlisted keys that were present (got: ${scrubbedKeys.join(',')})`
  );

  section('5. R1 §3.2: a raw upload token in a URL cannot survive sanitizeSentryEvent');
  const rawToken = 'RAW_SECRET_TOKEN_should_never_appear_anywhere_downstream';
  const syntheticEvent = {
    request: {
      url: `https://phoenixops.ai/api/upload/${rawToken}/complete`,
      data: { some: 'body content that should be dropped' },
      query_string: 'foo=bar',
      cookies: { session: 'abc' },
      headers: { authorization: 'Bearer secret', 'content-type': 'application/json' },
    },
    user: { email: 'customer@example.com' },
    transaction: `POST /api/upload/${rawToken}/complete`,
    breadcrumbs: [
      { data: { url: `https://phoenixops.ai/api/upload/${rawToken}/sign`, body: 'dropped too' } },
    ],
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- synthetic Sentry event shape for this proof only
  const sanitizedEvent = sanitizeSentryEvent(syntheticEvent as any);
  const serialized = JSON.stringify(sanitizedEvent);
  assert(!serialized.includes(rawToken), 'the raw upload token does NOT appear anywhere in the sanitized event, in any field');
  assert(sanitizedEvent.request?.url === 'https://phoenixops.ai/api/upload/[token]/complete', 'the request URL is rewritten to the route TEMPLATE');
  assert(sanitizedEvent.transaction === 'POST /api/upload/[token]/complete', 'the transaction name is rewritten to the route TEMPLATE');
  assert(sanitizedEvent.breadcrumbs?.[0]?.data?.url === 'https://phoenixops.ai/api/upload/[token]/sign', 'a breadcrumb URL is also rewritten to the route template');
  assert(!('data' in (sanitizedEvent.request ?? {})), 'request body is removed entirely');
  assert(!('query_string' in (sanitizedEvent.request ?? {})), 'query string is removed entirely');
  assert(!('cookies' in (sanitizedEvent.request ?? {})), 'cookies are removed entirely');
  assert(!('authorization' in (sanitizedEvent.request?.headers ?? {})), 'authorization header is removed');
  assert(!('user' in sanitizedEvent), 'user/email identity is removed entirely');
  assert(!('body' in (sanitizedEvent.breadcrumbs?.[0]?.data ?? {})), 'breadcrumb body content is removed');

  section('6. redactUploadTokenFromUrl is a narrow, targeted rewrite (does not mangle unrelated URLs)');
  assert(redactUploadTokenFromUrl('/api/intake') === '/api/intake', 'a URL with no upload-token segment is left unchanged');
  assert(
    redactUploadTokenFromUrl('/api/upload/abc123/sign?x=1') === '/api/upload/[token]/sign?x=1',
    'query strings after the token segment are preserved (only the token itself is replaced)'
  );

  section('7. Monitoring adapter is a safe no-op when unconfigured (never throws)');
  __resetAdaptersForTests();
  let threw = false;
  try {
    getMonitoringAdapter().captureError(new SanitizedInternalError('Should not throw'), {
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
  console.error('gate3-monitoring-r1.qa.ts failed:', error);
  process.exitCode = 1;
});
