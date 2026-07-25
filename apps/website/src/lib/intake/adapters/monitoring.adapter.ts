// ============================================================
// Monitoring / error-tracking adapter (Sentry)
// PHX-LAUNCH-001 (R1: PHX-LAUNCH-001-R1 §3.1, §3.2)
// ------------------------------------------------------------
// Route handlers depend on the `MonitoringAdapter` interface. The
// live Sentry-backed implementation is never exercised in this
// sprint's QA (no SENTRY_DSN available) -- every monitoring test
// runs against createFakeMonitoringAdapter and is reported as an
// adapter/mock test, not a live-Sentry test.
//
// R1: this module now enforces two independent layers of privacy
// safety:
//   1. `scrubContext` (unchanged mechanism) allowlists exactly
//      {requestId, route, errorCategory, statusCode, publicReference,
//      safeErrorCode} on the CONTEXT object callers pass in.
//   2. `sanitizeSentryEvent` (new, exported and independently
//      unit-tested) is wired as BOTH `beforeSend` and
//      `beforeSendTransaction` on the real Sentry client. It strips
//      request body/query string/cookies/authorization headers/user
//      identity from the event Sentry would otherwise assemble on
//      its own (via its Next.js auto-instrumentation), and rewrites
//      any raw URL/transaction name containing a token-shaped path
//      segment (e.g. /api/upload/<token>/...) to the route TEMPLATE
//      (/api/upload/[token]/...) so a raw upload token can never
//      appear in a Sentry event, even one Sentry captured on its
//      own outside of reportInternalError's explicit call.
//
// `sendDefaultPii: false` and `tracesSampleRate: 0` (performance
// tracing disabled for Private Beta, per §3.2) are also set here.
// ============================================================

import * as Sentry from '@sentry/nextjs';
import { serverConfig } from '../config';

type SentryInitOptions = Parameters<typeof Sentry.init>[0];
type SentryErrorEvent = NonNullable<NonNullable<SentryInitOptions>['beforeSend']> extends (event: infer E, ...rest: never[]) => unknown ? E : never;
type SentryTransactionEvent = NonNullable<NonNullable<SentryInitOptions>['beforeSendTransaction']> extends (event: infer E, ...rest: never[]) => unknown ? E : never;

const ALLOWED_CONTEXT_KEYS = new Set([
  'requestId',
  'route',
  'statusCode',
  'errorCategory',
  'publicReference',
  'safeErrorCode',
]);

export type ErrorCategory =
  | 'intake_validation'
  | 'intake_persistence'
  | 'email_delivery'
  | 'turnstile_verification'
  | 'upload_signing'
  | 'upload_completion'
  | 'rate_limiting'
  | 'unknown';

export interface ScrubbedContext {
  requestId: string;
  route: string;
  errorCategory: ErrorCategory;
  statusCode?: number;
  publicReference?: string;
  safeErrorCode?: string;
}

/** Drops any key not in the explicit allowlist, regardless of what a caller passes in. */
export function scrubContext(raw: ScrubbedContext & Record<string, unknown>): ScrubbedContext {
  const out: Record<string, unknown> = {};
  const keys = Object.keys(raw);
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    if (ALLOWED_CONTEXT_KEYS.has(key)) {
      out[key] = raw[key];
    }
  }
  return out as unknown as ScrubbedContext;
}

/**
 * Replaces any /api/upload/<anything>/... path segment with the
 * literal route template /api/upload/[token]/..., AND any
 * intake/<anything>/<anything> storage-object-key-shaped path (see
 * ../object-key.ts's generateStorageObjectKey, which always produces
 * exactly this shape) with intake/[objectKey] -- so neither a raw
 * upload token embedded in a URL nor a raw storage object key
 * embedded in a span description/URL can survive into a sanitized
 * event, wherever that string appears (event.request.url, a
 * breadcrumb's url, a span's description/data, the transaction name,
 * etc.). PHX-LAUNCH-001-R2 §6 requires object keys to never appear in
 * breadcrumbs/spans; this is what makes that true even when an object
 * key appears embedded inside a free-text string rather than under a
 * recognized field name (see DANGEROUS_DATA_KEYS below for the
 * field-name-based half of that requirement).
 */
export function redactUploadTokenFromUrl(value: string): string {
  return value
    .replace(/\/api\/upload\/[^/?#]+/g, '/api/upload/[token]')
    .replace(/intake\/[^/?#\s]+\/[^/?#\s]+/g, 'intake/[objectKey]');
}

/**
 * R2 (§6): strips the query string and fragment entirely from a URL
 * string (not merely redacting a token within it) -- a query string
 * could carry anything (search params echoing form values, etc.) and
 * R1's sanitizer only handled the SEPARATE request.query_string
 * field, not a query string embedded directly in request.url itself.
 * Falls back to the token-redacted original string if the value
 * isn't a parseable absolute URL.
 */
export function stripUrlQueryAndFragment(value: string): string {
  try {
    const url = new URL(value);
    url.search = '';
    url.hash = '';
    return redactUploadTokenFromUrl(url.toString());
  } catch {
    return redactUploadTokenFromUrl(value.split('?')[0].split('#')[0]);
  }
}

// R2 (§6): only these `event.contexts` keys are ever kept -- Sentry's
// Next.js integration can auto-populate this object with device/
// browser/culture/etc. context that has no place in a server-only
// intake API's error events. 'runtime' (Node.js version info) is the
// only key judged worth keeping; everything else is dropped
// unconditionally, whatever it contains.
const ALLOWED_CONTEXTS_KEYS = new Set(['runtime']);

// R2 (§6): keys stripped from every breadcrumb/span `data` object,
// regardless of nesting depth of the check -- filenames and object
// keys must never survive into a sanitized event, and this list is
// intentionally broad (covering common casing/naming variants) rather
// than assuming call sites will always use one exact key name.
const DANGEROUS_DATA_KEYS = new Set([
  'body',
  'email',
  'message',
  'filename',
  'fileName',
  'file_name',
  'originalFilename',
  'original_filename',
  'objectKey',
  'object_key',
  'storageObjectKey',
  'storage_object_key',
  'token',
  'uploadToken',
  'upload_token',
  'authorization',
  'cookie',
]);

// R3 (§5): a nested object under an otherwise-harmless key (e.g.
// { context: { user: { email: '...' } } }) previously survived R2's
// first-level-only scrubDataObject entirely. These bounds make the
// recursive scrubber below safe against both unbounded depth (a
// pathological or maliciously-crafted event) and unbounded breadth
// (a huge array/object attached to an event).
const MAX_SCRUB_DEPTH = 5;
const MAX_SCRUB_COLLECTION_SIZE = 50;

function scrubValue(value: unknown, depth: number): unknown {
  if (depth > MAX_SCRUB_DEPTH) return '[redacted-max-depth]';
  if (typeof value === 'string') return redactUploadTokenFromUrl(value);
  if (Array.isArray(value)) {
    return value.slice(0, MAX_SCRUB_COLLECTION_SIZE).map((entry) => scrubValue(entry, depth + 1));
  }
  if (value && typeof value === 'object') {
    return scrubDataObject(value as Record<string, unknown>, depth + 1);
  }
  return value;
}

/**
 * R3 (§5): recursively removes every DANGEROUS_DATA_KEYS key at
 * EVERY nesting level (not just the top level), redacts token/
 * object-key-shaped substrings in every string value at every level,
 * and bounds both recursion depth and collection/object size. Used
 * for breadcrumb data, span data, the allowed context's own value,
 * and tags -- anywhere Sentry's auto-instrumentation could have
 * attached arbitrarily-shaped, arbitrarily-deep data.
 */
function scrubDataObject(data: Record<string, unknown>, depth = 0): Record<string, unknown> {
  if (depth > MAX_SCRUB_DEPTH) return {};
  const next: Record<string, unknown> = {};
  const keys = Object.keys(data).slice(0, MAX_SCRUB_COLLECTION_SIZE);
  for (const key of keys) {
    if (DANGEROUS_DATA_KEYS.has(key)) continue;
    next[key] = scrubValue(data[key], depth + 1);
  }
  return next;
}

/**
 * The full Sentry event-sanitization pipeline, exported standalone
 * so it can be unit-tested with a synthetic event object without any
 * SENTRY_DSN or network access. Wired as both `beforeSend` and
 * `beforeSendTransaction` in createLiveSentryAdapter below.
 *
 * R2 (§6): this now fails closed for AUTO-INSTRUMENTED events too --
 * i.e. events Sentry's own Next.js integration captures on an
 * unhandled exception, which never pass through http.ts's
 * reportInternalError/SanitizedInternalError at all. Every field
 * below is handled defensively, assuming the incoming event may
 * still carry a raw exception message, full request context,
 * unfiltered `contexts`, and unscrubbed breadcrumbs/spans.
 */
export function sanitizeSentryEvent<T extends SentryErrorEvent | SentryTransactionEvent>(event: T): T {
  const cloned = { ...event } as unknown as Record<string, unknown>;

  if (cloned.request && typeof cloned.request === 'object') {
    const request = { ...(cloned.request as Record<string, unknown>) };
    delete request.data; // request body
    delete request.query_string;
    delete request.cookies;
    if (request.headers && typeof request.headers === 'object') {
      const headers = { ...(request.headers as Record<string, unknown>) };
      delete headers.authorization;
      delete headers.Authorization;
      delete headers.cookie;
      delete headers.Cookie;
      request.headers = headers;
    }
    if (typeof request.url === 'string') {
      // R2: strip query/fragment entirely, THEN redact any token
      // segment remaining in the path.
      request.url = stripUrlQueryAndFragment(request.url);
    }
    cloned.request = request;
  }

  // User/identity (email etc.) is never attached in the first place
  // (sendDefaultPii: false), but strip defensively in case any
  // integration attaches it anyway.
  delete cloned.user;

  // R2 (§6): `extra` is an open bag callers/integrations can put
  // anything into -- delete it unconditionally rather than trying to
  // allowlist its contents.
  delete cloned.extra;

  // R2 (§6): allowlist `contexts` down to a small known-safe set.
  // R3 (§5): additionally recursively scrub the surviving value
  // itself -- allowlisting the KEY "runtime" doesn't guarantee some
  // integration hasn't attached unexpected nested data under it.
  if (cloned.contexts && typeof cloned.contexts === 'object') {
    const contexts = cloned.contexts as Record<string, unknown>;
    const allowed: Record<string, unknown> = {};
    for (const key of Object.keys(contexts)) {
      if (ALLOWED_CONTEXTS_KEYS.has(key)) {
        const value = contexts[key];
        allowed[key] = value && typeof value === 'object' ? scrubDataObject(value as Record<string, unknown>) : value;
      }
    }
    cloned.contexts = allowed;
  }

  // R3 (§5): top-level raw `message` and `logentry` -- both can be
  // populated by Sentry's auto-instrumentation on a captured
  // console/log call or a message-only event, and neither goes
  // through the exception-value redaction path above at all.
  delete cloned.message;
  delete cloned.logentry;

  // R3 (§5): `tags` is a flat (but not necessarily shallow -- a tag
  // value can itself be an object under some integrations) bag
  // Sentry can auto-populate independently of the explicit,
  // already-safe tags reportInternalError sets itself (requestId/
  // route/errorCategory/etc.) -- scrub it the same recursive way.
  if (cloned.tags && typeof cloned.tags === 'object' && !Array.isArray(cloned.tags)) {
    cloned.tags = scrubDataObject(cloned.tags as Record<string, unknown>);
  }

  // R2 (§6): the raw exception message from an auto-instrumented
  // event must not survive -- replace it with a safe placeholder,
  // keeping only `type` (the error class name, e.g. "TypeError",
  // which carries no request-specific detail) and dropping any
  // stack-frame local variables/source context that could contain
  // sensitive values.
  if (cloned.exception && typeof cloned.exception === 'object') {
    const exception = cloned.exception as { values?: unknown };
    if (Array.isArray(exception.values)) {
      exception.values = exception.values.map((value) => {
        if (!value || typeof value !== 'object') return value;
        const entry = { ...(value as Record<string, unknown>) };
        entry.value = 'redacted';
        if (entry.stacktrace && typeof entry.stacktrace === 'object') {
          const stacktrace = { ...(entry.stacktrace as Record<string, unknown>) };
          if (Array.isArray(stacktrace.frames)) {
            stacktrace.frames = (stacktrace.frames as Array<Record<string, unknown>>).map((frame) => {
              const nextFrame = { ...frame };
              delete nextFrame.vars;
              delete nextFrame.pre_context;
              delete nextFrame.post_context;
              delete nextFrame.context_line;
              return nextFrame;
            });
          }
          entry.stacktrace = stacktrace;
        }
        return entry;
      });
    }
    cloned.exception = exception;
  }

  if (typeof cloned.transaction === 'string') {
    cloned.transaction = redactUploadTokenFromUrl(cloned.transaction);
  }

  if (Array.isArray(cloned.breadcrumbs)) {
    cloned.breadcrumbs = (cloned.breadcrumbs as Array<Record<string, unknown>>).map((crumb) => {
      const next = { ...crumb };
      if (typeof next.message === 'string') delete next.message;
      if (next.data && typeof next.data === 'object') {
        next.data = scrubDataObject(next.data as Record<string, unknown>);
      }
      return next;
    });
  }

  // R2 (§6): spans (present on transaction events) can carry a
  // `description` (often a URL or SQL-like string) and a `data`
  // object shaped just like a breadcrumb's -- scrub both the same way.
  if (Array.isArray(cloned.spans)) {
    cloned.spans = (cloned.spans as Array<Record<string, unknown>>).map((span) => {
      const next = { ...span };
      if (typeof next.description === 'string') {
        next.description = redactUploadTokenFromUrl(next.description);
      }
      if (next.data && typeof next.data === 'object') {
        next.data = scrubDataObject(next.data as Record<string, unknown>);
      }
      return next;
    });
  }

  return cloned as unknown as T;
}

export interface MonitoringAdapter {
  captureError(error: unknown, context: ScrubbedContext): void;
}

let sentryInitialized = false;

export function createLiveSentryAdapter(): MonitoringAdapter {
  const dsn = serverConfig.sentryDsn;
  if (dsn && !sentryInitialized) {
    Sentry.init({
      dsn,
      sendDefaultPii: false,
      // R1 §3.2: performance tracing disabled for Private Beta
      // unless a privacy-safe need is demonstrated.
      tracesSampleRate: 0,
      beforeSend: (event: SentryErrorEvent) => sanitizeSentryEvent(event),
      beforeSendTransaction: (event: SentryTransactionEvent) => sanitizeSentryEvent(event),
    });
    sentryInitialized = true;
  }
  return {
    captureError(error: unknown, context: ScrubbedContext): void {
      if (!dsn) return; // no-op when unconfigured, never throws
      // R1 §3.1: only ever forward the already-sanitized `error`
      // object the caller constructed (see http.ts's
      // reportInternalError, which never passes the raw exception
      // here) plus the allowlisted context -- this function has no
      // path that could forward a raw exception even if a future
      // caller tried.
      Sentry.captureException(error, { tags: { ...context } });
    },
  };
}

export interface CapturedError {
  message: string;
  context: ScrubbedContext;
}

export function createFakeMonitoringAdapter(): MonitoringAdapter & { captured: CapturedError[] } {
  const captured: CapturedError[] = [];
  return {
    captured,
    captureError(error: unknown, context: ScrubbedContext): void {
      captured.push({
        message: error instanceof Error ? error.message : String(error),
        context,
      });
    },
  };
}
