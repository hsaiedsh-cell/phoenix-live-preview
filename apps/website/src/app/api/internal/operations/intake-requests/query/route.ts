// ============================================================
// POST /api/internal/operations/intake-requests/query
// PHX-LAUNCH-002 R2 — Website service read route
// ============================================================

import { NextResponse } from 'next/server';
import { operatorQueueQuerySchema } from '@/lib/intake/schema';
import { queryOperatorQueue } from '@/lib/intake/repositories/intake-requests.repository';
import {
  genericErrorResponse,
  getIntakeServiceRequestId,
  intakeServiceUnauthorizedResponse,
  isValidIntakeServiceRequest,
  logIntakeEvent,
  readBoundedJsonBody,
  reportInternalError,
  requireJsonContentType,
} from '@/lib/intake/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROUTE = 'POST /api/internal/operations/intake-requests/query';

function noStore(response: NextResponse): NextResponse {
  response.headers.set('Cache-Control', 'no-store, private');
  return response;
}

export async function POST(request: Request): Promise<NextResponse> {
  const requestId = getIntakeServiceRequestId(request);

  if (!isValidIntakeServiceRequest(request)) {
    logIntakeEvent({
      requestId,
      route: ROUTE,
      outcome: 'service_auth_invalid',
      statusCode: 401,
    });
    return noStore(intakeServiceUnauthorizedResponse(requestId));
  }

  if (!requireJsonContentType(request)) {
    logIntakeEvent({
      requestId,
      route: ROUTE,
      outcome: 'unsupported_content_type',
      statusCode: 415,
    });
    return noStore(genericErrorResponse(415, 'Unsupported Media Type.', requestId));
  }

  const bodyResult = await readBoundedJsonBody(request);
  if (!bodyResult.ok) {
    logIntakeEvent({
      requestId,
      route: ROUTE,
      outcome: 'invalid_body',
      statusCode: 400,
    });
    return noStore(genericErrorResponse(400, 'Invalid request body.', requestId));
  }

  const parsed = operatorQueueQuerySchema.safeParse(bodyResult.body);
  if (!parsed.success) {
    logIntakeEvent({
      requestId,
      route: ROUTE,
      outcome: 'validation_error',
      statusCode: 400,
    });
    return noStore(genericErrorResponse(400, 'Invalid request body.', requestId));
  }

  try {
    const result = await queryOperatorQueue(parsed.data);

    logIntakeEvent({
      requestId,
      route: ROUTE,
      outcome: 'ok',
      statusCode: 200,
    });

    return noStore(
      NextResponse.json(
        {
          ...result,
          requestId,
        },
        { status: 200 }
      )
    );
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
