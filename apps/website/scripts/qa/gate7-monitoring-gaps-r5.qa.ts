// ============================================================
// QA: Remaining monitoring-sanitizer gaps closed (R5)
// PHX-LAUNCH-001-R5 Section 7
// EXECUTED with the REAL sanitizeSentryEvent function operating on
// synthetic event objects -- no real Sentry DSN or network access.
// ============================================================

import { assert, section, printSummaryAndExit } from './assert';
import { sanitizeSentryEvent, scrubContext } from '../../src/lib/intake/adapters/monitoring.adapter';

const rawToken = 'RAW_R5_UPLOAD_TOKEN_never_survive';
const rawObjectKey = 'intake/some-session-id/some-random-hex';
const rawEmail = 'r5-query-email@example.com';

async function main() {
  section('1. x-forwarded-for header is removed entirely');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const eventA: any = { request: { headers: { 'x-forwarded-for': '203.0.113.5, 70.41.3.18' } } };
  const sanitizedA = sanitizeSentryEvent(eventA);
  assert(!JSON.stringify(sanitizedA).includes('203.0.113.5'), 'x-forwarded-for is gone -- the entire headers bag is deleted, not allowlisted');

  section('2. x-real-ip header is removed entirely');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const eventB: any = { request: { headers: { 'x-real-ip': '198.51.100.7' } } };
  const sanitizedB = sanitizeSentryEvent(eventB);
  assert(!JSON.stringify(sanitizedB).includes('198.51.100.7'), 'x-real-ip is gone');

  section('3. A Referer header carrying a query-string email is removed');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const eventC: any = { request: { headers: { referer: `https://phoenixops.ai/contact?prefill=${encodeURIComponent(rawEmail)}` } } };
  const sanitizedC = sanitizeSentryEvent(eventC);
  assert(!JSON.stringify(sanitizedC).includes(rawEmail), 'the Referer header (and the email embedded in its query string) is gone entirely');

  section('4. A custom, mixed-case, arbitrarily-named header is removed');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const eventD: any = { request: { headers: { 'X-Custom-Sensitive-Header': 'anything-at-all-should-be-gone' } } };
  const sanitizedD = sanitizeSentryEvent(eventD);
  assert(!JSON.stringify(sanitizedD).includes('anything-at-all-should-be-gone'), 'an arbitrary custom header (never explicitly named anywhere) is removed because the WHOLE bag is deleted, not because its specific name was matched');

  section('5. request.env is deleted if present');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const eventE: any = { request: { env: { SERVER_NAME: 'internal-host', SERVER_PORT: '3000' } } };
  const sanitizedE = sanitizeSentryEvent(eventE);
  assert(!('env' in (sanitizedE as { request: object }).request), 'request.env is deleted entirely when present');

  section('6. Span description query string is removed (not just token-redacted)');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const eventF: any = { spans: [{ description: `GET https://phoenixops.ai/api/upload/${rawToken}/sign?email=${encodeURIComponent(rawEmail)}` }] };
  const sanitizedF = sanitizeSentryEvent(eventF);
  const descF = (sanitizedF as { spans: Array<{ description: string }> }).spans[0].description;
  assert(!descF.includes(rawEmail), 'the query string (and the email in it) is stripped from the span description');
  assert(!descF.includes(rawToken), 'the token path segment is also redacted from the span description');
  assert(descF === 'GET https://phoenixops.ai/api/upload/[token]/sign', 'the surviving description is exactly the redacted path with no query string');

  section('7. Transaction name query string is removed (not just token-redacted)');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const eventG: any = { transaction: `POST https://phoenixops.ai/api/upload/${rawToken}/complete?debug=1&email=${encodeURIComponent(rawEmail)}#frag` };
  const sanitizedG = sanitizeSentryEvent(eventG);
  const txG = (sanitizedG as { transaction: string }).transaction;
  assert(!txG.includes(rawEmail) && !txG.includes('debug=1') && !txG.includes('frag'), 'the query string and fragment are stripped from the transaction name');
  assert(!txG.includes(rawToken), 'the token path segment is also redacted from the transaction name');

  section('8. Object key embedded in a transaction/span string is also redacted (regression from R3/R4)');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const eventH: any = { transaction: `PUT https://storage.example/${rawObjectKey}?x=1`, spans: [{ description: `PUT https://storage.example/${rawObjectKey}?y=2` }] };
  const sanitizedH = sanitizeSentryEvent(eventH);
  const serializedH = JSON.stringify(sanitizedH);
  assert(!serializedH.includes(rawObjectKey), 'the object key is redacted from both the transaction name and the span description, with query strings also gone');

  section('9. Safe explicit context/tag fields still survive (nothing safe is over-scrubbed)');
  const safeContext = scrubContext({
    requestId: 'req-r5',
    route: 'POST /api/upload/[token]/sign',
    errorCategory: 'upload_signing',
    statusCode: 422,
    publicReference: 'PHX-REQ-ABC123',
    safeErrorCode: 'TypeError',
  });
  assert(
    safeContext.requestId === 'req-r5' &&
      safeContext.route === 'POST /api/upload/[token]/sign' &&
      safeContext.errorCategory === 'upload_signing' &&
      safeContext.statusCode === 422 &&
      safeContext.publicReference === 'PHX-REQ-ABC123' &&
      safeContext.safeErrorCode === 'TypeError',
    'every explicit safe context field survives scrubContext unchanged'
  );

  printSummaryAndExit();
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('gate7-monitoring-gaps-r5.qa.ts failed:', error);
  process.exitCode = 1;
});
