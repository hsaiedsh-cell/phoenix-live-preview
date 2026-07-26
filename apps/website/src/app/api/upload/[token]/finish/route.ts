// ============================================================
// POST /api/upload/:token/finish
// PHX-LAUNCH-001-R2 §3.2 item 3
// ------------------------------------------------------------
// New in R2: backs the customer-facing explicit "Finish uploading"
// action. Public but invitation-only, same posture as the other
// upload routes. Takes no body beyond what the token itself implies
// -- there is nothing else for the client to declare. Goes through
// the same atomically-revalidated finalization transaction as
// completeUploadObject (see upload-flow.service.ts's
// maybeFinalizeInTransaction) so a session that was concurrently
// revoked or has expired cannot be finalized here either, and a
// zero-completed-file finish is rejected rather than silently
// "succeeding".
// ============================================================

import { NextResponse } from 'next/server';
import { finishUploadSession } from '@/lib/intake/upload-flow.service';
import {
  newRequestId,
  genericErrorResponse,
  logIntakeEvent,
  reportInternalError,
  requireJsonContentType,
  isCrossSiteBrowserRequest,
  isOriginAllowed,
} from '@/lib/intake/http';

export const runtime = 'nodejs';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
): Promise<NextResponse> {
  const { token } = await params;
  const requestId = newRequestId();
  const route = 'POST /api/upload/[token]/finish';

  if (!requireJsonContentType(request)) {
    return genericErrorResponse(415, 'Unsupported Media Type.', requestId);
  }
  if (isCrossSiteBrowserRequest(request)) {
    logIntakeEvent({ requestId, route, outcome: 'cross_site_denied', statusCode: 403 });
    return genericErrorResponse(403, 'Request denied.', requestId);
  }
  if (!isOriginAllowed(request)) {
    logIntakeEvent({ requestId, route, outcome: 'origin_denied', statusCode: 403 });
    return genericErrorResponse(403, 'Request denied.', requestId);
  }

  try {
    const outcome = await finishUploadSession(token);
    if (!outcome.ok) {
      if (outcome.reason === 'pending_reservations') {
        logIntakeEvent({ requestId, route, outcome: 'pending_reservations', statusCode: 409 });
        return NextResponse.json(
          { error: 'Please verify or cancel your other pending files before finishing.', fileCount: outcome.fileCount, reservedCount: outcome.reservedCount, requestId },
          { status: 409 }
        );
      }
      logIntakeEvent({ requestId, route, outcome: 'not_finalized', statusCode: 422 });
      return genericErrorResponse(422, 'Could not finish this upload session. Please make sure at least one file has completed.', requestId);
    }
    logIntakeEvent({ requestId, route, outcome: outcome.alreadyFinalized ? 'already_finalized' : 'finalized', statusCode: 200 });
    return NextResponse.json({ finalized: true, alreadyFinalized: outcome.alreadyFinalized, fileCount: outcome.fileCount, requestId }, { status: 200 });
  } catch (error) {
    reportInternalError(error, { requestId, route, errorCategory: 'upload_completion' });
    return genericErrorResponse(500, 'Something went wrong.', requestId);
  }
}
