// ============================================================
// POST /api/upload/:token/complete
// PHX-LAUNCH-001 (R1: PHX-LAUNCH-001-R1 §1.3)
// ------------------------------------------------------------
// Public endpoint, invitation-only. R1: the body is now the minimal
// { storageObjectKey, finishSession } contract -- originalFilename
// and contentType are NEVER accepted from the client here; they are
// already bound to the server-side reservation created during
// signing and are revalidated against the storage provider's own
// provider-recorded size and Content-Type metadata inside completeUploadObject.
// ============================================================

import { NextResponse } from 'next/server';
import { completeUploadObject } from '@/lib/intake/upload-flow.service';
import { uploadCompleteSchema } from '@/lib/intake/schema';
import { newRequestId, genericErrorResponse, logIntakeEvent, reportInternalError, readBoundedJsonBody, requireJsonContentType, isCrossSiteBrowserRequest, isOriginAllowed } from '@/lib/intake/http';

export const runtime = 'nodejs';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
): Promise<NextResponse> {
  const { token } = await params;
  const requestId = newRequestId();
  const route = 'POST /api/upload/[token]/complete';

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
  const parsed = uploadCompleteSchema.safeParse(bodyResult.body);
  if (!parsed.success) {
    return genericErrorResponse(422, 'Invalid request.', requestId);
  }

  try {
    const outcome = await completeUploadObject(token, parsed.data);
    switch (outcome.kind) {
      case 'denied':
        logIntakeEvent({ requestId, route, outcome: `denied_${outcome.reason}`, statusCode: 404 });
        return genericErrorResponse(404, 'This upload link is not valid.', requestId);
      case 'completion_denied':
        logIntakeEvent({ requestId, route, outcome: `completion_denied_${outcome.reason}`, statusCode: 422 });
        return genericErrorResponse(422, 'We could not verify that file. Please try again.', requestId);
      case 'pending_reservations':
        logIntakeEvent({ requestId, route, outcome: 'pending_reservations', statusCode: 409 });
        return NextResponse.json(
          { error: 'Please verify or cancel your other pending files before finishing.', fileCount: outcome.fileCount, reservedCount: outcome.reservedCount, requestId },
          { status: 409 }
        );
      case 'ok':
        logIntakeEvent({ requestId, route, outcome: outcome.replayed ? 'ok_replayed' : 'ok', statusCode: 200 });
        return NextResponse.json({ fileCount: outcome.fileCount, finalized: outcome.finalized, replayed: outcome.replayed, requestId }, { status: 200 });
    }
  } catch (error) {
    reportInternalError(error, { requestId, route, errorCategory: 'upload_completion' });
    return genericErrorResponse(500, 'Something went wrong.', requestId);
  }
}
