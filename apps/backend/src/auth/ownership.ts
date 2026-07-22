// ============================================================
// Phoenix Backend — Ownership Rules
// PHX-BACKEND-007 — Ownership Enforcement & Audit Logging Foundation
// ------------------------------------------------------------
// Pure, synchronous "does this actor own/may-manage this resource"
// predicates. No database, no request/response objects, no side
// effects — exactly the same shape as src/auth/permissions.ts's
// hasPermission(). Route-level enforcement (writing 403 FORBIDDEN,
// choosing the right message/details) lives in
// src/auth/ownership-guards.ts, which calls the functions below after
// the existing PHX-BACKEND-006 requirePermission() has already passed.
//
// ---- Why this exists (relationship to PHX-BACKEND-006) --------------
// PHX-BACKEND-006's permissions.ts documents, in its own header, that
// Contributor's assessment.submit is granted at the ROLE level with no
// "own resource" nuance, because no session/actor concept existed yet
// to resolve "did Contributor X create this assessment" against. That
// sprint's actor now exists (RequestActor, resolved per-request from
// x-phoenix-user-id) — this sprint adds the ownership check that was
// deferred, as an ADDITIONAL layer strictly after the existing
// permission check, never replacing it. A role that lacks a permission
// still fails at requirePermission() exactly as before; ownership
// failures are checked only once permission has already passed.
//
// ---- Rules (documented once here, mirrored in ownership-guards.ts's
//      per-action dispatch, and in
//      docs/backend/PHX_BACKEND_007_IMPLEMENTATION_REPORT.md) ---------
//
// Owner / Admin:
//   - canManageAssessment    → true, unconditionally
//   - canSubmitAssessment    → true, unconditionally
//   - canManageEvidence      → true, unconditionally
//   (Owner/Admin already carry every relevant permission at the role
//   level per permissions.ts — ownership never further restricts them.
//   This matches the task brief's "Owner/Admin: can manage all
//   assessments/evidence in workspace".)
//
// Reviewer:
//   - canManageAssessment    → true (Reviewer already has
//     evidence.update/evidence.delete at the role level, and "manage
//     assessment" in this module's vocabulary means "may act on
//     evidence attached to it" — Reviewer has no assessment.create or
//     assessment.submit permission at all, so those two paths never
//     reach this predicate for Reviewer; see permissions.ts).
//   - canSubmitAssessment    → false, unconditionally (Reviewer has no
//     assessment.submit permission at the role level — requirePermission()
//     already rejects this with 403 before any ownership check runs;
//     this predicate exists for completeness/defense-in-depth only).
//   - canManageEvidence      → true, unconditionally (matches
//     PHX-BACKEND-006's evidence.update/evidence.delete grant to
//     Reviewer — ownership does not add an "own" restriction on top of
//     Reviewer's evidence permission, per the task brief: "Reviewer:
//     can manage evidence if existing permission allows evidence.update/
//     delete").
//
// Contributor:
//   - canManageAssessment(actor, assessment) → true only if
//     assessment.requestedByUserId === actor.userId. This governs
//     evidence.create ("add evidence to assessments they own") in
//     addition to being the basis canSubmitAssessment below builds on.
//   - canSubmitAssessment(actor, assessment)  → true only if
//     assessment.requestedByUserId === actor.userId (same rule,
//     separate export per the task brief's exact function signatures —
//     kept as two functions rather than one alias so a future sprint
//     that diverges "who may submit" from "who may manage" does not
//     have to un-merge them).
//   - canManageEvidence(actor, evidence, assessment) → true if
//     EITHER evidence.uploadedByUserId === actor.userId
//     OR assessment.requestedByUserId === actor.userId.
//     (Mutability/state is enforced separately — see
//     requireMutableEvidence() in routes/assessments.ts, unchanged from
//     PHX-BACKEND-006 — this module only ever answers the ownership
//     question, never the state-transition question.)
//
// Viewer / Auditor:
//   - Every predicate below returns false for these roles. In practice
//     this is unreachable from any of the write routes: Viewer/Auditor
//     never carry assessment.create, assessment.submit, evidence.create,
//     evidence.update, or evidence.delete at the role level (see
//     permissions.ts), so requirePermission() already rejects every
//     write attempt with 403 before an ownership check would run. The
//     `false` default here is defense-in-depth only, matching the task
//     brief's "Viewer/Auditor should not reach ownership guard because
//     permission guard blocks them".
// ============================================================

import type { RequestActor } from './auth-types';

/**
 * The minimal assessment ownership fields every predicate below needs.
 * Deliberately narrower than the full AssessmentDetail/AssessmentListItem
 * shapes already defined in repositories/assessments.repository.ts — see
 * getAssessmentOwnershipContext() there, which returns exactly this
 * shape (plus a few fields ownership-guards.ts needs for messaging).
 */
export interface AssessmentOwnershipContext {
  assessmentId: string;
  workspaceId: string;
  requestedByUserId: string;
  assignedReviewerUserId: string | null;
  status: string;
}

/**
 * The minimal evidence ownership fields every predicate below needs —
 * the evidence item's own uploader plus its parent assessment's
 * ownership fields (an evidence-management decision always depends on
 * both: "did I upload this" OR "do I own the parent assessment").
 */
export interface EvidenceOwnershipContext {
  evidenceId: string;
  assessmentId: string;
  workspaceId: string;
  uploadedByUserId: string;
  assessmentRequestedByUserId: string;
  assessmentAssignedReviewerUserId: string | null;
  assessmentStatus: string;
}

/**
 * True if `actor` may manage (attach evidence to, and — for
 * Contributor — otherwise act on) `assessment`, based on ownership
 * alone. Callers must have already confirmed the actor's role carries
 * the relevant permission (assessment.create / evidence.create / etc.)
 * via requirePermission() — this function only adds the "own resource"
 * nuance permissions.ts's role-only matrix does not express.
 */
export function canManageAssessment(
  actor: RequestActor,
  assessment: AssessmentOwnershipContext
): boolean {
  switch (actor.role) {
    case 'Owner':
    case 'Admin':
      return true;
    case 'Reviewer':
      // Reviewer's evidence.create/update/delete permissions are
      // role-level (see permissions.ts) — no ownership narrowing.
      return true;
    case 'Contributor':
      return assessment.requestedByUserId === actor.userId;
    case 'Viewer':
    case 'Auditor':
    default:
      return false;
  }
}

/**
 * True if `actor` may submit `assessment` — a deliberately separate
 * export from canManageAssessment() (see file header) even though
 * Contributor's rule is identical today, so the two concerns can
 * diverge in a future sprint without an API change here.
 */
export function canSubmitAssessment(
  actor: RequestActor,
  assessment: AssessmentOwnershipContext
): boolean {
  switch (actor.role) {
    case 'Owner':
    case 'Admin':
      return true;
    case 'Contributor':
      return assessment.requestedByUserId === actor.userId;
    // Reviewer has no assessment.submit permission at the role level
    // (permissions.ts) — requirePermission() already rejects this
    // before this function would ever run for a Reviewer actor. Kept
    // explicit (not falling through to the default) so the "Reviewer
    // cannot submit" rule is visible here too, not only in
    // permissions.ts.
    case 'Reviewer':
    case 'Viewer':
    case 'Auditor':
    default:
      return false;
  }
}

/**
 * True if `actor` may update/delete (or, transitively via
 * canManageAssessment() above, create) evidence described by
 * `evidence`. `assessment` is accepted separately (rather than reading
 * evidence.assessmentRequestedByUserId alone) only for call-site
 * clarity — the two ownership contexts already carry the same
 * requestedByUserId field.
 */
export function canManageEvidence(
  actor: RequestActor,
  evidence: EvidenceOwnershipContext,
  _assessment?: AssessmentOwnershipContext
): boolean {
  switch (actor.role) {
    case 'Owner':
    case 'Admin':
      return true;
    case 'Reviewer':
      // Matches Reviewer's existing role-level evidence.update/delete
      // grant — no additional "own" restriction. See file header.
      return true;
    case 'Contributor':
      return (
        evidence.uploadedByUserId === actor.userId ||
        evidence.assessmentRequestedByUserId === actor.userId
      );
    case 'Viewer':
    case 'Auditor':
    default:
      return false;
  }
}
