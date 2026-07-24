// ============================================================
// Phoenix Backend — Ownership Enforcement Guards
// PHX-BACKEND-007 — Ownership Enforcement & Audit Logging Foundation
// ------------------------------------------------------------
// Route-level ownership guards, modeled directly on
// src/auth/request-actor.ts's requirePermission() contract: each
// function below either returns `true` (writes nothing) or writes a
// structured 403 FORBIDDEN ApiFailure and returns `false`. Callers must
// `return` immediately when `false` comes back.
//
// These guards run STRICTLY AFTER requirePermission() has already
// passed for the relevant permission (assessment.submit,
// evidence.create, evidence.update, evidence.delete) — they narrow an
// already-permitted action to "and does this actor specifically own
// (or is otherwise entitled to act on) this resource", using the pure
// predicates in src/auth/ownership.ts. A role that lacks the
// underlying permission never reaches these guards at all; that
// rejection still happens at requirePermission() exactly as it did in
// PHX-BACKEND-006, with its own message.
//
// ---- Response shape for an ownership failure -------------------------
// 403 FORBIDDEN (same ApiErrorCodes.FORBIDDEN as a permission failure —
// deliberately not a distinct HTTP status or top-level error code; the
// distinction between "your role can't do this at all" and "your role
// can do this but not to this particular resource" is surfaced only in
// `error.details.reason`, per the task brief's exact wording):
//   {
//     ok: false,
//     error: {
//       code: "FORBIDDEN",
//       message: "You do not have access to perform this action on this resource.",
//       details: { reason: "OWNERSHIP_REQUIRED", action: <action> }
//     },
//     requestId: <requestId>
//   }
//
// No user id, email, display name, or other actor/resource-owner
// detail is ever included in this response — "You do not have access"
// deliberately does not say who the resource belongs to instead,
// avoiding a user-enumeration/privacy leak on top of the access denial
// itself. A 404 is NOT used here for ownership failures in this dev
// sprint (see task brief Task 3 "Important" note) — the resource does
// exist and the actor does have some role-level permission on
// resources of this type; 403 is the correct signal. This is a
// documented, dev-sprint-scoped choice, not a hidden inconsistency: a
// future sprint building toward production auth may revisit whether
// existence should be hidden from actors who fail ownership (a 404-
// before-403 strategy), matching the same "known limitation" already
// recorded for PHX-BACKEND-006's read-path 404-before-403 leak.
// ============================================================

import type { Response } from 'express';
import { ApiErrorCodes, failure } from '../contracts/api-response';
import { getRequestId } from '../lib/http';
import {
  canGenerateReport,
  canManageAssessment,
  canManageEvidence,
  canSubmitAssessment,
  type AssessmentOwnershipContext,
  type EvidenceOwnershipContext,
  type ReportOwnershipContext,
} from './ownership';
import type { RequestActor } from './auth-types';

/** Actions an ownership guard can be invoked for — mirrors Task 3 exactly, plus PHX-REPORTS-004's 'reports.generate'. */
export type OwnershipAction =
  | 'assessment.submit'
  | 'evidence.create'
  | 'evidence.update'
  | 'evidence.delete'
  | 'reports.generate';

const OWNERSHIP_FAILURE_MESSAGE =
  'You do not have access to perform this action on this resource.';

function sendOwnershipFailure(res: Response, action: OwnershipAction): void {
  res
    .status(403)
    .json(
      failure(ApiErrorCodes.FORBIDDEN, OWNERSHIP_FAILURE_MESSAGE, getRequestId(res), {
        reason: 'OWNERSHIP_REQUIRED',
        action,
      })
    );
}

/**
 * Ownership guard for actions whose ownership question is answered
 * against an ASSESSMENT (not yet a specific evidence row):
 *   - 'assessment.submit' → dispatches to canSubmitAssessment()
 *   - 'evidence.create'   → dispatches to canManageAssessment() (the
 *     task brief's "Contributor: can add evidence only to assessments
 *     they own/requested" — evidence.create has no evidence row to
 *     check ownership against yet, only the parent assessment)
 *
 * Returns `true` (writes nothing) if the actor may proceed, or writes
 * a 403 FORBIDDEN and returns `false`. Callers must `return`
 * immediately when `false` comes back.
 */
export function requireAssessmentOwnership(
  actor: RequestActor,
  assessment: AssessmentOwnershipContext,
  action: 'assessment.submit' | 'evidence.create',
  res: Response
): boolean {
  const allowed =
    action === 'assessment.submit'
      ? canSubmitAssessment(actor, assessment)
      : canManageAssessment(actor, assessment);

  if (!allowed) {
    sendOwnershipFailure(res, action);
    return false;
  }

  return true;
}

/**
 * Ownership guard for actions whose ownership question is answered
 * against a specific EVIDENCE row plus its parent assessment:
 *   - 'evidence.update'
 *   - 'evidence.delete'
 * Both dispatch to canManageEvidence(). Returns `true` (writes
 * nothing) if the actor may proceed, or writes a 403 FORBIDDEN and
 * returns `false`. Callers must `return` immediately when `false`
 * comes back.
 */
export function requireEvidenceOwnership(
  actor: RequestActor,
  evidence: EvidenceOwnershipContext,
  action: 'evidence.update' | 'evidence.delete',
  res: Response
): boolean {
  if (!canManageEvidence(actor, evidence)) {
    sendOwnershipFailure(res, action);
    return false;
  }

  return true;
}

/**
 * PHX-REPORTS-004 — ownership guard for starting/retrying/regenerating a
 * report (all three Requested/Failed/Expired -> Generating transitions).
 * Dispatches to canGenerateReport(). Runs STRICTLY AFTER
 * requirePermission(..., 'reports.generate') has already passed — see
 * this file's header for the full ordering contract, unchanged for this
 * new guard. Returns `true` (writes nothing) if the actor may proceed,
 * or writes a 403 FORBIDDEN and returns `false`. Callers must `return`
 * immediately when `false` comes back.
 *
 * Per Phase 1 Addendum A §1: this same guard is used for all three
 * transitions (start/retry/regenerate) — Contributor own-only applies
 * uniformly, not just to retry/regenerate.
 */
export function requireReportOwnership(
  actor: RequestActor,
  report: ReportOwnershipContext,
  res: Response
): boolean {
  if (!canGenerateReport(actor, report)) {
    sendOwnershipFailure(res, 'reports.generate');
    return false;
  }

  return true;
}
