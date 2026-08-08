// ============================================================
// POST /api/internal/operations/intake-requests/:requestId/actions
// PHX-LAUNCH-002 R2 — Website transactional action route
// ============================================================

import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  operatorActionBodySchema,
  operatorActionSchema,
} from '@/lib/intake/schema';
import { applyOperatorAction } from '@/lib/intake/operator-actions.service';
import {
  genericErrorResponse,
  getIntakeServiceActorUserId,
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

const ROUTE =
  'POST /api/internal/operations/intake-requests/[requestId]/actions';
const internalRequestIdSchema = z.string().uuid();

function noStore(response: NextResponse): NextResponse {
  response.headers.set(
    'Cache-Control',
    'no-store, private'
  );
  return response;
}

export async function POST(
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
    return noStore(
      intakeServiceUnauthorizedResponse(requestId)
    );
  }

  const actorUserId =
    getIntakeServiceActorUserId(request);

  if (!actorUserId) {
    logIntakeEvent({
      requestId,
      route: ROUTE,
      outcome: 'actor_attribution_invalid',
      statusCode: 400,
    });
    return noStore(
      genericErrorResponse(
        400,
        'Invalid service actor attribution.',
        requestId
      )
    );
  }

  const { requestId: intakeRequestId } = await params;
  const parsedRequestId =
    internalRequestIdSchema.safeParse(intakeRequestId);

  if (!parsedRequestId.success) {
    logIntakeEvent({
      requestId,
      route: ROUTE,
      outcome: 'invalid_request_id',
      statusCode: 400,
    });
    return noStore(
      genericErrorResponse(
        400,
        'Invalid request identifier.',
        requestId
      )
    );
  }

  if (!requireJsonContentType(request)) {
    logIntakeEvent({
      requestId,
      route: ROUTE,
      outcome: 'unsupported_content_type',
      statusCode: 415,
    });
    return noStore(
      genericErrorResponse(
        415,
        'Unsupported Media Type.',
        requestId
      )
    );
  }

  const bodyResult =
    await readBoundedJsonBody(request);

  if (!bodyResult.ok) {
    logIntakeEvent({
      requestId,
      route: ROUTE,
      outcome: 'invalid_body',
      statusCode: 400,
    });
    return noStore(
      genericErrorResponse(
        400,
        'Invalid request body.',
        requestId
      )
    );
  }

  const bodyShape =
    operatorActionBodySchema.safeParse(
      bodyResult.body
    );

  if (!bodyShape.success) {
    logIntakeEvent({
      requestId,
      route: ROUTE,
      outcome: 'validation_error',
      statusCode: 400,
    });
    return noStore(
      genericErrorResponse(
        400,
        'Invalid request body.',
        requestId
      )
    );
  }

  const parsedAction =
    operatorActionSchema.safeParse(
      bodyShape.data
    );

  if (!parsedAction.success) {
    logIntakeEvent({
      requestId,
      route: ROUTE,
      outcome: 'unsupported_action',
      statusCode: 422,
    });
    return noStore(
      genericErrorResponse(
        422,
        'Unsupported operation.',
        requestId
      )
    );
  }

  try {
    const outcome = await applyOperatorAction(
      parsedRequestId.data,
      parsedAction.data.action,
      actorUserId
    );

    if (outcome.kind === 'not_found') {
      logIntakeEvent({
        requestId,
        route: ROUTE,
        outcome: 'not_found',
        statusCode: 404,
      });
      return noStore(
        genericErrorResponse(
          404,
          'Request not found.',
          requestId
        )
      );
    }

    if (outcome.kind === 'invalid_transition') {
      logIntakeEvent({
        requestId,
        route: ROUTE,
        outcome: 'status_conflict',
        statusCode: 409,
      });
      return noStore(
        genericErrorResponse(
          409,
          'Invalid status transition.',
          requestId
        )
      );
    }

    logIntakeEvent({
      requestId,
      route: ROUTE,
      outcome: 'ok',
      statusCode: 200,
    });

    return noStore(
      NextResponse.json(
        {
          status: outcome.status,
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
      genericErrorResponse(
        500,
        'Something went wrong.',
        requestId
      )
    );
  }
}
