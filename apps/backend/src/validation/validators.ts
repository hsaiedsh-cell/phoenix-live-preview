// ============================================================
// Phoenix Backend — Validation Utilities
// PHX-BACKEND-004 — Request Validation & API Error Hardening
// ------------------------------------------------------------
// Small, dependency-free validators for path/query input. No validation
// framework is introduced this sprint — these endpoints only need UUID,
// integer-limit, and enum/status checks, and PHX-BACKEND-004 is scoped
// to hardening existing read-only routes, not to write-body validation.
// See docs/backend/PHX_BACKEND_004_IMPLEMENTATION_REPORT.md for the
// "why no Zod yet" rationale.
//
// Nothing here talks to the database, throws, or writes to a response.
// These are pure functions — response writing lives in
// validation-response.ts and route-params.ts.
// ============================================================

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ValidationIssue };

export interface ValidationIssue {
  field: string;
  code: string;
  message: string;
  received?: unknown;
}

// ---- UUID ----------------------------------------------------

// Canonical UUID shape: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx (hex,
// hyphenated 8-4-4-4-12). Deliberately not version/variant-specific —
// the schema's UUID primary keys and the dev seed data are not
// guaranteed to be strict UUIDv4, so over-constraining here would
// reject legitimate seed ids.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

export function validateUuid(value: unknown, fieldName: string): ValidationResult<string> {
  if (isUuid(value)) {
    return { ok: true, value };
  }

  return {
    ok: false,
    error: {
      field: fieldName,
      code: 'INVALID_UUID',
      message: `${fieldName} must be a valid UUID.`,
      received: value,
    },
  };
}

// ---- Limit -----------------------------------------------------

export interface ValidateLimitOptions {
  fieldName?: string;
  defaultValue?: number;
  min?: number;
  max?: number;
}

/**
 * Validates an optional "limit" query param. `undefined`/missing resolves
 * to the default (25) — that is not an error. A present-but-invalid value
 * (non-integer, out of [min, max]) is an error.
 */
export function validateLimit(
  value: unknown,
  options: ValidateLimitOptions = {}
): ValidationResult<number> {
  const fieldName = options.fieldName ?? 'limit';
  const defaultValue = options.defaultValue ?? 25;
  const min = options.min ?? 1;
  const max = options.max ?? 100;

  if (value === undefined || value === null || value === '') {
    return { ok: true, value: defaultValue };
  }

  const raw = typeof value === 'number' ? value : Number(value);

  if (typeof value !== 'number' && typeof value !== 'string') {
    return {
      ok: false,
      error: {
        field: fieldName,
        code: 'INVALID_LIMIT',
        message: `${fieldName} must be an integer between ${min} and ${max}.`,
        received: value,
      },
    };
  }

  if (!Number.isFinite(raw) || !Number.isInteger(raw) || raw < min || raw > max) {
    return {
      ok: false,
      error: {
        field: fieldName,
        code: 'INVALID_LIMIT',
        message: `${fieldName} must be an integer between ${min} and ${max}.`,
        received: value,
      },
    };
  }

  return { ok: true, value: raw };
}

// ---- Status ------------------------------------------------------

/**
 * Validates an optional "status" query param against an allow-list.
 * `undefined`/missing resolves to `undefined` (no filter) — that is not
 * an error. A present-but-unrecognized value is an error.
 */
export function validateOptionalStatus(
  value: unknown,
  allowedStatuses: readonly string[],
  fieldName = 'status'
): ValidationResult<string | undefined> {
  if (value === undefined || value === null || value === '') {
    return { ok: true, value: undefined };
  }

  if (typeof value !== 'string' || !allowedStatuses.includes(value)) {
    return {
      ok: false,
      error: {
        field: fieldName,
        code: 'INVALID_STATUS',
        message: `${fieldName} must be one of: ${allowedStatuses.join(', ')}.`,
        received: value,
      },
    };
  }

  return { ok: true, value };
}

// ---- Optional string (non-empty, max length) ------------------------

export interface ValidateOptionalStringOptions {
  fieldName?: string;
  maxLength?: number;
}

/**
 * Validates an optional free-text filter query param (e.g. activity
 * `type`, audit `action`, `entityType`). `undefined`/missing/empty
 * resolves to `undefined` (no filter) — that is not an error. A
 * present value must be a non-empty string within maxLength.
 *
 * PHX-BACKEND-008 — Activity & Audit Read Endpoints.
 */
export function validateOptionalString(
  value: unknown,
  options: ValidateOptionalStringOptions = {}
): ValidationResult<string | undefined> {
  const fieldName = options.fieldName ?? 'value';
  const maxLength = options.maxLength ?? 100;

  if (value === undefined || value === null || value === '') {
    return { ok: true, value: undefined };
  }

  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength) {
    return {
      ok: false,
      error: {
        field: fieldName,
        code: 'INVALID_STRING',
        message: `${fieldName} must be a non-empty string of at most ${maxLength} characters.`,
        received: value,
      },
    };
  }

  return { ok: true, value };
}

// ---- Optional UUID ----------------------------------------------------

/**
 * Validates an optional UUID filter query param (e.g. `entityId`).
 * `undefined`/missing/empty resolves to `undefined` (no filter) — that
 * is not an error. A present value must be a syntactically valid UUID.
 *
 * PHX-BACKEND-008 — Activity & Audit Read Endpoints.
 */
export function validateOptionalUuid(
  value: unknown,
  fieldName: string
): ValidationResult<string | undefined> {
  if (value === undefined || value === null || value === '') {
    return { ok: true, value: undefined };
  }

  if (!isUuid(value)) {
    return {
      ok: false,
      error: {
        field: fieldName,
        code: 'INVALID_UUID',
        message: `${fieldName} must be a valid UUID.`,
        received: value,
      },
    };
  }

  return { ok: true, value };
}

// ---- Shared allow-lists --------------------------------------------

/**
 * AssessmentStatus values currently used by the backend seed/schema.
 * Mirrors the PBRS six-dimension-era assessment lifecycle — no
 * deprecated PBRS dimension names appear here; this is a workflow
 * status enum, unrelated to PBRS dimensions (Accuracy, Compliance,
 * Brand Alignment, Structure, Consistency, Completeness).
 */
export const ASSESSMENT_STATUSES = [
  'Draft',
  'Submitted',
  'Under Review',
  'Approved',
  'Rejected',
  'Needs Revision',
  'Certified',
  'Archived',
] as const;

export type AssessmentStatus = (typeof ASSESSMENT_STATUSES)[number];

/**
 * ReportStatus values — matches @phoenix/core's ReportStatus enum and
 * reports.status's application-level lifecycle exactly (no CHECK
 * constraint exists on this column at the database level; this
 * allow-list is the validation-layer source of truth for what a client
 * may filter by). PHX-REPORTS-004.
 */
export const REPORT_STATUSES = ['Requested', 'Generating', 'Available', 'Expired', 'Failed'] as const;

export type ReportStatus = (typeof REPORT_STATUSES)[number];
