// ============================================================
// Phoenix Backend — Validation Response Helper
// PHX-BACKEND-004 — Request Validation & API Error Hardening
// ------------------------------------------------------------
// Single place that turns one or more ValidationIssue objects into the
// structured 400 ApiFailure this backend sends for malformed client
// input. Reuses the existing failure() envelope from
// contracts/api-response.ts rather than inventing a parallel shape.
// Never exposes stack traces or internal details beyond the issue list
// itself (field/code/message/received — all safe, client-supplied-or-
// derived values).
// ============================================================

import type { Response } from 'express';
import { ApiErrorCodes, failure } from '../contracts/api-response';
import { getRequestId } from '../lib/http';
import type { ValidationIssue } from './validators';

/**
 * Writes a structured 400 VALIDATION_ERROR response and returns void.
 * Callers should `return` immediately after calling this.
 */
export function sendValidationError(
  res: Response,
  issues: ValidationIssue | ValidationIssue[],
  requestId: string = getRequestId(res)
): void {
  const issueList = Array.isArray(issues) ? issues : [issues];

  res
    .status(400)
    .json(
      failure(ApiErrorCodes.VALIDATION_ERROR, 'Invalid request parameters.', requestId, {
        issues: issueList,
      })
    );
}
