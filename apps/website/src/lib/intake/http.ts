// ============================================================
// Intake HTTP helpers -- server-only
// PHX-LAUNCH-001 (R1: PHX-LAUNCH-001-R1 §2.4, §3.1)
// ------------------------------------------------------------
// Every route handler uses these helpers so that:
//   - public error bodies are always generic (no stack traces, no
//     validation internals, no "which field" detail beyond a safe
//     field-name list already implied by the form itself);
//   - a request ID is always attached, both to the client response
//     and to the structured server-side log line and to any
//     monitoring capture, so an operator can correlate the two;
//   - request bodies are never allowed to exceed MAX_REQUEST_BODY_BYTES;
//   - R1: the raw exception object is NEVER forwarded to monitoring
//     or logged verbatim -- only a safe internal error code derived
//     from its constructor name.
// ============================================================

import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { MAX_REQUEST_BODY_BYTES } from './schema';
import { getMonitoringAdapter } from './adapters';
import { scrubContext, type ErrorCategory } from './adapters/monitoring.adapter';
import { serverConfig, publicConfig } from './config';

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
 * only a closed set of primitive fields -- there is no `...rest`
 * passthrough -- so a future caller cannot accidentally log a
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

/**
 * R1 (§3.1): a coarse, STABLE code derived only from the error's
 * constructor name -- never from its message, which may contain
 * database detail, provider responses, file paths, or other
 * request-specific data. This is the only representation of an
 * exception that ever reaches monitoring or the console in the
 * production path.
 */
export function safeInternalErrorCode(error: unknown): string {
  if (error instanceof Error) {
    const name = error.constructor?.name || error.name || 'Error';
    return name.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 64) || 'Error';
  }
  return 'UnknownError';
}

/**
 * A deliberately minimal Error subclass whose message IS the safe
 * code and nothing else. This is the "explicitly proven sanitized
 * representation" (PHX-LAUNCH-001-R1 §3.1) passed to the monitoring
 * adapter -- never the original exception.
 */
export class SanitizedInternalError extends Error {
  constructor(safeCode: string) {
    super(safeCode);
    this.name = 'SanitizedInternalError';
  }
}

export function reportInternalError(
  error: unknown,
  context: { requestId: string; route: string; errorCategory: ErrorCategory; statusCode?: number; publicReference?: string }
): void {
  const safeCode = safeInternalErrorCode(error);
  const scrubbed = scrubContext({ ...context, safeErrorCode: safeCode });
  const sanitized = new SanitizedInternalError(safeCode);
  getMonitoringAdapter().captureError(sanitized, scrubbed);
  // eslint-disable-next-line no-console -- structured server log; safeErrorCode only, NEVER error.message or a stack
  console.error(
    JSON.stringify({
      level: 'error',
      requestId: context.requestId,
      route: context.route,
      errorCategory: context.errorCategory,
      safeErrorCode: safeCode,
      statusCode: context.statusCode,
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
 * R1 (§2.4): every JSON POST route requires Content-Type:
 * application/json (ignoring charset/other parameters). Anything
 * else -- missing header, multipart/form-data, text/plain, etc. --
 * must be rejected with 415 before the body is even read.
 */
export function requireJsonContentType(request: Request): boolean {
  const contentType = request.headers.get('content-type') || '';
  return contentType.split(';')[0].trim().toLowerCase() === 'application/json';
}

/**
 * Extracts the invitation credential from a fixed-path upload API
 * request. The credential is accepted only as an exact
 * `Authorization: Bearer <43-char base64url token>` value. Missing,
 * malformed, multi-value, or differently formatted headers fail
 * closed and the raw value is never logged or returned.
 */
export function getUploadBearerToken(request: Request): string | null {
  const authorization = request.headers.get('authorization');
  if (!authorization) return null;
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorization);
  return match?.[1] ?? null;
}

/**
 * R1 (§2.4): rejects a request that Chrome/Edge/Firefox itself has
 * labeled cross-site via the Sec-Fetch-Site header. This header is
 * set by the BROWSER, not readable/forgeable by page JavaScript, so
 * it is a reliable (if not exhaustive -- older browsers and non-
 * browser HTTP clients simply omit it) signal that a request
 * originated from a page on a different site than this one and is
 * therefore not a legitimate same-site form/fetch submission.
 * Requests with no Sec-Fetch-Site header at all (e.g. curl, the ops
 * CLI hitting the two internal routes, legitimate non-browser
 * clients) are NOT blocked by this check alone -- there are no
 * server-side provider callbacks in this sprint that would need an
 * explicit exemption (PHX-LAUNCH-001-R1 §2.4).
 */
export function isCrossSiteBrowserRequest(request: Request): boolean {
  return request.headers.get('sec-fetch-site') === 'cross-site';
}

/**
 * R1 (§2.4): when an Origin header is present (same-origin fetch()
 * calls and cross-origin browser requests both send one; simple
 * top-level navigations and non-browser clients typically do not),
 * it must match either this deployment's own site origin or the
 * documented Vercel Preview origin pattern
 * (https://<project>-<hash>-<team>.vercel.app). A present-but-
 * mismatched Origin is rejected; an ABSENT Origin is not rejected by
 * this check (that case is what isCrossSiteBrowserRequest and the
 * rest of the anti-abuse stack are for).
 */
/**
 * R3 (§6): parses ALLOWED_PREVIEW_ORIGINS (a comma-separated list of
 * exact origins, e.g.
 * "https://phoenix-preview-abc123-team.vercel.app,https://phoenix-staging.vercel.app")
 * into a list of valid, parseable origin strings. A malformed entry
 * (not a valid absolute URL) is silently DROPPED, not partially
 * matched or treated as a wildcard -- a configuration mistake must
 * fail closed (that one entry simply never matches anything) rather
 * than accidentally widen what is allowed. No origin value from this
 * list, or from the incoming request, is ever logged.
 */
function getAllowedPreviewOrigins(): string[] {
  const raw = process.env.ALLOWED_PREVIEW_ORIGINS || '';
  const allowed: string[] = [];
  for (const entry of raw.split(',')) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    try {
      allowed.push(new URL(trimmed).origin);
    } catch {
      // Malformed configured origin -- dropped, fails closed.
    }
  }
  return allowed;
}

/**
 * R3 (§6): when an Origin header is present, it must match either
 * this deployment's own site origin (NEXT_PUBLIC_SITE_URL) or one of
 * the EXACT origins configured in ALLOWED_PREVIEW_ORIGINS -- there is
 * no wildcard match against `*.vercel.app` anymore (R2's version of
 * this function allowed every Vercel project's preview URL, not only
 * this project's own, which was broader than the documented policy).
 * A present-but-mismatched or malformed Origin is rejected; an ABSENT
 * Origin is not rejected by this check (that case is what
 * isCrossSiteBrowserRequest and the rest of the anti-abuse stack are
 * for).
 */
export function isOriginAllowed(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true; // no Origin header present -- not this check's concern
  let originValue: string;
  try {
    originValue = new URL(origin).origin;
  } catch {
    return false; // malformed Origin header -- fail closed
  }
  try {
    if (originValue === new URL(publicConfig.siteUrl).origin) return true;
  } catch {
    // publicConfig.siteUrl itself malformed -- fall through to the
    // preview-origin check rather than throwing.
  }
  return getAllowedPreviewOrigins().includes(originValue);
}

/**
 * Internal-only routes (finalize, upload-session issuance) require
 * this header to match INTAKE_OPS_SECRET. These routes are never
 * called from browser code -- only from the operations CLI -- so a
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

/**
 * R1 (§2.4): trusted-proxy documentation for client-IP extraction.
 *
 * In the Vercel runtime this deployment targets, `x-vercel-forwarded-for`
 * is set by Vercel's own edge network (not attacker-controllable by a
 * direct client, since Vercel overwrites/sets it at the edge before
 * the request reaches this function) and is preferred first. The
 * generic `x-forwarded-for` is used as a fallback for local
 * development and any other trusted reverse proxy in front of this
 * app; ONLY the first (leftmost) address in that header is trusted,
 * since a proxy appends the observed client address at that
 * position and everything to its right may be attacker-supplied.
 * `x-real-ip` is a last-resort fallback for simple proxies that set
 * only that header. If this app is ever deployed behind a DIFFERENT
 * proxy/CDN, this function must be revisited -- trusting the wrong
 * header lets a client spoof its own rate-limit identity.
 */
export function extractClientIp(request: Request): string | null {
  const vercelForwardedFor = request.headers.get('x-vercel-forwarded-for');
  if (vercelForwardedFor) return vercelForwardedFor.split(',')[0].trim();
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) return forwardedFor.split(',')[0].trim();
  const realIp = request.headers.get('x-real-ip');
  if (realIp) return realIp.trim();
  return null;
}
