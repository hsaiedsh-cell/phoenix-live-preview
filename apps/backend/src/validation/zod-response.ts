// ============================================================
// Phoenix Backend — Zod Request-Body Validation Helper
// PHX-BACKEND-005 — Assessment Write Endpoints Foundation
// ------------------------------------------------------------
// Extends the PHX-BACKEND-004 path/query validation layer
// (validation/validators.ts, validation/route-params.ts,
// validation/validation-response.ts) to cover POST/PATCH request
// bodies. PHX-BACKEND-004 deliberately did not add a validation
// library because only path/query params existed to validate; this
// sprint introduces POST/PATCH bodies with nested/optional fields
// (see validation/schemas/assessment.schemas.ts), so a schema library
// (Zod) is now justified rather than hand-rolling body validators.
//
// This module does not replace validators.ts/route-params.ts — those
// remain the source of truth for path/query validation. This module
// only adds body parsing, and reuses the exact same
// VALIDATION_ERROR/400 response shape via sendValidationError() so a
// client cannot tell whether a given 400 came from a path/query
// validator or a Zod schema — the envelope is identical either way.
//
// Nothing here talks to the database, throws to the caller, or
// exposes stack traces. Route handlers must check for `null` and
// return immediately when parsing fails — the response has already
// been written.
// ============================================================

import type { Response } from 'express';
import type { z, ZodError, ZodIssue, ZodSchema } from 'zod';
import { sendValidationError } from './validation-response';
import type { ValidationIssue } from './validators';

/**
 * Converts Zod's issue list into this backend's existing
 * ValidationIssue shape, so callers of sendValidationError() never
 * need to special-case "was this a Zod error or a hand-rolled one".
 *
 * - `field` — dot/bracket path (e.g. "assignedReviewerUserId", or
 *   "items[0].title" for nested/array schemas, though this sprint's
 *   schemas are flat).
 * - `code` — Zod's own issue code (e.g. "invalid_type",
 *   "invalid_string", "too_big") — stable, safe to expose.
 * - `message` — Zod's human-readable message for that issue.
 * - `received` — included only when Zod's issue itself carries a safe
 *   "received" value (e.g. invalid_type issues); never the full
 *   original request body, to avoid echoing unrelated/oversized
 *   client input.
 */
export function formatZodIssues(error: ZodError): ValidationIssue[] {
  return error.issues.map((issue: ZodIssue) => {
    const field = issue.path.length > 0 ? issue.path.join('.') : '(body)';
    const base: ValidationIssue = {
      field,
      code: issue.code,
      message: issue.message,
    };

    if (issue.code === 'invalid_type' && 'received' in issue) {
      return { ...base, received: issue.received };
    }

    return base;
  });
}

/**
 * Parses `body` against `schema`. On success, returns the parsed
 * (and Zod-coerced/defaulted) value. On failure, writes a structured
 * 400 VALIDATION_ERROR response (aggregating every invalid field) to
 * `res` and returns `null`. Callers must `return` immediately when
 * this returns `null`.
 *
 * Deliberately synchronous-feeling (no await needed by the caller
 * beyond the route handler already being async) — Zod's `safeParse`
 * is synchronous for the schemas used in this sprint (no async
 * refinements).
 */
export function parseBodyWithSchema<Schema extends ZodSchema>(
  schema: Schema,
  body: unknown,
  res: Response
): z.infer<Schema> | null {
  const result = schema.safeParse(body);

  if (!result.success) {
    sendValidationError(res, formatZodIssues(result.error));
    return null;
  }

  return result.data;
}
