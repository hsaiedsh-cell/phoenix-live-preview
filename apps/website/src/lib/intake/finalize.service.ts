// ============================================================
// Finalize / status-transition service
// PHX-LAUNCH-001
// ------------------------------------------------------------
// Backs POST /api/intake/:requestId/finalize. Internal-only (ops
// secret required by the route handler) — never called from
// browser code. Extracted so QA can call it directly.
//
// Issuing an upload invitation is intentionally NOT one of these
// actions — that is the dedicated
// POST /api/intake/:requestId/upload-session endpoint (see
// ./upload-session.service.ts), matching the six distinct routes in
// Section 5.2 of the execution package.
// ============================================================

import * as intakeRequestsRepo from './repositories/intake-requests.repository';
import { recordPostCommitEvent } from './post-commit';

export type FinalizeAction = 'under_review' | 'reject' | 'quote' | 'accept' | 'close';

const ACTION_TO_STATUS: Record<FinalizeAction, intakeRequestsRepo.IntakeRequestStatus> = {
  under_review: 'under_review',
  reject: 'rejected',
  quote: 'quoted',
  accept: 'accepted',
  close: 'closed',
};

const ACTION_TO_EVENT: Partial<Record<FinalizeAction, 'request.rejected' | 'request.closed'>> = {
  reject: 'request.rejected',
  close: 'request.closed',
};

export type FinalizeOutcome =
  | { kind: 'not_found' }
  | { kind: 'invalid_transition'; from: string; to: string }
  | { kind: 'ok'; status: string };

export async function finalizeIntakeRequest(requestId: string, action: FinalizeAction): Promise<FinalizeOutcome> {
  const existing = await intakeRequestsRepo.findById(requestId);
  if (!existing) return { kind: 'not_found' };

  const toStatus = ACTION_TO_STATUS[action];
  if (!intakeRequestsRepo.isAllowedStatusTransition(existing.status, toStatus)) {
    return { kind: 'invalid_transition', from: existing.status, to: toStatus };
  }

  const updated = await intakeRequestsRepo.updateStatus(requestId, existing.status, toStatus);
  if (!updated) {
    // Lost a race against a concurrent transition of the same row.
    return { kind: 'invalid_transition', from: existing.status, to: toStatus };
  }
  // R4 (§4): this action is NOT transactional with the UPDATE above
  // (updateStatus already committed via the plain global pool) -- the
  // event describing it is therefore best-effort, never throwable, so
  // a transient failure recording it can never turn an
  // already-committed status change into a reported error.
  await recordPostCommitEvent(requestId, 'request.status_changed', { route: 'finalizeIntakeRequest' }, { from: existing.status, to: toStatus });

  const specificEvent = ACTION_TO_EVENT[action];
  if (specificEvent) {
    await recordPostCommitEvent(requestId, specificEvent, { route: 'finalizeIntakeRequest' });
  }

  return { kind: 'ok', status: updated.status };
}
