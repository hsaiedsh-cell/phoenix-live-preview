// ============================================================
// Phoenix Backend — Shared API Response Contract
// PHX-BACKEND-001 — Backend Foundation & Database Skeleton
// ------------------------------------------------------------
// Structured success/failure envelope for every backend response. Aligns
// in spirit with @phoenix/core's ApiResult<T>/ApiError (see
// packages/core/src/contracts/common.ts) and with the frontend's
// PhoenixApiResponse<T> (see apps/platform/src/lib/api-types.ts), but is
// kept backend-local rather than importing frontend code directly — see
// docs/backend/PHX_BACKEND_001_IMPLEMENTATION_REPORT.md §"API response
// contract" for the alignment rationale and field-by-field mapping.
//
// Every response this backend sends is one of ApiSuccess<T> or
// ApiFailure, always including a requestId for correlation.
// ============================================================

export interface ApiSuccess<T> {
  ok: true;
  data: T;
  requestId: string;
}

export interface ApiErrorDetail {
  code: string;
  message: string;
  details?: unknown;
}

export interface ApiFailure {
  ok: false;
  error: ApiErrorDetail;
  requestId: string;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

/** Well-known, stable error codes used across the backend foundation. */
export const ApiErrorCodes = {
  NOT_FOUND: 'NOT_FOUND',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  NOT_IMPLEMENTED: 'NOT_IMPLEMENTED',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  // PHX-BACKEND-005: added for write endpoints that reject an invalid
  // state transition (e.g. submitting an already-submitted assessment).
  // Not used by any PHX-BACKEND-001..004 read-only route.
  CONFLICT: 'CONFLICT',
  // PHX-BACKEND-003/database-required.ts originally defined this as a
  // local constant (DATABASE_UNAVAILABLE_CODE). Re-exported here as a
  // well-known code too, per the PHX-BACKEND-006 task brief, so every
  // stable error code lives in one place. database-required.ts still
  // exports its own constant for backward compatibility with existing
  // imports; both resolve to the same string.
  DATABASE_UNAVAILABLE: 'DATABASE_UNAVAILABLE',
  // PHX-BACKEND-006 — Auth Session Foundation & Permission Boundary.
  // Development-only actor/permission codes (see src/auth/). Never
  // used by any pre-PHX-BACKEND-006 route.
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  FORBIDDEN: 'FORBIDDEN',
  // PHX-BACKEND-009 — Production Auth Preparation. Three new,
  // additive auth-related codes. AUTH_REQUIRED and FORBIDDEN above are
  // unchanged and unrenamed.
  //   - AUTH_INVALID: reserved for a future real token verifier (e.g.
  //     a syntactically-present but invalid/expired/malformed bearer
  //     token). Not emitted by any resolver this sprint — dev-header's
  //     malformed-UUID case continues to use VALIDATION_ERROR exactly
  //     as before (see src/auth/actor-resolver.ts), and
  //     token-placeholder never attempts to parse a token at all (see
  //     AUTH_NOT_IMPLEMENTED below). Defined now so the error-code
  //     surface is complete and stable once real token verification
  //     exists.
  //   - AUTH_NOT_CONFIGURED: emitted by the production-disabled auth
  //     mode for every protected route — "no auth provider is wired up
  //     for this backend at all."
  //   - AUTH_NOT_IMPLEMENTED: emitted by the token-placeholder auth
  //     mode for every protected route — "a token seam exists but does
  //     not verify anything yet."
  AUTH_INVALID: 'AUTH_INVALID',
  AUTH_NOT_CONFIGURED: 'AUTH_NOT_CONFIGURED',
  AUTH_NOT_IMPLEMENTED: 'AUTH_NOT_IMPLEMENTED',
} as const;

export function success<T>(data: T, requestId: string): ApiSuccess<T> {
  return { ok: true, data, requestId };
}

export function failure(
  code: string,
  message: string,
  requestId: string,
  details?: unknown
): ApiFailure {
  return {
    ok: false,
    error: { code, message, ...(details !== undefined ? { details } : {}) },
    requestId,
  };
}
