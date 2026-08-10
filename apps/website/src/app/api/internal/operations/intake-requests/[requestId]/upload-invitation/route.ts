import { NextResponse } from 'next/server';
import { z } from 'zod';
import { issueUploadSession } from '@/lib/intake/upload-session.service';
import {
  genericErrorResponse,
  getIntakeServiceActorUserId,
  getIntakeServiceRequestId,
  intakeServiceUnauthorizedResponse,
  isValidIntakeServiceRequest,
  logIntakeEvent,
  reportInternalError,
} from '@/lib/intake/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROUTE =
  'POST /api/internal/operations/intake-requests/[requestId]/upload-invitation';
const internalRequestIdSchema = z.string().uuid();

function noStore(response: NextResponse): NextResponse {
  response.headers.set('Cache-Control', 'no-store, private');
  return response;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ requestId: string }> }
): Promise<NextResponse> {
  const requestId = getIntakeServiceRequestId(request);

  if (!isValidIntakeServiceRequest(request)) {
    return noStore(intakeServiceUnauthorizedResponse(requestId));
  }

  const actorUserId = getIntakeServiceActorUserId(request);
  if (!actorUserId) {
    return noStore(genericErrorResponse(400, 'Invalid service actor attribution.', requestId));
  }

  const parsedRequestId = internalRequestIdSchema.safeParse((await params).requestId);
  if (!parsedRequestId.success) {
    return noStore(genericErrorResponse(400, 'Invalid request identifier.', requestId));
  }

  try {
    const outcome = await issueUploadSession(parsedRequestId.data, actorUserId);

    if (outcome.kind === 'not_found') {
      return noStore(genericErrorResponse(404, 'Request not found.', requestId));
    }

    if (
      outcome.kind === 'invalid_transition' ||
      outcome.kind === 'session_already_active'
    ) {
      return noStore(genericErrorResponse(409, 'An upload invitation cannot be issued from the current state.', requestId));
    }

    logIntakeEvent({
      requestId,
      route: ROUTE,
      outcome: outcome.emailSent ? 'ok' : 'email_failed',
      statusCode: 200,
    });

    return noStore(NextResponse.json({
      status: 'upload_invited',
      expiresAt: outcome.expiresAt.toISOString(),
      emailSent: outcome.emailSent,
      requestId,
    }));
  } catch (error) {
    reportInternalError(error, {
      requestId,
      route: ROUTE,
      errorCategory: 'intake_persistence',
      statusCode: 500,
    });
    return noStore(genericErrorResponse(500, 'Something went wrong.', requestId));
  }
}
