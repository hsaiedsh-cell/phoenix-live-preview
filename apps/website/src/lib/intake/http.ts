// ============================================================
// Intake HTTP helpers — server-only
// PHX-LAUNCH-001
// ------------------------------------------------------------
// Every route handler uses these helpers so that:
//   - public error bodies are always generic (no stack traces, no
//     validation internals, no "which field" detail beyond a safe
//     field-name list already implied by the form itself);
//   - a request ID is always attached, both to the client response
//     and to the structured server-side log line and to any
//     monitoring capture, so an operator can correlate the two;
//   - request bodies are never allowed to exceed MAX_REQUEST_BODY_BYTES.
// ============================================================

import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { MAX_REQUEST_BODY_BYTES } from './schema';
import { getMonitoringAdapter } from './adapters';
import { scrubContext, type ErrorCategory } from './adapters/monitoring.adapter';
import { serverConfig } from './config';

export function newRequestId(): string {
  return randomUUID();
}

export interface GenericErrorBody {
  error: string;
  requestId: string;
}

export function genericErrorResponse(status: number, message: string, requestId: string): NextResponse {
  const body: GenericErrorBody = { error: message, requestId };
  return NextResponse.json(body, { status });
}

/**
 * Structured, privacy-safe server-side log line. Deliberately takes
 * only a closed set of primitive fields — there is no `...rest`
 * passthrough — so a future caller cannot accidentally log a
 * message body, email, token, or filename through this function.
 */
export function logIntakeEvent(fields: {
  requestId: string;
  route: string;
  outcome: string;
  statusCode: number;
  publicReference?: string;
}): void {
  // eslint-disable-next-line no-console -- structured server log, intentionally minimal fields only
  console.log(
    JSON.stringify({
      level: 'info',
      requestId: fields.requestId,
      route: fields.route,
      outcome: fields.outcome,
      statusCode: fields.statusCode,
      publicReference: fields.publicReference,
      ts: new Date().toISOString(),
    })
  );
}

export function reportInternalError(
  error: unknown,
  context: { requestId: string; route: string; errorCategory: ErrorCategory; publicReference?: string }
): void {
  const scrubbed = scrubContext({ ...context });
  getMonitoringAdapter().captureError(error, scrubbed);
  // eslint-disable-next-line no-console -- structured server log; error.message only, never full request body
  console.error(
    JSON.stringify({
      level: 'error',
      requestId: context.requestId,
      route: context.route,
      errorCategory: context.errorCategory,
      message: error instanceof Error ? error.message : 'unknown_error',
      ts: new Date().toISOString(),
    })
  );
}

/** Rejects bodies over MAX_REQUEST_BODY_BYTES before any parsing/validation happens. */
export async function readBoundedJsonBody(request: Request): Promise<{ ok: true; body: unknown } | { ok: false }> {
  const contentLengthHeader = request.headers.get('content-length');
  if (contentLengthHeader && Number(contentLengthHeader) > MAX_REQUEST_BODY_BYTES) {
    return { ok: false };
  }
  const text = await request.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_REQUEST_BODY_BYTES) {
    return { ok: false };
  }
  try {
    return { ok: true, body: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

/**
 * Internal-only routes (finalize, upload-session issuance) require
 * this header to match INTAKE_OPS_SECRET. These routes are never
 * called from browser code — only from the operations CLI — so a
 * constant-time comparison against a shared secret is the intended
 * (minimum-viable, no-new-admin-UI) protection for this sprint.
 */
export function isValidOpsSecret(request: Request): boolean {
  const provided = request.headers.get('x-intake-ops-secret');
  if (!provided) return false;
  const expected = serverConfig.intakeOpsSecret;
  if (provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) {
    diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

/** Extracts the client IP from standard proxy headers, without ever persisting the raw value. */
export function extractClientIp(request: Request): string | null {
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) return forwardedFor.split(',')[0].trim();
  const realIp = request.headers.get('x-real-ip');
  if (realIp) return realIp.trim();
  return null;
}
