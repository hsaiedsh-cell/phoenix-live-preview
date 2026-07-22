// ============================================================
// Phoenix Backend — Assessments Routes
// PHX-BACKEND-001 — Backend Foundation & Database Skeleton
// PHX-BACKEND-003 — Read-Only Workspace & Assessment Endpoints
// PHX-BACKEND-004 — Request Validation & API Error Hardening
// PHX-BACKEND-005 — Assessment Write Endpoints Foundation
// PHX-BACKEND-006 — Auth Session Foundation & Permission Boundary
// PHX-BACKEND-007 — Ownership Enforcement & Audit Logging Foundation
// ------------------------------------------------------------
// Read-only assessment/evidence/score endpoints (PHX-BACKEND-003), the
// assessment/evidence WRITE endpoints (PHX-BACKEND-005), a
// development-only actor/permission boundary (PHX-BACKEND-006), and
// now ownership-aware enforcement for Contributor-scoped write actions
// plus governance (activity/audit) logging for every write
// (PHX-BACKEND-007) are implemented here against the real PostgreSQL
// schema. No PBRS scoring, no PBRS dimension/threshold changes — see
// @phoenix/pbrs and PBRS_STANDARD_V1_2_RELEASE_CANDIDATE.md, which
// remain the sole source of truth for scoring logic.
//
// Endpoint surface from API_CONTRACT_PHX_PLATFORM_002.md §4–6:
//   GET    /api/workspaces/:workspaceId/assessments      — IMPLEMENTED, requires actor + assessment.read
//   POST   /api/workspaces/:workspaceId/assessments      — IMPLEMENTED, requires actor + assessment.create (+ activity/audit)
//   GET    /api/assessments/:assessmentId                — IMPLEMENTED, requires actor + assessment.read
//   PATCH  /api/assessments/:assessmentId                — STUB (501, write; out of scope)
//   POST   /api/assessments/:assessmentId/submit         — IMPLEMENTED, requires actor + assessment.submit (+ ownership + activity/audit)
//   POST   /api/assessments/:assessmentId/review         — STUB (501, write; out of scope)
//   POST   /api/assessments/:assessmentId/decision       — STUB (501, write; out of scope)
//   GET    /api/assessments/:assessmentId/evidence        — IMPLEMENTED, requires actor + evidence.read
//   POST   /api/assessments/:assessmentId/evidence        — IMPLEMENTED, requires actor + evidence.create (+ ownership + immutability + activity/audit)
//   PATCH  /api/evidence/:evidenceId                      — IMPLEMENTED, requires actor + evidence.update (+ ownership + immutability + activity/audit)
//   DELETE /api/evidence/:evidenceId                      — IMPLEMENTED, requires actor + evidence.delete (+ ownership + immutability + activity/audit)
//   GET    /api/assessments/:assessmentId/score           — IMPLEMENTED, requires actor + assessment.read
//   POST   /api/assessments/:assessmentId/score/run       — STUB (501, write; scoring out of scope)
//   PATCH  /api/assessments/:assessmentId/score/override  — STUB (501, write; scoring out of scope)
//
// Response shape deviations from API_CONTRACT_PHX_PLATFORM_002.md,
// unchanged from PHX-BACKEND-003 (see
// docs/backend/PHX_BACKEND_003_IMPLEMENTATION_REPORT.md):
//   - List responses use { items, total, cursor: null }.
//   - GET .../score returns 200 with data: null when unscored.
//
// ---- PHX-BACKEND-007 ordering (every write route below follows this,
//      extending the PHX-BACKEND-006 ordering with two new steps — 8
//      and 10 below — inserted, nothing removed or reordered) --------
//   1. path params validated (400)
//   2. x-phoenix-user-id header validated for presence/shape (401/400)
//      — BEFORE any database call, so a missing/malformed header never
//      depends on database availability
//   3. request body validated with Zod, where relevant (400) — also
//      before any database call
//   4. requireDatabase() (503)
//   5. existence checks against the database (404)
//   6. workspace context resolved for assessmentId/evidenceId-only
//      routes (getWorkspaceIdForAssessment / getWorkspaceIdForEvidence)
//   7. requirePermission() — resolves the actor for that workspace and
//      enforces the route's permission (401 unknown user / 403 no
//      membership, non-Active membership, or role lacking the
//      permission)
//   8. NEW — ownership context loaded (getAssessmentOwnershipContext()/
//      getEvidenceOwnershipContext()) and requireAssessmentOwnership()/
//      requireEvidenceOwnership() enforced (403 FORBIDDEN,
//      reason: "OWNERSHIP_REQUIRED", if the actor's role has the
//      permission but does not own/may-not-act-on this specific
//      resource — see src/auth/ownership.ts and
//      src/auth/ownership-guards.ts)
//   9. state-transition / immutability checks (409), where relevant —
//      UNCHANGED semantics from PHX-BACKEND-006, but now also applied
//      to POST .../evidence (previously PATCH/DELETE only — see Task 5)
//  10. NEW — the actual write, plus an activity_logs row and an
//      audit_records row, wrapped in one database transaction via
//      db/transaction.ts's withTransaction() (see
//      repositories/activity.repository.ts / audit.repository.ts)
//
// requirePermission() internally re-validates the header and re-checks
// database availability — a small, intentional duplicate of steps 2/4
// above. This is a documented, low-risk inefficiency (an extra `SELECT
// 1` and a redundant, already-passing header re-parse), not a
// correctness issue: every code path that could actually fail already
// returned before requirePermission() is called. See
// docs/backend/PHX_BACKEND_006_IMPLEMENTATION_REPORT.md
// §"Duplicate database/header checks — accepted, documented" for the
// full rationale. PHX-BACKEND-007 does not change this.
//
// Every write handler's actor.userId now REPLACES the PHX-BACKEND-005
// Owner-fallback placeholder for requestedByUserId/uploadedByUserId —
// see the placeholder-actor comment on
// repositories/workspaces.repository.ts's getDefaultActorUserId() /
// getDefaultActorUserIdForAssessment(), which remain defined but are
// no longer reachable from any route in this file (deprecated, not
// removed, per the PHX-BACKEND-006 task brief).
// ============================================================

import { Router, type Response } from 'express';
import { asyncHandler, getRequestId } from '../lib/http';
import { ApiErrorCodes, failure, success } from '../contracts/api-response';
import { requireDatabase } from '../middleware/database-required';
import { workspaceExists } from '../repositories/workspaces.repository';
import { withTransaction } from '../db/transaction';
import {
  assessmentExists,
  assetBelongsToWorkspace,
  assetVersionBelongsToAsset,
  assetVersionExists,
  createAssessment,
  getAssessmentById,
  getAssessmentOwnershipContext,
  getEvidenceByAssessmentId,
  getScoreByAssessmentId,
  getWorkspaceIdForAssessment,
  listAssessmentsByWorkspace,
  submitAssessment,
} from '../repositories/assessments.repository';
import {
  addEvidenceItem,
  evidenceExists,
  getEvidenceItemById,
  getEvidenceOwnershipContext,
  getWorkspaceIdForEvidence,
  softDeleteEvidenceItem,
  updateEvidenceItem,
} from '../repositories/evidence.repository';
import { recordActivity } from '../repositories/activity.repository';
import { buildFieldChange, recordAudit, type FieldChange } from '../repositories/audit.repository';
import {
  parseAssessmentId,
  parseAssessmentListQuery,
  parseEvidenceId,
  parseWorkspaceId,
} from '../validation/route-params';
import { parseBodyWithSchema } from '../validation/zod-response';
import {
  AddEvidenceBodySchema,
  CreateAssessmentBodySchema,
  SubmitAssessmentBodySchema,
  UpdateEvidenceBodySchema,
} from '../validation/schemas/assessment.schemas';
import { getRequestUserId, requirePermission } from '../auth/request-actor';
import { requireAssessmentOwnership, requireEvidenceOwnership } from '../auth/ownership-guards';
import type { RequestActor } from '../auth/auth-types';

export const assessmentsRouter = Router();

function notImplemented(routeLabel: string) {
  return asyncHandler(async (_req, res) => {
    res
      .status(501)
      .json(
        failure(
          ApiErrorCodes.NOT_IMPLEMENTED,
          `${routeLabel} is not implemented in this backend sprint (PHX-BACKEND-005).`,
          getRequestId(res)
        )
      );
  });
}

/**
 * Shared "no eligible actor" response. Retained as defense-in-depth
 * only — every write route below now always passes actor.userId
 * (resolved and permission-checked) as requestedByUserId/
 * uploadedByUserId, so createAssessment()/addEvidenceItem() should
 * never actually return `no_actor_available` from a PHX-BACKEND-006
 * route. The repository functions still type this outcome because
 * their `requestedByUserId`/`uploadedByUserId` parameters remain
 * optional (unchanged signatures) and their Owner-fallback path
 * (getDefaultActorUserId/getDefaultActorUserIdForAssessment) remains
 * defined, just unreachable from here now.
 */
function sendNoActorAvailable(res: Response, fieldName: string): void {
  res
    .status(500)
    .json(
      failure(
        ApiErrorCodes.INTERNAL_ERROR,
        `No active workspace member is available to attribute this action to. ` +
          `Provide ${fieldName} explicitly until an auth sprint supplies a session-derived actor.`,
        getRequestId(res)
      )
    );
}

/** Assessment statuses from which evidence remains editable/deletable. */
const EVIDENCE_MUTABLE_STATUSES = new Set(['Draft', 'Needs Revision']);

/**
 * Same status check as requireMutableEvidence() below, but taking an
 * already-resolved status string directly (no extra DB round-trip) —
 * used by POST /api/assessments/:assessmentId/evidence (PHX-BACKEND-007
 * Task 5), which already has the parent assessment's status on hand
 * from getAssessmentOwnershipContext() and would otherwise duplicate
 * the getAssessmentIdForEvidence()/getAssessmentStatus() round-trip
 * requireMutableEvidence() performs for the evidenceId-only PATCH/
 * DELETE routes (which have no evidence row yet to derive a status
 * from any other way).
 */
function requireMutableAssessmentStatus(status: string, res: Response): boolean {
  if (!EVIDENCE_MUTABLE_STATUSES.has(status)) {
    res
      .status(409)
      .json(
        failure(
          ApiErrorCodes.CONFLICT,
          'Evidence cannot be modified after assessment submission.',
          getRequestId(res),
          { assessmentStatus: status }
        )
      );
    return false;
  }
  return true;
}

/**
 * Builds the actor_display_name value every recordActivity() call
 * needs (the column is NOT NULL — see activity.repository.ts's file
 * header). Kept as a one-line named helper only so every call site
 * reads the same way rather than repeating `actor.name` inline.
 */
function actorDisplayName(actor: RequestActor): string {
  return actor.name;
}

/**
 * PHX-BACKEND-007: superseded by requireMutableAssessmentStatus()
 * above. PATCH/DELETE /api/evidence/:evidenceId now resolve
 * getEvidenceOwnershipContext() first (needed for the new ownership
 * guard) and reuse its `assessmentStatus` field directly rather than
 * issuing the separate getAssessmentIdForEvidence()/getAssessmentStatus()
 * round-trip this function used in PHX-BACKEND-006. Removed rather
 * than kept-but-unreachable, since an unused module-level function
 * would fail this project's `noUnusedLocals` TypeScript check.
 */

// GET /api/workspaces/:workspaceId/assessments
assessmentsRouter.get(
  '/workspaces/:workspaceId/assessments',
  asyncHandler(async (req, res) => {
    const workspaceId = parseWorkspaceId(req, res);
    if (workspaceId === null) return;

    if ((await getRequestUserId(req, res)) === null) return;

    const query = parseAssessmentListQuery(req, res);
    if (query === null) return;

    if (!(await requireDatabase(res))) return;

    if (!(await workspaceExists(workspaceId))) {
      res
        .status(404)
        .json(failure(ApiErrorCodes.NOT_FOUND, 'Workspace not found.', getRequestId(res)));
      return;
    }

    const actor = await requirePermission(req, res, workspaceId, 'assessment.read');
    if (!actor) return;

    const { items, total } = await listAssessmentsByWorkspace(workspaceId, {
      status: query.status,
      limit: query.limit,
    });

    res.status(200).json(success({ items, total, cursor: null }, getRequestId(res)));
  })
);

// POST /api/workspaces/:workspaceId/assessments
// PHX-BACKEND-006: requires actor + assessment.create. actor.userId is
// used as requestedByUserId unconditionally — any client-supplied
// body.requestedByUserId is intentionally ignored (see file header
// and docs/backend/PHX_BACKEND_006_IMPLEMENTATION_REPORT.md
// §"requestedByUserId / uploadedByUserId — actor.userId always wins").
assessmentsRouter.post(
  '/workspaces/:workspaceId/assessments',
  asyncHandler(async (req, res) => {
    const workspaceId = parseWorkspaceId(req, res);
    if (workspaceId === null) return;

    if ((await getRequestUserId(req, res)) === null) return;

    const body = parseBodyWithSchema(CreateAssessmentBodySchema, req.body, res);
    if (body === null) return;

    if (!(await requireDatabase(res))) return;

    if (!(await workspaceExists(workspaceId))) {
      res
        .status(404)
        .json(failure(ApiErrorCodes.NOT_FOUND, 'Workspace not found.', getRequestId(res)));
      return;
    }

    const actor = await requirePermission(req, res, workspaceId, 'assessment.create');
    if (!actor) return;

    if (!(await assetBelongsToWorkspace(body.assetId, workspaceId))) {
      res
        .status(404)
        .json(
          failure(
            ApiErrorCodes.NOT_FOUND,
            'Asset not found in this workspace.',
            getRequestId(res)
          )
        );
      return;
    }

    if (!(await assetVersionBelongsToAsset(body.assetVersionId, body.assetId))) {
      if (!(await assetVersionExists(body.assetVersionId))) {
        res
          .status(404)
          .json(
            failure(ApiErrorCodes.NOT_FOUND, 'Asset version not found.', getRequestId(res))
          );
        return;
      }

      res
        .status(409)
        .json(
          failure(
            ApiErrorCodes.CONFLICT,
            'Asset version does not belong to the specified asset.',
            getRequestId(res)
          )
        );
      return;
    }

    const result = await withTransaction(async (client) => {
      const created = await createAssessment(
        {
          workspaceId,
          assetId: body.assetId,
          assetVersionId: body.assetVersionId,
          assignedReviewerUserId: body.assignedReviewerUserId ?? null,
          requestedByUserId: actor.userId,
          dueDate: body.dueDate ?? null,
          notes: body.notes,
        },
        client
      );

      if (created.outcome === 'no_actor_available') {
        return created;
      }

      await recordActivity(
        {
          workspaceId,
          actorUserId: actor.userId,
          actorDisplayName: actorDisplayName(actor),
          type: 'AssessmentCreated',
          summary: `Created assessment for asset "${body.assetId}".`,
          relatedEntityType: 'Assessment',
          relatedEntityId: created.assessment.id,
        },
        client
      );

      await recordAudit(
        {
          workspaceId,
          actorUserId: actor.userId,
          action: 'assessment.create',
          entityType: 'Assessment',
          entityId: created.assessment.id,
          changes: buildFieldChange('status', null, created.assessment.status),
        },
        client
      );

      return created;
    });

    if (result.outcome === 'no_actor_available') {
      sendNoActorAvailable(res, 'requestedByUserId');
      return;
    }

    res.status(201).json(success(result.assessment, getRequestId(res)));
  })
);

// GET /api/assessments/:assessmentId
assessmentsRouter.get(
  '/assessments/:assessmentId',
  asyncHandler(async (req, res) => {
    const assessmentId = parseAssessmentId(req, res);
    if (assessmentId === null) return;

    if ((await getRequestUserId(req, res)) === null) return;

    if (!(await requireDatabase(res))) return;

    const detail = await getAssessmentById(assessmentId);

    if (!detail) {
      res
        .status(404)
        .json(failure(ApiErrorCodes.NOT_FOUND, 'Assessment not found.', getRequestId(res)));
      return;
    }

    const actor = await requirePermission(req, res, detail.assessment.workspaceId, 'assessment.read');
    if (!actor) return;

    const score = await getScoreByAssessmentId(assessmentId);

    res.status(200).json(
      success(
        {
          assessment: detail.assessment,
          asset: detail.asset,
          workspace: detail.workspace,
          score,
          steps: detail.steps,
        },
        getRequestId(res)
      )
    );
  })
);

assessmentsRouter.patch('/assessments/:assessmentId', notImplemented('PATCH /api/assessments/:assessmentId'));

// POST /api/assessments/:assessmentId/submit
// PHX-BACKEND-006: requires actor + assessment.submit.
assessmentsRouter.post(
  '/assessments/:assessmentId/submit',
  asyncHandler(async (req, res) => {
    const assessmentId = parseAssessmentId(req, res);
    if (assessmentId === null) return;

    if ((await getRequestUserId(req, res)) === null) return;

    // submittedByUserId/note are validated for shape but intentionally
    // not persisted — see repositories/assessments.repository.ts's
    // submitAssessment() doc comment for why (no matching columns on
    // `assessments`).
    const body = parseBodyWithSchema(SubmitAssessmentBodySchema, req.body, res);
    if (body === null) return;

    if (!(await requireDatabase(res))) return;

    if (!(await assessmentExists(assessmentId))) {
      res
        .status(404)
        .json(failure(ApiErrorCodes.NOT_FOUND, 'Assessment not found.', getRequestId(res)));
      return;
    }

    const workspaceId = await getWorkspaceIdForAssessment(assessmentId);
    if (!workspaceId) {
      // Race: soft-deleted between the existence check above and here.
      res
        .status(404)
        .json(failure(ApiErrorCodes.NOT_FOUND, 'Assessment not found.', getRequestId(res)));
      return;
    }

    const actor = await requirePermission(req, res, workspaceId, 'assessment.submit');
    if (!actor) return;

    const ownershipContext = await getAssessmentOwnershipContext(assessmentId);
    if (!ownershipContext) {
      // Race: soft-deleted/removed between the existence check above
      // and here.
      res
        .status(404)
        .json(failure(ApiErrorCodes.NOT_FOUND, 'Assessment not found.', getRequestId(res)));
      return;
    }

    // PHX-BACKEND-007: ownership check runs BEFORE the state-transition
    // check below — see Task 4/12 ordering note. A Contributor who
    // does not own this assessment is rejected here with 403
    // regardless of the assessment's current status; a Contributor who
    // DOES own it but whose assessment is not in a submittable status
    // proceeds to submitAssessment()'s own 409 below.
    if (!requireAssessmentOwnership(actor, ownershipContext, 'assessment.submit', res)) return;

    const result = await withTransaction(async (client) => {
      const submitResult = await submitAssessment(assessmentId, client);

      if (submitResult.outcome !== 'submitted') {
        return submitResult;
      }

      await recordActivity(
        {
          workspaceId,
          actorUserId: actor.userId,
          actorDisplayName: actorDisplayName(actor),
          type: 'AssessmentSubmitted',
          summary: `Submitted assessment "${assessmentId}" for review.`,
          relatedEntityType: 'Assessment',
          relatedEntityId: assessmentId,
        },
        client
      );

      await recordAudit(
        {
          workspaceId,
          actorUserId: actor.userId,
          action: 'assessment.submit',
          entityType: 'Assessment',
          entityId: assessmentId,
          changes: buildFieldChange('status', ownershipContext.status, submitResult.assessment.status),
        },
        client
      );

      return submitResult;
    });

    if (result.outcome === 'not_found') {
      // Race: deleted between the existence check above and the
      // transactional update.
      res
        .status(404)
        .json(failure(ApiErrorCodes.NOT_FOUND, 'Assessment not found.', getRequestId(res)));
      return;
    }

    if (result.outcome === 'invalid_transition') {
      res
        .status(409)
        .json(
          failure(
            ApiErrorCodes.CONFLICT,
            `Assessment cannot be submitted from status "${result.currentStatus}".`,
            getRequestId(res),
            { currentStatus: result.currentStatus }
          )
        );
      return;
    }

    res.status(200).json(success(result.assessment, getRequestId(res)));
  })
);

assessmentsRouter.post(
  '/assessments/:assessmentId/review',
  notImplemented('POST /api/assessments/:assessmentId/review')
);
assessmentsRouter.post(
  '/assessments/:assessmentId/decision',
  notImplemented('POST /api/assessments/:assessmentId/decision')
);

// GET /api/assessments/:assessmentId/evidence
assessmentsRouter.get(
  '/assessments/:assessmentId/evidence',
  asyncHandler(async (req, res) => {
    const assessmentId = parseAssessmentId(req, res);
    if (assessmentId === null) return;

    if ((await getRequestUserId(req, res)) === null) return;

    if (!(await requireDatabase(res))) return;

    if (!(await assessmentExists(assessmentId))) {
      res
        .status(404)
        .json(failure(ApiErrorCodes.NOT_FOUND, 'Assessment not found.', getRequestId(res)));
      return;
    }

    const workspaceId = await getWorkspaceIdForAssessment(assessmentId);
    if (!workspaceId) {
      res
        .status(404)
        .json(failure(ApiErrorCodes.NOT_FOUND, 'Assessment not found.', getRequestId(res)));
      return;
    }

    const actor = await requirePermission(req, res, workspaceId, 'evidence.read');
    if (!actor) return;

    // getEvidenceByAssessmentId() already filters deleted_at IS NULL —
    // soft-deleted evidence is automatically excluded here.
    const { items, total } = await getEvidenceByAssessmentId(assessmentId);
    res.status(200).json(success({ items, total, cursor: null }, getRequestId(res)));
  })
);

// POST /api/assessments/:assessmentId/evidence
// PHX-BACKEND-006: requires actor + evidence.create. actor.userId is
// used as uploadedByUserId unconditionally — any client-supplied
// body.uploadedByUserId is intentionally ignored.
assessmentsRouter.post(
  '/assessments/:assessmentId/evidence',
  asyncHandler(async (req, res) => {
    const assessmentId = parseAssessmentId(req, res);
    if (assessmentId === null) return;

    if ((await getRequestUserId(req, res)) === null) return;

    const body = parseBodyWithSchema(AddEvidenceBodySchema, req.body, res);
    if (body === null) return;

    if (!(await requireDatabase(res))) return;

    if (!(await assessmentExists(assessmentId))) {
      res
        .status(404)
        .json(failure(ApiErrorCodes.NOT_FOUND, 'Assessment not found.', getRequestId(res)));
      return;
    }

    const workspaceId = await getWorkspaceIdForAssessment(assessmentId);
    if (!workspaceId) {
      res
        .status(404)
        .json(failure(ApiErrorCodes.NOT_FOUND, 'Assessment not found.', getRequestId(res)));
      return;
    }

    const actor = await requirePermission(req, res, workspaceId, 'evidence.create');
    if (!actor) return;

    const ownershipContext = await getAssessmentOwnershipContext(assessmentId);
    if (!ownershipContext) {
      // Race: soft-deleted/removed between the existence check above
      // and here.
      res
        .status(404)
        .json(failure(ApiErrorCodes.NOT_FOUND, 'Assessment not found.', getRequestId(res)));
      return;
    }

    // PHX-BACKEND-007: ownership before mutability, mirroring the
    // submit route's documented ordering — a Contributor who does not
    // own this assessment is rejected with 403 regardless of status;
    // an owning Contributor whose assessment has moved past Draft/
    // Needs Revision is rejected next, with 409.
    if (!requireAssessmentOwnership(actor, ownershipContext, 'evidence.create', res)) return;

    // PHX-BACKEND-007 Task 5: extends the evidence-immutability rule
    // (previously PATCH/DELETE only, PHX-BACKEND-006) to evidence
    // CREATION too — closes the gap the task brief calls out
    // explicitly.
    if (!requireMutableAssessmentStatus(ownershipContext.status, res)) return;

    const result = await withTransaction(async (client) => {
      const added = await addEvidenceItem(
        assessmentId,
        {
          type: body.type,
          title: body.title,
          note: body.note ?? null,
          fileUrl: body.fileUrl ?? null,
          externalUrl: body.externalUrl ?? null,
          relatedDimension: body.relatedDimension ?? null,
          uploadedByUserId: actor.userId,
        },
        client
      );

      if (added.outcome === 'no_actor_available') {
        return added;
      }

      await recordActivity(
        {
          workspaceId,
          actorUserId: actor.userId,
          actorDisplayName: actorDisplayName(actor),
          type: 'EvidenceAdded',
          summary: `Added evidence "${added.evidence.title}" to assessment "${assessmentId}".`,
          relatedEntityType: 'Evidence',
          relatedEntityId: added.evidence.id,
        },
        client
      );

      await recordAudit(
        {
          workspaceId,
          actorUserId: actor.userId,
          action: 'evidence.create',
          entityType: 'Evidence',
          entityId: added.evidence.id,
          changes: buildFieldChange('title', null, added.evidence.title),
        },
        client
      );

      return added;
    });

    if (result.outcome === 'no_actor_available') {
      sendNoActorAvailable(res, 'uploadedByUserId');
      return;
    }

    res.status(201).json(success(result.evidence, getRequestId(res)));
  })
);

// PATCH /api/evidence/:evidenceId
// PHX-BACKEND-006: requires actor + evidence.update, plus the
// evidence-immutability check (Task 9) once the parent assessment has
// moved past Draft/Needs Revision.
assessmentsRouter.patch(
  '/evidence/:evidenceId',
  asyncHandler(async (req, res) => {
    const evidenceId = parseEvidenceId(req, res);
    if (evidenceId === null) return;

    if ((await getRequestUserId(req, res)) === null) return;

    const body = parseBodyWithSchema(UpdateEvidenceBodySchema, req.body, res);
    if (body === null) return;

    if (!(await requireDatabase(res))) return;

    if (!(await evidenceExists(evidenceId))) {
      res
        .status(404)
        .json(failure(ApiErrorCodes.NOT_FOUND, 'Evidence not found.', getRequestId(res)));
      return;
    }

    const workspaceId = await getWorkspaceIdForEvidence(evidenceId);
    if (!workspaceId) {
      res
        .status(404)
        .json(failure(ApiErrorCodes.NOT_FOUND, 'Evidence not found.', getRequestId(res)));
      return;
    }

    const actor = await requirePermission(req, res, workspaceId, 'evidence.update');
    if (!actor) return;

    const ownershipContext = await getEvidenceOwnershipContext(evidenceId);
    if (!ownershipContext) {
      // Race: soft-deleted/removed between the existence check above
      // and here.
      res
        .status(404)
        .json(failure(ApiErrorCodes.NOT_FOUND, 'Evidence not found.', getRequestId(res)));
      return;
    }

    // PHX-BACKEND-007: ownership before mutability — a Contributor who
    // neither uploaded this evidence nor owns its parent assessment is
    // rejected with 403 regardless of status; an entitled actor whose
    // evidence has moved past Draft/Needs Revision is rejected next,
    // with 409.
    if (!requireEvidenceOwnership(actor, ownershipContext, 'evidence.update', res)) return;

    if (!requireMutableAssessmentStatus(ownershipContext.assessmentStatus, res)) return;

    const before = await getEvidenceItemById(evidenceId);

    const result = await withTransaction(async (client) => {
      const updated = await updateEvidenceItem(
        evidenceId,
        {
          title: body.title,
          note: body.note,
          fileUrl: body.fileUrl,
          externalUrl: body.externalUrl,
          relatedDimension: body.relatedDimension,
        },
        client
      );

      if (!updated) {
        return updated;
      }

      await recordActivity(
        {
          workspaceId,
          actorUserId: actor.userId,
          actorDisplayName: actorDisplayName(actor),
          type: 'EvidenceUpdated',
          summary: `Updated evidence "${updated.title}" on assessment "${ownershipContext.assessmentId}".`,
          relatedEntityType: 'Evidence',
          relatedEntityId: evidenceId,
        },
        client
      );

      // Multi-field diff — only fields actually present in the PATCH
      // body are recorded, each as its own [before, after] pair, per
      // audit.repository.ts's `changes` shape.
      const changes: Record<string, FieldChange> = {};
      if (body.title !== undefined) changes.title = [before?.title ?? null, updated.title];
      if (body.note !== undefined) changes.note = [before?.note ?? null, updated.note];
      if (body.fileUrl !== undefined) changes.fileUrl = [before?.fileUrl ?? null, updated.fileUrl];
      if (body.externalUrl !== undefined)
        changes.externalUrl = [before?.externalUrl ?? null, updated.externalUrl];
      if (body.relatedDimension !== undefined)
        changes.relatedDimension = [before?.relatedDimension ?? null, updated.relatedDimension];

      await recordAudit(
        {
          workspaceId,
          actorUserId: actor.userId,
          action: 'evidence.update',
          entityType: 'Evidence',
          entityId: evidenceId,
          changes,
        },
        client
      );

      return updated;
    });

    if (!result) {
      // Race: deleted between the existence check and the update.
      res
        .status(404)
        .json(failure(ApiErrorCodes.NOT_FOUND, 'Evidence not found.', getRequestId(res)));
      return;
    }

    res.status(200).json(success(result, getRequestId(res)));
  })
);

// DELETE /api/evidence/:evidenceId
// PHX-BACKEND-006: requires actor + evidence.delete, plus the same
// evidence-immutability check as PATCH above. Still a soft delete only
// (sets deleted_at) — never a hard DELETE FROM.
assessmentsRouter.delete(
  '/evidence/:evidenceId',
  asyncHandler(async (req, res) => {
    const evidenceId = parseEvidenceId(req, res);
    if (evidenceId === null) return;

    if ((await getRequestUserId(req, res)) === null) return;

    if (!(await requireDatabase(res))) return;

    if (!(await evidenceExists(evidenceId))) {
      res
        .status(404)
        .json(failure(ApiErrorCodes.NOT_FOUND, 'Evidence not found.', getRequestId(res)));
      return;
    }

    const workspaceId = await getWorkspaceIdForEvidence(evidenceId);
    if (!workspaceId) {
      res
        .status(404)
        .json(failure(ApiErrorCodes.NOT_FOUND, 'Evidence not found.', getRequestId(res)));
      return;
    }

    const actor = await requirePermission(req, res, workspaceId, 'evidence.delete');
    if (!actor) return;

    const ownershipContext = await getEvidenceOwnershipContext(evidenceId);
    if (!ownershipContext) {
      // Race: soft-deleted/removed between the existence check above
      // and here.
      res
        .status(404)
        .json(failure(ApiErrorCodes.NOT_FOUND, 'Evidence not found.', getRequestId(res)));
      return;
    }

    if (!requireEvidenceOwnership(actor, ownershipContext, 'evidence.delete', res)) return;

    if (!requireMutableAssessmentStatus(ownershipContext.assessmentStatus, res)) return;

    const before = await getEvidenceItemById(evidenceId);

    const deleted = await withTransaction(async (client) => {
      const wasDeleted = await softDeleteEvidenceItem(evidenceId, client);

      if (!wasDeleted) {
        return wasDeleted;
      }

      await recordActivity(
        {
          workspaceId,
          actorUserId: actor.userId,
          actorDisplayName: actorDisplayName(actor),
          type: 'EvidenceDeleted',
          summary: `Deleted evidence "${before?.title ?? evidenceId}" from assessment "${ownershipContext.assessmentId}".`,
          relatedEntityType: 'Evidence',
          relatedEntityId: evidenceId,
        },
        client
      );

      await recordAudit(
        {
          workspaceId,
          actorUserId: actor.userId,
          action: 'evidence.delete',
          entityType: 'Evidence',
          entityId: evidenceId,
          changes: buildFieldChange('deletedAt', null, new Date().toISOString()),
        },
        client
      );

      return wasDeleted;
    });

    if (!deleted) {
      // Race: already deleted between the existence check and the
      // delete itself — still a 404, not a 200/no-op.
      res
        .status(404)
        .json(failure(ApiErrorCodes.NOT_FOUND, 'Evidence not found.', getRequestId(res)));
      return;
    }

    res.status(200).json(success({ id: evidenceId, deleted: true }, getRequestId(res)));
  })
);

// GET /api/assessments/:assessmentId/score
assessmentsRouter.get(
  '/assessments/:assessmentId/score',
  asyncHandler(async (req, res) => {
    const assessmentId = parseAssessmentId(req, res);
    if (assessmentId === null) return;

    if ((await getRequestUserId(req, res)) === null) return;

    if (!(await requireDatabase(res))) return;

    if (!(await assessmentExists(assessmentId))) {
      res
        .status(404)
        .json(failure(ApiErrorCodes.NOT_FOUND, 'Assessment not found.', getRequestId(res)));
      return;
    }

    const workspaceId = await getWorkspaceIdForAssessment(assessmentId);
    if (!workspaceId) {
      res
        .status(404)
        .json(failure(ApiErrorCodes.NOT_FOUND, 'Assessment not found.', getRequestId(res)));
      return;
    }

    const actor = await requirePermission(req, res, workspaceId, 'assessment.read');
    if (!actor) return;

    // Assessment exists but may not have a score yet — that is a 200
    // with data: null, not a 404. See file header for the rationale.
    const score = await getScoreByAssessmentId(assessmentId);
    res.status(200).json(success(score, getRequestId(res)));
  })
);

assessmentsRouter.post(
  '/assessments/:assessmentId/score/run',
  notImplemented('POST /api/assessments/:assessmentId/score/run')
);
assessmentsRouter.patch(
  '/assessments/:assessmentId/score/override',
  notImplemented('PATCH /api/assessments/:assessmentId/score/override')
);
