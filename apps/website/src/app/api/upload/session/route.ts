// ============================================================
// GET /api/upload/session
// PHX-LAUNCH-001 token-transport migration
// ------------------------------------------------------------
// Fixed-path public endpoint. The invitation credential is supplied
// only through Authorization: Bearer and is never placed in the URL.
// ============================================================

import { NextResponse } from 'next/server';
import { checkUploadToken } from '@/lib/intake/upload-flow.service';
import {
  newRequestId,
  genericErrorResponse,
  getUploadBearerToken,
  logIntakeEvent,
  reportInternalError,
} from '@/lib/intake/http';

export const runtime = 'nodejs';

export async function GET(request: Request): Promise<NextResponse> {
  const requestId = newRequestId();
  const route = 'GET /api/upload/session';
  const token = getUploadBearerToken(request);

  if (!token) {
    logIntakeEvent({ requestId, route, outcome: 'bearer_missing_or_invalid', statusCode: 404 });
    return genericErrorResponse(404, 'This upload link is not valid.', requestId);
  }

  try {
    const outcome = await checkUploadToken(token);
    if (outcome.kind === 'denied') {
      logIntakeEvent({ requestId, route, outcome: `denied_${outcome.reason}`, statusCode: 404 });
      return genericErrorResponse(404, 'This upload link is not valid.', requestId);
    }
    if (outcome.kind === 'finalized') {
      logIntakeEvent({ requestId, route, outcome: 'finalized', statusCode: 200 });
      return NextResponse.json(
        {
          state: 'finalized',
          completedCount: outcome.completedCount,
          finalizedAt: outcome.finalizedAt.toISOString(),
          requestId,
        },
        { status: 200 }
      );
    }
    logIntakeEvent({ requestId, route, outcome: 'ok', statusCode: 200 });
    return NextResponse.json(
      {
        state: 'active',
        valid: true,
        maxFiles: outcome.maxFiles,
        maxFileSizeBytes: outcome.maxFileSizeBytes,
        maxTotalSizeBytes: outcome.maxTotalSizeBytes,
        completedCount: outcome.completedCount,
        reservedCount: outcome.reservedCount,
        reservedBytes: outcome.reservedBytes,
        completedBytes: outcome.completedBytes,
        remainingFileSlots: outcome.remainingFileSlots,
        remainingBytes: outcome.remainingBytes,
        expiresAt: outcome.expiresAt.toISOString(),
        pendingReservations: outcome.pendingReservations,
        requestId,
      },
      { status: 200 }
    );
  } catch (error) {
    reportInternalError(error, { requestId, route, errorCategory: 'upload_signing' });
    return genericErrorResponse(500, 'Something went wrong.', requestId);
  }
}
