// ============================================================
// PHX-LAUNCH-002 R2 — transactional operator status actions
// ============================================================

import { withIntakeTransaction } from './db';
import type { OperatorAction } from './schema';
import * as eventsRepo from './repositories/intake-events.repository';
import * as intakeRequestsRepo from './repositories/intake-requests.repository';

const ACTION_TO_STATUS: Record<
  OperatorAction,
  intakeRequestsRepo.IntakeRequestStatus
> = {
  under_review: 'under_review',
  reject: 'rejected',
  quote: 'quoted',
  accept: 'accepted',
  close: 'closed',
};

const ACTION_TO_SPECIFIC_EVENT: Partial<
  Record<OperatorAction, 'request.rejected' | 'request.closed'>
> = {
  reject: 'request.rejected',
  close: 'request.closed',
};

export type OperatorActionOutcome =
  | { kind: 'not_found' }
  | {
      kind: 'invalid_transition';
      from: intakeRequestsRepo.IntakeRequestStatus;
      to: intakeRequestsRepo.IntakeRequestStatus;
    }
  | {
      kind: 'ok';
      status: intakeRequestsRepo.IntakeRequestStatus;
    };

export interface OperatorActionExecutionHooks {
  /**
   * Deterministic QA seam executed after the authoritative pre-
   * transaction snapshot and before the write transaction begins.
   * The production route never supplies this hook.
   */
  afterObserved?: (
    status: intakeRequestsRepo.IntakeRequestStatus
  ) => Promise<void>;
}

/**
 * Applies one operator action with an optimistic pre-transaction
 * status snapshot and an authoritative row lock inside the write
 * transaction.
 *
 * The snapshot lets two genuinely concurrent actions prove they
 * began from the same state. After the row lock serializes them, a
 * loser that observes a later committed state returns conflict
 * instead of applying a second transition from that new state.
 *
 * The transaction itself performs no external side effect.
 */
export async function applyOperatorAction(
  requestId: string,
  action: OperatorAction,
  actorUserId: string,
  hooks: OperatorActionExecutionHooks = {}
): Promise<OperatorActionOutcome> {
  const observed = await intakeRequestsRepo.findById(requestId);

  if (!observed) {
    return { kind: 'not_found' };
  }

  await hooks.afterObserved?.(observed.status);

  const targetStatus = ACTION_TO_STATUS[action];

  return withIntakeTransaction(async (query) => {
    const locked = await intakeRequestsRepo.lockRequestForUpdate(
      query,
      requestId
    );

    if (!locked) {
      return { kind: 'not_found' as const };
    }

    if (
      locked.status !== observed.status ||
      !intakeRequestsRepo.isAllowedStatusTransition(
        locked.status,
        targetStatus
      )
    ) {
      return {
        kind: 'invalid_transition' as const,
        from: locked.status,
        to: targetStatus,
      };
    }

    const updated =
      await intakeRequestsRepo.updateStatusInTransaction(
        query,
        requestId,
        locked.status,
        targetStatus
      );

    if (!updated) {
      return {
        kind: 'invalid_transition' as const,
        from: locked.status,
        to: targetStatus,
      };
    }

    const eventDetail = {
      actorUserId,
      source: 'phoenix_backend',
      from: locked.status,
      to: updated.status,
    };

    await eventsRepo.recordEventInTransaction(
      query,
      requestId,
      'request.status_changed',
      eventDetail
    );

    const specificEvent = ACTION_TO_SPECIFIC_EVENT[action];

    if (specificEvent) {
      await eventsRepo.recordEventInTransaction(
        query,
        requestId,
        specificEvent,
        eventDetail
      );
    }

    return {
      kind: 'ok' as const,
      status: updated.status,
    };
  });
}
