// ============================================================
// POST /api/upload/session/sign
// PHX-LAUNCH-001 token-transport migration
// ------------------------------------------------------------
// Fixed-path invitation-only endpoint. The raw credential is accepted
// only through Authorization: Bearer and never appears in requestPath.
// ============================================================

import { NextResponse } from 'next/server';
import { signUploadObject } from '@/lib/intake/upload-flow.service';
import { uploadSignSchema } from '@/lib/intake/schema';
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

export async function POST(request: Request): Promise<NextResponse> {
  const requestId = newRequestId();
  const route = 'POST /api/upload/session/sign';
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
  const parsed = uploadSignSchema.safeParse(bodyResult.body);
  if (!parsed.success) {
    logIntakeEvent({ requestId, route, outcome: 'validation_error', statusCode: 422 });
    return genericErrorResponse(422, 'This file cannot be accepted.', requestId);
  }

  try {
    const outcome = await signUploadObject(token, parsed.data);
    switch (outcome.kind) {
      case 'denied':
        logIntakeEvent({ requestId, route, outcome: `denied_${outcome.reason}`, statusCode: 404 });
        return genericErrorResponse(404, 'This upload link is not valid.', requestId);
      case 'rejected':
        logIntakeEvent({ requestId, route, outcome: `rejected_${outcome.reason}`, statusCode: 422 });
        return genericErrorResponse(422, 'This file cannot be accepted.', requestId);
      case 'reservation_conflict':
        logIntakeEvent({ requestId, route, outcome: 'reservation_conflict', statusCode: 409 });
        return genericErrorResponse(409, 'This file entry no longer matches its original selection. Please remove and re-add it.', requestId);
      case 'reservation_terminal':
        logIntakeEvent({ requestId, route, outcome: `reservation_terminal_${outcome.status}`, statusCode: 409 });
        return genericErrorResponse(409, 'This file has already been processed.', requestId);
      case 'signing_failed':
        logIntakeEvent({ requestId, route, outcome: 'signing_failed', statusCode: 503 });
        return genericErrorResponse(503, 'Please try again in a moment.', requestId);
      case 'ok':
        logIntakeEvent({ requestId, route, outcome: 'ok', statusCode: 200 });
        return NextResponse.json(
          { uploadUrl: outcome.uploadUrl, storageObjectKey: outcome.storageObjectKey, requestId },
          { status: 200 }
        );
    }
  } catch (error) {
    reportInternalError(error, { requestId, route, errorCategory: 'upload_signing' });
    return genericErrorResponse(500, 'Something went wrong.', requestId);
  }
}
