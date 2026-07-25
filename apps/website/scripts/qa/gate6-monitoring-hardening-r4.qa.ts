// ============================================================
// QA: Case-insensitive key matching, header-bag defaults, and
// broad URL query stripping in the recursive Sentry sanitizer (R4)
// PHX-LAUNCH-001-R4 Section 6
// EXECUTED with the REAL sanitizeSentryEvent function operating on
// synthetic event objects -- no real Sentry DSN or network access.
// ============================================================

import { assert, section, printSummaryAndExit } from './assert';
import { sanitizeSentryEvent, scrubContext } from '../../src/lib/intake/adapters/monitoring.adapter';

const rawAuth = 'Bearer sk_live_mixedcase_secret';
const rawCookie = 'session=mixedcase-cookie-value';
const rawEmail = 'mixedcase-customer@example.com';
const rawQueryString = 'debug=1&email=' + encodeURIComponent(rawEmail);

async function main() {
  section('1. Nested Authorization (capitalized) is removed');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const eventA: any = { breadcrumbs: [{ data: { nested: { Authorization: rawAuth } } }] };
  const sanitizedA = sanitizeSentryEvent(eventA);
  assert(!JSON.stringify(sanitizedA).includes(rawAuth), 'a nested key spelled "Authorization" (capitalized) is removed, not only lowercase "authorization"');

  section('2. Nested Cookie (capitalized) is removed');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const eventB: any = { breadcrumbs: [{ data: { nested: { Cookie: rawCookie } } }] };
  const sanitizedB = sanitizeSentryEvent(eventB);
  assert(!JSON.stringify(sanitizedB).includes(rawCookie), 'a nested key spelled "Cookie" (capitalized) is removed, not only lowercase "cookie"');

  section('3. Nested query string (multiple spellings, including upper-snake-case) is removed');
  for (const keyVariant of ['query', 'queryString', 'query_string', 'QUERY_STRING', 'Search', 'searchParams']) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const event: any = { spans: [{ data: { nested: { [keyVariant]: rawQueryString } } }] };
    const sanitized = sanitizeSentryEvent(event);
    assert(!JSON.stringify(sanitized).includes(rawQueryString), `a nested key spelled "${keyVariant}" is removed regardless of casing/separator style`);
  }

  section('4. A URL query email (embedded in an arbitrary nested string, not event.request.url) is removed');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const eventC: any = {
    breadcrumbs: [
      {
        data: {
          nested: { url: `https://example.test/path?email=${encodeURIComponent(rawEmail)}` },
        },
      },
    ],
  };
  const sanitizedC = sanitizeSentryEvent(eventC);
  const serializedC = JSON.stringify(sanitizedC);
  assert(!serializedC.includes(rawEmail), 'the email embedded in a NESTED url\'s query string is removed, not only in event.request.url');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assert((sanitizedC as any).breadcrumbs[0].data.nested.url === 'https://example.test/path', 'the surviving nested url has its query string stripped entirely, leaving the path intact');

  section('5. Mixed-case dangerous keys are removed at every level simultaneously');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const eventD: any = {
    breadcrumbs: [
      {
        data: {
          UPPER: { Authorization: rawAuth },
          lower: { cookie: rawCookie },
          MiXeD: { Query_String: rawQueryString },
          headers: { 'x-anything': 'should also be gone -- header bags are sensitive by default' },
        },
      },
    ],
  };
  const sanitizedD = sanitizeSentryEvent(eventD);
  const serializedD = JSON.stringify(sanitizedD);
  assert(!serializedD.includes(rawAuth), 'capitalized nested Authorization under an unrelated wrapper key is removed');
  assert(!serializedD.includes(rawCookie), 'lowercase nested cookie under an unrelated wrapper key is removed');
  assert(!serializedD.includes(rawQueryString), 'mixed-case nested Query_String under an unrelated wrapper key is removed');
  assert(!serializedD.includes('should also be gone'), 'an entire header bag (arbitrary header names) is removed by default, not allowlisted header-by-header');

  section('6. Safe request ID/category context is retained (nothing safe is over-scrubbed by the hardening)');
  const safeContext = scrubContext({ requestId: 'req-r4-qa', route: 'POST /api/upload/[token]/sign', errorCategory: 'upload_signing', safeErrorCode: 'Error' });
  assert(
    safeContext.requestId === 'req-r4-qa' && safeContext.route === 'POST /api/upload/[token]/sign' && safeContext.errorCategory === 'upload_signing' && safeContext.safeErrorCode === 'Error',
    'the explicit safe context fields all survive unchanged'
  );

  section('7. A genuinely harmless nested field survives (control case, not over-scrubbing)');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const eventE: any = { breadcrumbs: [{ data: { nested: { environment: 'production', version: '1.2.3' } } }] };
  const sanitizedE = sanitizeSentryEvent(eventE);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const survivingNested = (sanitizedE as any).breadcrumbs[0].data.nested;
  assert(survivingNested.environment === 'production' && survivingNested.version === '1.2.3', 'harmless nested fields are NOT removed -- the hardening is targeted, not a blanket wipe');

  printSummaryAndExit();
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('gate6-monitoring-hardening-r4.qa.ts failed:', error);
  process.exitCode = 1;
});
