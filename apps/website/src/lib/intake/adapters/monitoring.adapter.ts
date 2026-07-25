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
 * literal route template /api/upload/[token]/..., so a raw upload
 * token embedded in a URL string can never survive into a sanitized
 * event, wherever that URL string appears (event.request.url,
 * a breadcrumb's url, the transaction name, etc.).
 */
export function redactUploadTokenFromUrl(value: string): string {
  return value.replace(/\/api\/upload\/[^/?#]+/g, '/api/upload/[token]');
}

/**
 * The full Sentry event-sanitization pipeline, exported standalone
 * so it can be unit-tested with a synthetic event object without any
 * SENTRY_DSN or network access. Wired as both `beforeSend` and
 * `beforeSendTransaction` in createLiveSentryAdapter below.
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
      request.url = redactUploadTokenFromUrl(request.url);
    }
    cloned.request = request;
  }

  // User/identity (email etc.) is never attached in the first place
  // (sendDefaultPii: false), but strip defensively in case any
  // integration attaches it anyway.
  delete cloned.user;

  if (typeof cloned.transaction === 'string') {
    cloned.transaction = redactUploadTokenFromUrl(cloned.transaction);
  }

  if (Array.isArray(cloned.breadcrumbs)) {
    cloned.breadcrumbs = (cloned.breadcrumbs as Array<Record<string, unknown>>).map((crumb) => {
      const next = { ...crumb };
      if (next.data && typeof next.data === 'object') {
        const data = { ...(next.data as Record<string, unknown>) };
        if (typeof data.url === 'string') data.url = redactUploadTokenFromUrl(data.url);
        delete data.body;
        next.data = data;
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
