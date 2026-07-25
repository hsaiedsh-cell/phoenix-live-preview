// ============================================================
// POST /api/upload/:token/cancel
// PHX-LAUNCH-001-R4 §2.3
// ------------------------------------------------------------
// New in R4: lets the token holder release a still-`reserved`
// object's quota (a failed/ambiguous PUT, a page reload with a
// no-longer-wanted file, etc.). Public but invitation-only, same
// posture as the other upload routes. Completed reservations can
// never be cancelled; a duplicate cancel is idempotent (still a 200,
// `cancelled: false` the second time).
// ============================================================

import { NextResponse } from 'next/server';
import { cancelUploadReservation } from '@/lib/intake/upload-flow.service';
import { z } from 'zod';
import {
  newRequestId,
  genericErrorResponse,
  logIntakeEvent,
  reportInternalError,
  readBoundedJsonBody,
  requireJsonContentType,
  isCrossSiteBrowserRequest,
  isOriginAllowed,
} from '@/lib/intake/http';

export const runtime = 'nodejs';

const cancelBodySchema = z.object({
  storageObjectKey: z.string().trim().min(1).max(500),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
): Promise<NextResponse> {
  const { token } = await params;
  const requestId = newRequestId();
  const route = 'POST /api/upload/[token]/cancel';

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

  const bodyResult = await readBoundedJsonBody(request);
  if (!bodyResult.ok) {
    return genericErrorResponse(413, 'Request could not be processed.', requestId);
  }
  const parsed = cancelBodySchema.safeParse(bodyResult.body);
  if (!parsed.success) {
    return genericErrorResponse(422, 'Invalid request.', requestId);
  }

  try {
    const outcome = await cancelUploadReservation(token, parsed.data.storageObjectKey);
    switch (outcome.kind) {
      case 'denied':
        logIntakeEvent({ requestId, route, outcome: `denied_${outcome.reason}`, statusCode: 404 });
        return genericErrorResponse(404, 'This upload link is not valid.', requestId);
      case 'cancellation_denied':
        logIntakeEvent({ requestId, route, outcome: `cancellation_denied_${outcome.reason}`, statusCode: 422 });
        return genericErrorResponse(422, 'This file cannot be cancelled.', requestId);
      case 'ok':
        logIntakeEvent({ requestId, route, outcome: 'ok', statusCode: 200 });
        return NextResponse.json({ cancelled: outcome.cancelled, requestId }, { status: 200 });
    }
  } catch (error) {
    reportInternalError(error, { requestId, route, errorCategory: 'upload_completion' });
    return genericErrorResponse(500, 'Something went wrong.', requestId);
  }
}
