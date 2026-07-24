// ============================================================
// Monitoring / error-tracking adapter (Sentry)
// PHX-LAUNCH-001
// ------------------------------------------------------------
// Route handlers depend on the `MonitoringAdapter` interface. The
// live Sentry-backed implementation is never exercised in this
// sprint's QA (no SENTRY_DSN available) — every monitoring test in
// Gate 8 runs against createFakeMonitoringAdapter and is reported as
// an adapter/mock test, not a live-Sentry test.
//
// `scrubContext` is the single choke point every caller must pass
// context through before it reaches this adapter. It allowlists a
// small set of safe keys and drops everything else, so a future
// caller accidentally adding `email` or `token` to a context object
// cannot leak it — the field is silently omitted, not forwarded.
// ============================================================

import * as Sentry from '@sentry/nextjs';
import { serverConfig } from '../config';

const ALLOWED_CONTEXT_KEYS = new Set([
  'requestId',
  'route',
  'statusCode',
  'errorCategory',
  'publicReference',
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
}

/**
 * Drops any key not in the explicit allowlist, regardless of what a
 * caller passes in. Callers are expected to already supply the
 * required fields (requestId, route, errorCategory) — this function
 * additionally strips anything beyond the allowlist as
 * defense-in-depth, so a future caller accidentally spreading extra
 * fields (e.g. `...rawRequestBody`) into the context cannot leak
 * them through to the monitoring provider.
 */
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

export interface MonitoringAdapter {
  captureError(error: unknown, context: ScrubbedContext): void;
}

let sentryInitialized = false;

export function createLiveSentryAdapter(): MonitoringAdapter {
  const dsn = serverConfig.sentryDsn;
  if (dsn && !sentryInitialized) {
    Sentry.init({ dsn, tracesSampleRate: 0.1 });
    sentryInitialized = true;
  }
  return {
    captureError(error: unknown, context: ScrubbedContext): void {
      if (!dsn) return; // no-op when unconfigured, never throws
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
