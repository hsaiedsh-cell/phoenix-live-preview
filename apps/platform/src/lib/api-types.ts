// ============================================================
// Phoenix Platform — API Error & Response Contract Types
// PHX-PLATFORM-009 — Backend Integration Readiness Layer
// ------------------------------------------------------------
// Generic, backend-ready request/response/error shapes shared by
// mock-api-client.ts and real-api-client.ts. These describe SHAPE
// only — no network calls, persistence, or real security lives
// here. Do not import sample-data.ts from this file.
//
// PhoenixApiResponse<T> is intentionally distinct from @phoenix/core's
// ApiResult<T> (see packages/core/src/contracts/common.ts): ApiResult<T>
// is the backend CONTRACT envelope a real endpoint will return on success.
// PhoenixApiResponse<T> is this Alpha's CLIENT-side envelope — it wraps
// both success and failure in one shape (with a `mode` tag) so UI/loading
// code can branch on `ok` without a try/catch, ahead of a real backend
// existing. When a real backend is integrated, the real client is expected
// to translate ApiResult<T>/ApiError into PhoenixApiResponse<T> at the
// boundary, not to replace it.
// ============================================================

import type { PhoenixApiMode } from './api-config';

/** Client-side error shape, uniform across mock and future real API calls. */
export interface PhoenixApiError {
  /** Stable machine-readable error code, e.g. "REAL_API_DISABLED", "VALIDATION_ERROR". */
  code: string;
  /** Human-readable message safe to surface in UI. */
  message: string;
  /** Optional structured detail (field errors, upstream payload, etc). Shape is call-site specific. */
  details?: unknown;
  /** HTTP status a real backend responded with, when applicable. Absent for mock/disabled responses. */
  status?: number;
}

/**
 * Uniform client-side response envelope. Every function that flows through
 * the api-config.ts mode boundary (see api-client.ts) resolves to this
 * shape, whether it's presently backed by mock-api-client.ts or (in a
 * future sprint) real-api-client.ts.
 */
export interface PhoenixApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: PhoenixApiError;
  /** Correlation id for support/debugging. Mock responses synthesize one; a real backend would supply its own. */
  requestId?: string;
  /** Which runtime mode produced this response — see api-config.ts. */
  mode: PhoenixApiMode;
}

/** Optional request context a future real client can thread through to a backend call. Not enforced or used for security in this Alpha — see PERMISSIONS_MODEL_PHX_PLATFORM_002.md. */
export interface PhoenixApiRequestOptions {
  workspaceId?: string;
  role?: string;
  signal?: AbortSignal;
}

/** Thrown (not returned) by lower-level client internals when a request cannot be represented as a normal PhoenixApiResponse — e.g. an unexpected exception from fetch() in a future real client. Call sites in this Alpha should not need to catch this, since mock and disabled-real paths never throw it. */
export class PhoenixApiClientError extends Error {
  code: string;
  status?: number;
  details?: unknown;

  constructor(message: string, code: string, options?: { status?: number; details?: unknown }) {
    super(message);
    this.name = 'PhoenixApiClientError';
    this.code = code;
    this.status = options?.status;
    this.details = options?.details;
  }
}
