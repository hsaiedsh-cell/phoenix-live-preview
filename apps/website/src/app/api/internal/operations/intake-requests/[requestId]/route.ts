// ============================================================
// GET /api/internal/operations/intake-requests/:requestId
// PHX-LAUNCH-002 R2 — Website service detail route
// ============================================================

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { findOperatorRequestDetailById } from '@/lib/intake/repositories/intake-requests.repository';
import { listOperatorActionsForRequest } from '@/lib/intake/repositories/intake-events.repository';
import {
  genericErrorResponse,
  getIntakeServiceRequestId,
  intakeServiceUnauthorizedResponse,
  isValidIntakeServiceRequest,
  logIntakeEvent,
  reportInternalError,
} from '@/lib/intake/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROUTE = 'GET /api/internal/operations/intake-requests/[requestId]';
const internalRequestIdSchema = z.string().uuid();

function noStore(response: NextResponse): NextResponse {
  response.headers.set('Cache-Control', 'no-store, private');
  return response;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ requestId: string }> }
): Promise<NextResponse> {
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

  const { requestId: intakeRequestId } = await params;
  const parsedRequestId = internalRequestIdSchema.safeParse(intakeRequestId);

  if (!parsedRequestId.success) {
    logIntakeEvent({
      requestId,
      route: ROUTE,
      outcome: 'invalid_request_id',
      statusCode: 400,
    });
    return noStore(
      genericErrorResponse(400, 'Invalid request identifier.', requestId)
    );
  }

  try {
    const detail = await findOperatorRequestDetailById(parsedRequestId.data);

    if (!detail) {
      logIntakeEvent({
        requestId,
        route: ROUTE,
        outcome: 'not_found',
        statusCode: 404,
      });
      return noStore(
        genericErrorResponse(404, 'Request not found.', requestId)
      );
    }

    const operatorActions = await listOperatorActionsForRequest(
      parsedRequestId.data
    );

    logIntakeEvent({
      requestId,
      route: ROUTE,
      outcome: 'ok',
      statusCode: 200,
    });

    return noStore(
      NextResponse.json(
        {
          request: {
            ...detail,
            operatorActions,
          },
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

    return noStore(
      genericErrorResponse(500, 'Something went wrong.', requestId)
    );
  }
}
