// ============================================================
// QA: Recursive, fail-closed Sentry sanitization (R3)
// PHX-LAUNCH-001-R3 Section 5
// EXECUTED with the REAL sanitizeSentryEvent function operating on a
// deeply nested synthetic event object -- no real Sentry DSN or
// network access is used or required.
// ============================================================

import { assert, section, printSummaryAndExit } from './assert';
import { sanitizeSentryEvent } from '../../src/lib/intake/adapters/monitoring.adapter';

const rawToken = 'RAW_SECRET_UPLOAD_TOKEN_never_survive';
const rawEmail = 'deeply-nested-customer-email@example.com';
const rawMessage = 'This is the deeply nested confidential message body.';
const rawAuth = 'Bearer sk_live_nested_secret';
const rawCookie = 'session=nested-cookie-value';
const rawFilename = 'nested-confidential-file.pdf';
const rawObjectKey = 'intake/nested-session-id/nested-random-hex';

async function main() {
  section('1. Nested secrets at multiple levels do not survive (breadcrumb data)');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- synthetic event shape for this proof only
  const eventWithNestedBreadcrumb: any = {
    message: 'top-level raw message should be removed',
    logentry: { message: 'top-level logentry message should be removed', params: [rawEmail] },
    breadcrumbs: [
      {
        data: {
          // level 1
          requestContext: {
            // level 2
            user: {
              // level 3
              email: rawEmail,
              profile: {
                // level 4
                message: rawMessage,
                auth: { authorization: rawAuth }, // level 5
              },
            },
            cookie: rawCookie,
            upload: { objectKey: rawObjectKey, filename: rawFilename, token: rawToken },
          },
        },
      },
    ],
  };
  const sanitized1 = sanitizeSentryEvent(eventWithNestedBreadcrumb);
  const serialized1 = JSON.stringify(sanitized1);

  assert(!('message' in sanitized1), 'top-level raw message is removed');
  assert(!('logentry' in sanitized1), 'top-level logentry is removed');
  for (const [label, needle] of [
    ['nested email', rawEmail],
    ['nested message body', rawMessage],
    ['nested authorization', rawAuth],
    ['nested cookie', rawCookie],
    ['nested filename', rawFilename],
    ['nested object key', rawObjectKey],
  ] as const) {
    assert(!serialized1.includes(needle), `${label} does not survive at any nesting depth`);
  }
  // The upload token IS present in the raw fixture as a field VALUE
  // (`token: rawToken`), which is both a dangerous key (removed
  // outright) AND, even if it appeared inside a surviving string,
  // would be pattern-redacted -- assert the whole fixture value is gone.
  assert(!serialized1.includes(rawToken), 'nested upload token does not survive at any nesting depth');

  section('2. Bounded recursion depth: an even-deeper structure is truncated, not infinitely recursed');
  let deepObject: Record<string, unknown> = { secretAtTheBottom: rawEmail };
  for (let i = 0; i < 12; i += 1) {
    deepObject = { nested: deepObject };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const deepEvent: any = { breadcrumbs: [{ data: deepObject }] };
  let deepSanitizeThrew = false;
  let sanitizedDeep: unknown;
  try {
    sanitizedDeep = sanitizeSentryEvent(deepEvent);
  } catch {
    deepSanitizeThrew = true;
  }
  assert(!deepSanitizeThrew, 'sanitizing a 12-levels-deep structure does not throw (bounded, not unbounded, recursion)');
  assert(!JSON.stringify(sanitizedDeep).includes(rawEmail), 'the email buried 12 levels deep is still gone (dropped at the depth bound rather than let through)');

  section('3. Bounded collection size: an oversized array/object does not hang or crash sanitization');
  const hugeArray = Array.from({ length: 5000 }, (_, i) => ({ index: i, email: rawEmail }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hugeEvent: any = { breadcrumbs: [{ data: { items: hugeArray } }] };
  const start = Date.now();
  const sanitizedHuge = sanitizeSentryEvent(hugeEvent);
  const elapsedMs = Date.now() - start;
  assert(elapsedMs < 2000, `sanitizing a 5000-element array completes quickly (${elapsedMs}ms), proving the size bound is actually enforced`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items = (sanitizedHuge as any).breadcrumbs[0].data.items;
  assert(Array.isArray(items) && items.length <= 50, `the oversized array is truncated to the bounded collection size (got length ${items?.length})`);

  section('4. Span data is also recursively scrubbed');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const eventWithNestedSpan: any = {
    spans: [
      {
        description: `PUT https://storage.example/${rawObjectKey}`,
        data: { request: { headers: { authorization: rawAuth, cookie: rawCookie }, body: { email: rawEmail } } },
      },
    ],
  };
  const sanitizedSpan = sanitizeSentryEvent(eventWithNestedSpan);
  const serializedSpan = JSON.stringify(sanitizedSpan);
  assert(!serializedSpan.includes(rawAuth) && !serializedSpan.includes(rawCookie) && !serializedSpan.includes(rawEmail), 'nested secrets inside span.data are removed at every level');
  assert(!serializedSpan.includes(rawObjectKey), 'the object key embedded in the span description is redacted');

  section('5. The allowed "runtime" context is itself recursively scrubbed, not merely allowlisted by key');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const eventWithPollutedRuntimeContext: any = {
    contexts: {
      runtime: { name: 'node', version: '20.0.0', unexpectedNested: { email: rawEmail } },
      culture: { locale: 'en-US' }, // must still be dropped entirely (not in the allowlist)
    },
  };
  const sanitizedContext = sanitizeSentryEvent(eventWithPollutedRuntimeContext);
  const serializedContext = JSON.stringify(sanitizedContext);
  assert(!serializedContext.includes(rawEmail), 'an email smuggled into a nested field UNDER the allowed "runtime" context key is still removed');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assert(!('culture' in (sanitizedContext as any).contexts), 'a non-allowlisted context key (culture) is still dropped entirely');

  section('6. Tags are recursively scrubbed too');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const eventWithTags: any = { tags: { environment: 'production', nested: { email: rawEmail }, url: `https://x/api/upload/${rawToken}/sign` } };
  const sanitizedTags = sanitizeSentryEvent(eventWithTags);
  const serializedTags = JSON.stringify(sanitizedTags);
  assert(!serializedTags.includes(rawEmail), 'a nested email under tags is removed');
  assert(!serializedTags.includes(rawToken), 'a raw upload token embedded in a tag value is redacted');
  assert((sanitizedTags as { tags: { environment: string } }).tags.environment === 'production', 'a genuinely harmless flat tag value survives unchanged');

  section('7. requestId/route/errorCategory/safeErrorCode still survive (nothing safe is over-scrubbed)');
  const { scrubContext } = await import('../../src/lib/intake/adapters/monitoring.adapter');
  const safeContext = scrubContext({ requestId: 'req-1', route: 'POST /api/intake', errorCategory: 'intake_persistence', safeErrorCode: 'TypeError' });
  assert(safeContext.requestId === 'req-1' && safeContext.route === 'POST /api/intake' && safeContext.errorCategory === 'intake_persistence' && safeContext.safeErrorCode === 'TypeError', 'the explicit safe context fields all survive scrubContext unchanged');

  printSummaryAndExit();
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('gate5-monitoring-recursive-r3.qa.ts failed:', error);
  process.exitCode = 1;
});
