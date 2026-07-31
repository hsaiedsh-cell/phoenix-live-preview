// ============================================================
// Best-effort post-commit operational recording
// PHX-LAUNCH-001-R3 §4
// ------------------------------------------------------------
// R2/R1 recorded email-result events (confirmation sent/failed,
// upload-invite sent/failed, upload-complete sent/failed) with a
// plain `await eventsRepo.recordEvent(...)` AFTER the core database
// transaction had already committed. If that insert itself failed
// (e.g. a transient database error), the failure propagated straight
// out of the route handler as an uncaught exception -- reported as
// HTTP 500 to the customer even though the actual, meaningful outcome
// (file completed, session finalized, request transitioned, email
// requested) had already succeeded and committed. Worse, for upload
// finalization specifically, the token is single-use and already
// consumed by that point, so the customer could not even retry to
// obtain a success response.
//
// Every caller that logs an event AFTER its core transaction has
// committed must use recordPostCommitEvent instead of calling
// eventsRepo.recordEvent directly -- this function can NEVER throw.
// A failure here is swallowed and reported only to monitoring (as a
// safe category/code, never raw detail), never surfaced to the
// customer-facing route as an error for work that already succeeded.
// ============================================================

import { recordEvent, type IntakeEventType } from './repositories/intake-events.repository';
import { getMonitoringAdapter } from './adapters';
import { scrubContext } from './adapters/monitoring.adapter';
import { safeInternalErrorCode, SanitizedInternalError } from './http';

export interface PostCommitEventResult {
  recorded: boolean;
}

export async function recordPostCommitEvent(
  requestId: string,
  eventType: IntakeEventType,
  context: { route: string },
  detail: Record<string, unknown> | null = null
): Promise<PostCommitEventResult> {
  try {
    await recordEvent(requestId, eventType, detail);
    return { recorded: true };
  } catch (error) {
    // Best-effort only: never rethrow. The caller's core outcome
    // (already committed) must still be reported as a success.
    const safeCode = safeInternalErrorCode(error);
    try {
      getMonitoringAdapter().captureError(
        new SanitizedInternalError(safeCode),
        scrubContext({
          requestId,
          route: context.route,
          errorCategory: 'unknown',
          safeErrorCode: safeCode,
        })
      );
    } catch {
      // Even monitoring itself must never be allowed to throw out of
      // this best-effort path.
    }
    return { recorded: false };
  }
}
