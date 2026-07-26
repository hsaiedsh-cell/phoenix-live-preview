// ============================================================
// GET /api/upload/:token
// PHX-LAUNCH-001
// ------------------------------------------------------------
// Public endpoint, but only ever succeeds for a valid, unexpired,
// unused, non-revoked upload token. Used by the /upload/[token]
// page to check validity before rendering the upload UI.
// ============================================================

import { NextResponse } from 'next/server';
import { checkUploadToken } from '@/lib/intake/upload-flow.service';
import { newRequestId, genericErrorResponse, logIntakeEvent, reportInternalError } from '@/lib/intake/http';

export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
): Promise<NextResponse> {
  const { token } = await params;
  const requestId = newRequestId();
  const route = 'GET /api/upload/[token]';

  try {
    const outcome = await checkUploadToken(token);
    if (outcome.kind === 'denied') {
      logIntakeEvent({ requestId, route, outcome: `denied_${outcome.reason}`, statusCode: 404 });
      // Deliberately the same generic 404 for every denial reason
      // (invalid/expired/revoked/used) — the public response must
      // not let an attacker distinguish "this token never existed"
      // from "this token existed but was already used".
      return genericErrorResponse(404, 'This upload link is not valid.', requestId);
    }
    if (outcome.kind === 'finalized') {
      // R7 (§4): a minimal receipt for a token whose session has
      // already been finalized by this workflow -- deliberately
      // excludes pendingReservations, filenames, storage object keys,
      // the database request UUID, and any other customer data. This
      // does not make the token reusable for any mutation.
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
