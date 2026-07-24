// ============================================================
// Phoenix Backend — Route Param Parsing Helpers
// PHX-BACKEND-004 — Request Validation & API Error Hardening
// ------------------------------------------------------------
// Route-level helpers that validate path/query input BEFORE any
// database call. Each helper either returns the validated value(s), or
// writes a structured 400 VALIDATION_ERROR response and returns null.
// Callers must return immediately when a helper returns null.
//
// These helpers never call the database and never throw — validation
// failures are reported synchronously via sendValidationError().
// Route modules are expected to call these before requireDatabase(),
// so malformed client input is reported as 400 even when the database
// is unavailable (see database-required.ts and
// PHX_BACKEND_004_IMPLEMENTATION_REPORT.md for the ordering rationale).
// ============================================================

import type { Request, Response } from 'express';
import { sendValidationError } from './validation-response';
import {
  ASSESSMENT_STATUSES,
  REPORT_STATUSES,
  validateLimit,
  validateOptionalStatus,
  validateOptionalString,
  validateOptionalUuid,
  validateUuid,
} from './validators';

/**
 * Validates req.params.workspaceId. Returns the workspace id on success,
 * or writes a 400 VALIDATION_ERROR and returns null on failure.
 */
export function parseWorkspaceId(req: Request, res: Response): string | null {
  const result = validateUuid(req.params.workspaceId, 'workspaceId');
  if (!result.ok) {
    sendValidationError(res, result.error);
    return null;
  }
  return result.value;
}

/**
 * Validates req.params.assessmentId. Returns the assessment id on
 * success, or writes a 400 VALIDATION_ERROR and returns null on failure.
 */
export function parseAssessmentId(req: Request, res: Response): string | null {
  const result = validateUuid(req.params.assessmentId, 'assessmentId');
  if (!result.ok) {
    sendValidationError(res, result.error);
    return null;
  }
  return result.value;
}

/**
 * Validates req.params.evidenceId. Returns the evidence id on
 * success, or writes a 400 VALIDATION_ERROR and returns null on
 * failure. Same behavior as parseWorkspaceId/parseAssessmentId — a
 * malformed evidenceId is 400 here; a well-formed-but-nonexistent
 * evidenceId is a 404 decided later by the route after a repository
 * lookup (see repositories/evidence.repository.ts's evidenceExists()/
 * getEvidenceItemById()).
 *
 * PHX-BACKEND-005.
 */
export function parseEvidenceId(req: Request, res: Response): string | null {
  const result = validateUuid(req.params.evidenceId, 'evidenceId');
  if (!result.ok) {
    sendValidationError(res, result.error);
    return null;
  }
  return result.value;
}

export interface AssessmentListQuery {
  status?: string;
  limit: number;
}

/**
 * Validates the `status` and `limit` query params for the assessment
 * list endpoint. Returns the normalized query on success, or writes a
 * 400 VALIDATION_ERROR (aggregating every invalid field found) and
 * returns null on failure.
 */
export function parseAssessmentListQuery(req: Request, res: Response): AssessmentListQuery | null {
  const statusResult = validateOptionalStatus(req.query.status, ASSESSMENT_STATUSES, 'status');
  const limitResult = validateLimit(req.query.limit, { fieldName: 'limit' });

  const issues = [
    ...(statusResult.ok ? [] : [statusResult.error]),
    ...(limitResult.ok ? [] : [limitResult.error]),
  ];

  if (issues.length > 0) {
    sendValidationError(res, issues);
    return null;
  }

  // TypeScript can't narrow the spread-based check above on its own —
  // both results are confirmed `ok: true` at this point.
  return {
    status: statusResult.ok ? statusResult.value : undefined,
    limit: limitResult.ok ? limitResult.value : 25,
  };
}

// ============================================================
// PHX-BACKEND-008 — Activity & Audit Read Endpoints
// ------------------------------------------------------------
// Query param parsers for GET /api/workspaces/:workspaceId/activity
// and GET /api/workspaces/:workspaceId/audit-records. Per the task
// brief's "Recommended minimal scope": limit + entityType + entityId,
// plus a filter field whose name differs per endpoint (`type` for
// activity, `action` for audit — matching each table's actual column
// name). No cursor param is accepted this sprint — `cursor: null` is
// always returned by the route (see task brief Task 2, "preferred for
// this sprint: keep cursor: null and support limit only").
// ============================================================

export interface ActivityListQuery {
  limit: number;
  entityType?: string;
  entityId?: string;
  type?: string;
}

export interface AuditListQuery {
  limit: number;
  entityType?: string;
  entityId?: string;
  action?: string;
}

/**
 * Validates limit/entityType/entityId/type for
 * GET /api/workspaces/:workspaceId/activity. Returns the normalized
 * query on success, or writes a 400 VALIDATION_ERROR (aggregating
 * every invalid field found) and returns null on failure.
 */
export function parseActivityListQuery(req: Request, res: Response): ActivityListQuery | null {
  const limitResult = validateLimit(req.query.limit, { fieldName: 'limit' });
  const entityTypeResult = validateOptionalString(req.query.entityType, {
    fieldName: 'entityType',
    maxLength: 100,
  });
  const entityIdResult = validateOptionalUuid(req.query.entityId, 'entityId');
  const typeResult = validateOptionalString(req.query.type, { fieldName: 'type', maxLength: 100 });

  const issues = [
    ...(limitResult.ok ? [] : [limitResult.error]),
    ...(entityTypeResult.ok ? [] : [entityTypeResult.error]),
    ...(entityIdResult.ok ? [] : [entityIdResult.error]),
    ...(typeResult.ok ? [] : [typeResult.error]),
  ];

  if (issues.length > 0) {
    sendValidationError(res, issues);
    return null;
  }

  return {
    limit: limitResult.ok ? limitResult.value : 25,
    entityType: entityTypeResult.ok ? entityTypeResult.value : undefined,
    entityId: entityIdResult.ok ? entityIdResult.value : undefined,
    type: typeResult.ok ? typeResult.value : undefined,
  };
}

/**
 * Validates limit/entityType/entityId/action for
 * GET /api/workspaces/:workspaceId/audit-records. Same shape/ordering
 * contract as parseActivityListQuery() above, with `action` in place
 * of `type` (matching audit_records.action, the actual column name).
 */
export function parseAuditListQuery(req: Request, res: Response): AuditListQuery | null {
  const limitResult = validateLimit(req.query.limit, { fieldName: 'limit' });
  const entityTypeResult = validateOptionalString(req.query.entityType, {
    fieldName: 'entityType',
    maxLength: 100,
  });
  const entityIdResult = validateOptionalUuid(req.query.entityId, 'entityId');
  const actionResult = validateOptionalString(req.query.action, {
    fieldName: 'action',
    maxLength: 100,
  });

  const issues = [
    ...(limitResult.ok ? [] : [limitResult.error]),
    ...(entityTypeResult.ok ? [] : [entityTypeResult.error]),
    ...(entityIdResult.ok ? [] : [entityIdResult.error]),
    ...(actionResult.ok ? [] : [actionResult.error]),
  ];

  if (issues.length > 0) {
    sendValidationError(res, issues);
    return null;
  }

  return {
    limit: limitResult.ok ? limitResult.value : 25,
    entityType: entityTypeResult.ok ? entityTypeResult.value : undefined,
    entityId: entityIdResult.ok ? entityIdResult.value : undefined,
    action: actionResult.ok ? actionResult.value : undefined,
  };
}

// ============================================================
// PHX-REPORTS-004 — Report Generation Lifecycle & Secure Artifact
// Delivery Foundation
// ------------------------------------------------------------
// Route param/query parsers for the four report endpoints this sprint
// implements. Same "validate before any database call, 400 on failure"
// contract as every helper above.
// ============================================================

/** Validates req.params.reportId. Same contract as parseAssessmentId/parseEvidenceId above. */
export function parseReportId(req: Request, res: Response): string | null {
  const result = validateUuid(req.params.reportId, 'reportId');
  if (!result.ok) {
    sendValidationError(res, result.error);
    return null;
  }
  return result.value;
}

export interface ReportListQuery {
  status?: string;
  limit: number;
}

/** Validates the `status` and `limit` query params for GET /api/workspaces/:workspaceId/reports. Same shape/contract as parseAssessmentListQuery. */
export function parseReportListQuery(req: Request, res: Response): ReportListQuery | null {
  const statusResult = validateOptionalStatus(req.query.status, REPORT_STATUSES, 'status');
  const limitResult = validateLimit(req.query.limit, { fieldName: 'limit' });

  const issues = [
    ...(statusResult.ok ? [] : [statusResult.error]),
    ...(limitResult.ok ? [] : [limitResult.error]),
  ];

  if (issues.length > 0) {
    sendValidationError(res, issues);
    return null;
  }

  return {
    status: statusResult.ok ? statusResult.value : undefined,
    limit: limitResult.ok ? limitResult.value : 25,
  };
}
