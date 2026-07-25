// ============================================================
// QA: Gate 3 -- Monitoring and privacy, hardened for auto-instrumented
// events (R2)
// PHX-LAUNCH-001-R2 Section 6 (building on R1 §3)
// EXECUTED with an injected fake monitoring adapter and, for the
// Sentry event-sanitization proof, the REAL sanitizeSentryEvent
// function operating on synthetic event objects -- no real Sentry
// DSN or network access is used or required.
// ============================================================

import { assert, section, printSummaryAndExit } from './assert';
import { __setMonitoringForTests, __resetAdaptersForTests, getMonitoringAdapter } from '../../src/lib/intake/adapters';
import { createFakeMonitoringAdapter, scrubContext, sanitizeSentryEvent, redactUploadTokenFromUrl, stripUrlQueryAndFragment } from '../../src/lib/intake/adapters/monitoring.adapter';
import { reportInternalError, safeInternalErrorCode, SanitizedInternalError } from '../../src/lib/intake/http';

async function main() {
  section('1. R1 §3.1 (retained): controlled route errors never leak the raw exception message');
  const fakeMonitoring = createFakeMonitoringAdapter();
  __setMonitoringForTests(fakeMonitoring);
  const controlledError = new TypeError('simulated_downstream_failure_containing_secret_object_key_abc123');
  reportInternalError(controlledError, { requestId: 'req-qa-123', route: 'POST /api/intake', errorCategory: 'intake_persistence', statusCode: 500 });
  assert(fakeMonitoring.captured[0]?.message === 'TypeError', 'captured message is the safe error code, not the raw message');
  assert(safeInternalErrorCode(controlledError) === 'TypeError', 'safeInternalErrorCode derives from the constructor name');
  __resetAdaptersForTests();

  section('2. R1 §3.1 (retained): scrubContext allowlist');
  const scrubbed = scrubContext({
    requestId: 'req-qa-456',
    route: 'POST /api/upload/[token]/complete',
    errorCategory: 'upload_completion',
    customerMessage: 'private',
    rawIp: '203.0.113.55',
  });
  assert(!('customerMessage' in scrubbed) && !('rawIp' in scrubbed), 'context allowlist still drops unlisted keys');

  section('3. R2 §6: a fully raw, AUTO-INSTRUMENTED synthetic error event -- nothing survives');
  const rawToken = 'RAW_SECRET_UPLOAD_TOKEN_should_never_survive';
  const rawEmail = 'customer-real-email@example.com';
  const rawMessageBody = 'This is the confidential customer message body, verbatim.';
  const rawDbDetail = 'duplicate key value violates unique constraint "uq_intake_requests_public_reference" DETAIL: Key (public_reference)=(PHX-REQ-ABC123) already exists.';
  const rawObjectKey = `intake/${rawToken}/deadbeef`;
  const rawFilename = 'confidential-merger-plan.pdf';
  const rawAuthHeader = 'Bearer sk_live_secretvalue';
  const rawCookie = 'session=abc123; other=xyz';
  const rawQueryString = 'debug=true&email=' + encodeURIComponent(rawEmail);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- synthetic Sentry event shape, this proof only
  const syntheticErrorEvent: any = {
    request: {
      url: `https://phoenixops.ai/api/upload/${rawToken}/complete?${rawQueryString}#fragment-with-${rawToken}`,
      data: { message: rawMessageBody, email: rawEmail },
      query_string: rawQueryString,
      cookies: { session: 'abc123' },
      headers: { authorization: rawAuthHeader, cookie: rawCookie, 'content-type': 'application/json' },
    },
    user: { email: rawEmail },
    extra: { message: rawMessageBody, dbDetail: rawDbDetail, objectKey: rawObjectKey },
    contexts: {
      runtime: { name: 'node', version: '20.0.0' },
      culture: { locale: 'en-US', timezone: 'UTC' }, // not in the allowlist -- must be dropped
      device: { arch: 'x64' }, // not in the allowlist -- must be dropped
    },
    exception: {
      values: [
        {
          type: 'Error',
          value: `Database error: ${rawDbDetail} while processing email ${rawEmail}`,
          stacktrace: {
            frames: [
              { filename: 'submit.service.ts', vars: { email: rawEmail, message: rawMessageBody }, context_line: `const x = "${rawMessageBody}"`, pre_context: ['line1'], post_context: ['line2'] },
            ],
          },
        },
      ],
    },
    transaction: `POST /api/upload/${rawToken}/complete`,
    breadcrumbs: [
      {
        message: rawMessageBody,
        data: { url: `https://phoenixops.ai/api/upload/${rawToken}/sign`, filename: rawFilename, objectKey: rawObjectKey, email: rawEmail, body: rawMessageBody },
      },
    ],
  };

  const sanitizedError = sanitizeSentryEvent(syntheticErrorEvent);
  const serializedError = JSON.stringify(sanitizedError);

  for (const [label, needle] of [
    ['email', rawEmail],
    ['message body', rawMessageBody],
    ['database detail', rawDbDetail],
    ['upload token', rawToken],
    ['storage object key', rawObjectKey],
    ['filename', rawFilename],
    ['authorization header', rawAuthHeader],
    ['cookie', rawCookie],
    ['query string', rawQueryString],
  ] as const) {
    assert(!serializedError.includes(needle), `${label} does not survive anywhere in the sanitized ERROR event`);
  }

  assert(!('user' in sanitizedError), 'user/email identity object is removed entirely');
  assert(!('extra' in sanitizedError), 'extra is deleted entirely, not merely filtered');
  assert(Object.keys(sanitizedError.contexts).sort().join(',') === 'runtime', 'contexts is reduced to ONLY the allowlisted "runtime" key -- culture and device are both dropped');
  assert(sanitizedError.exception.values[0].value === 'redacted', 'the raw exception message is replaced with a fixed safe placeholder');
  assert(sanitizedError.exception.values[0].type === 'Error', 'the exception TYPE (class name) is preserved -- it carries no request-specific detail');
  assert(!sanitizedError.exception.values[0].stacktrace.frames[0].vars, 'stack frame local variables are stripped');
  assert(!sanitizedError.exception.values[0].stacktrace.frames[0].context_line, 'stack frame source context lines are stripped');
  assert(sanitizedError.request.url === 'https://phoenixops.ai/api/upload/[token]/complete', 'request URL has its query string AND fragment stripped entirely, and the token path segment redacted to the template');
  assert(sanitizedError.transaction === 'POST /api/upload/[token]/complete', 'transaction name is redacted to the route template');
  assert(!sanitizedError.breadcrumbs[0].message, 'breadcrumb message text is removed');
  assert(
    Object.keys(sanitizedError.breadcrumbs[0].data).sort().join(',') === 'url',
    'breadcrumb data is reduced to only the (already-redacted) url key -- filename/objectKey/email/body are all stripped'
  );
  assert(sanitizedError.breadcrumbs[0].data.url === 'https://phoenixops.ai/api/upload/[token]/sign', 'the surviving breadcrumb url has its token segment redacted');

  section('4. R2 §6: a synthetic TRANSACTION event with spans -- filenames/object keys stripped from spans too');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const syntheticTransactionEvent: any = {
    transaction: `POST /api/upload/${rawToken}/sign`,
    request: { url: `https://phoenixops.ai/api/upload/${rawToken}/sign?${rawQueryString}` },
    spans: [
      {
        description: `PUT https://storage.example/${rawObjectKey}`,
        data: { filename: rawFilename, storageObjectKey: rawObjectKey, url: `https://phoenixops.ai/api/upload/${rawToken}/sign` },
      },
    ],
    contexts: { runtime: { name: 'node' }, browser: { name: 'chrome' } },
  };
  const sanitizedTx = sanitizeSentryEvent(syntheticTransactionEvent);
  const serializedTx = JSON.stringify(sanitizedTx);
  assert(!serializedTx.includes(rawToken), 'no raw upload token survives in the sanitized TRANSACTION event');
  assert(!serializedTx.includes(rawFilename), 'no filename survives in the sanitized TRANSACTION event span data');
  assert(!serializedTx.includes(rawObjectKey), 'no storage object key survives in the sanitized TRANSACTION event span description or data');
  assert(sanitizedTx.spans[0].description === 'PUT https://storage.example/intake/[objectKey]', 'span description has its embedded storage-object-key path redacted');
  assert(Object.keys(sanitizedTx.contexts).join(',') === 'runtime', 'transaction event contexts are also reduced to only "runtime"');

  section('5. redactUploadTokenFromUrl / stripUrlQueryAndFragment are narrow, targeted rewrites');
  assert(redactUploadTokenFromUrl('/api/intake') === '/api/intake', 'a URL with no upload-token segment is left unchanged');
  assert(stripUrlQueryAndFragment('https://x.test/api/intake?a=1#b') === 'https://x.test/api/intake', 'query and fragment are both removed from an unrelated URL too');
  assert(
    stripUrlQueryAndFragment('not a url at all?x=1#y') === 'not a url at all',
    'a non-parseable string still has everything from the first ? or # onward removed, failing closed rather than passing it through'
  );

  section('6. sendDefaultPii / tracesSampleRate configuration (structural)');
  const fs = await import('node:fs');
  const source = fs.readFileSync(new URL('../../src/lib/intake/adapters/monitoring.adapter.ts', import.meta.url), 'utf8');
  assert(source.includes('sendDefaultPii: false'), 'sendDefaultPii: false is set in the live Sentry.init call');
  assert(source.includes('tracesSampleRate: 0'), 'tracesSampleRate: 0 (performance tracing disabled) is set in the live Sentry.init call');

  section('7. Monitoring adapter is a safe no-op when unconfigured (never throws)');
  __resetAdaptersForTests();
  let threw = false;
  try {
    getMonitoringAdapter().captureError(new SanitizedInternalError('Should not throw'), { requestId: 'req-qa-789', route: 'test', errorCategory: 'unknown' });
  } catch {
    threw = true;
  }
  assert(!threw, 'calling captureError with no SENTRY_DSN configured does not throw');

  printSummaryAndExit();
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('gate3-monitoring-r2.qa.ts failed:', error);
  process.exitCode = 1;
});
