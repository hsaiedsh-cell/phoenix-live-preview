// ============================================================
// POST /api/upload/session/finish
// PHX-LAUNCH-001 token-transport migration
// ------------------------------------------------------------
// Fixed-path invitation-only endpoint. The raw credential is accepted
// only through Authorization: Bearer and never appears in requestPath.
// ============================================================

import { NextResponse } from 'next/server';
import { finishUploadSession } from '@/lib/intake/upload-flow.service';
import {
  newRequestId,
  genericErrorResponse,
  getUploadBearerToken,
  logIntakeEvent,
  reportInternalError,
  requireJsonContentType,
  isCrossSiteBrowserRequest,
  isOriginAllowed,
} from '@/lib/intake/http';

export const runtime = 'nodejs';

export async function POST(request: Request): Promise<NextResponse> {
  const requestId = newRequestId();
  const route = 'POST /api/upload/session/finish';
  const token = getUploadBearerToken(request);

  if (!token) {
    logIntakeEvent({ requestId, route, outcome: 'bearer_missing_or_invalid', statusCode: 404 });
    return genericErrorResponse(404, 'This upload link is not valid.', requestId);
  }
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
