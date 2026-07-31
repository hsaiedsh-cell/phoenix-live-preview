// ============================================================
// POST /api/upload/session/cancel
// PHX-LAUNCH-001 token-transport migration
// ------------------------------------------------------------
// Fixed-path invitation-only endpoint. The raw credential is accepted
// only through Authorization: Bearer and never appears in requestPath.
// ============================================================

import { NextResponse } from 'next/server';
import { cancelUploadReservation } from '@/lib/intake/upload-flow.service';
import { z } from 'zod';
import {
  newRequestId,
  genericErrorResponse,
  getUploadBearerToken,
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

export async function POST(request: Request): Promise<NextResponse> {
  const requestId = newRequestId();
  const route = 'POST /api/upload/session/cancel';
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
