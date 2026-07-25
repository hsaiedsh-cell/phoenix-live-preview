// ============================================================
// POST /api/intake/:requestId/upload-session
// PHX-LAUNCH-001
// ------------------------------------------------------------
// Internal-only route — issues a single-use upload invitation.
// Never called from browser code, only from the operations CLI.
// A DELETE-like revoke is exposed via the `revoke: true` body flag
// rather than a new HTTP method, to keep the route surface to
// exactly the six routes named in Section 5.2.
// ============================================================

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { issueUploadSession, revokeUploadSession } from '@/lib/intake/upload-session.service';
import {
  newRequestId,
  genericErrorResponse,
  logIntakeEvent,
  reportInternalError,
  readBoundedJsonBody,
  isValidOpsSecret,
  requireJsonContentType,
} from '@/lib/intake/http';

export const runtime = 'nodejs';

const bodySchema = z.object({ revoke: z.boolean().optional().default(false) });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ requestId: string }> }
): Promise<NextResponse> {
  const { requestId: intakeRequestId } = await params;
  const requestId = newRequestId();
  const route = 'POST /api/intake/[requestId]/upload-session';

  if (!requireJsonContentType(request)) {
    return genericErrorResponse(415, 'Unsupported Media Type.', requestId);
  }
  if (!isValidOpsSecret(request)) {
    logIntakeEvent({ requestId, route, outcome: 'ops_secret_invalid', statusCode: 401 });
    return genericErrorResponse(401, 'Unauthorized.', requestId);
  }

  const bodyResult = await readBoundedJsonBody(request);
  const parsedBody = bodyResult.ok ? bodySchema.safeParse(bodyResult.body) : null;
  const revoke = parsedBody?.success ? parsedBody.data.revoke : false;

  try {
    if (revoke) {
      const result = await revokeUploadSession(intakeRequestId);
      logIntakeEvent({ requestId, route, outcome: result.revoked ? 'revoked' : 'no_active_session', statusCode: 200 });
      return NextResponse.json({ revoked: result.revoked, requestId }, { status: 200 });
    }

    const outcome = await issueUploadSession(intakeRequestId);
    switch (outcome.kind) {
      case 'not_found':
        return genericErrorResponse(404, 'Request not found.', requestId);
      case 'invalid_transition':
        logIntakeEvent({ requestId, route, outcome: 'invalid_transition', statusCode: 409 });
        return genericErrorResponse(409, `Cannot invite upload from status ${outcome.from}.`, requestId);
      case 'session_already_active':
        logIntakeEvent({ requestId, route, outcome: 'session_already_active', statusCode: 409 });
        return genericErrorResponse(409, 'An active upload session already exists for this request.', requestId);
      case 'ok':
        logIntakeEvent({ requestId, route, outcome: 'ok', statusCode: 200 });
        return NextResponse.json(
          { expiresAt: outcome.expiresAt.toISOString(), emailSent: outcome.emailSent, requestId },
          { status: 200 }
        );
    }
  } catch (error) {
    reportInternalError(error, { requestId, route, errorCategory: 'intake_persistence' });
    return genericErrorResponse(500, 'Something went wrong.', requestId);
  }
}
