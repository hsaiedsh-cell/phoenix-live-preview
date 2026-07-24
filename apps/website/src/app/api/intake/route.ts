// ============================================================
// POST /api/intake
// PHX-LAUNCH-001
// ------------------------------------------------------------
// Thin HTTP wrapper. All real logic lives in
// src/lib/intake/submit.service.ts so Gate 4 QA can exercise it
// directly with injected fake adapters.
// ============================================================

import { NextResponse } from 'next/server';
import { submitIntakeRequest } from '@/lib/intake/submit.service';
import { newRequestId, genericErrorResponse, logIntakeEvent, reportInternalError, readBoundedJsonBody, extractClientIp } from '@/lib/intake/http';

export const runtime = 'nodejs';

export async function POST(request: Request): Promise<NextResponse> {
  const requestId = newRequestId();
  const route = 'POST /api/intake';

  const bodyResult = await readBoundedJsonBody(request);
  if (!bodyResult.ok) {
    logIntakeEvent({ requestId, route, outcome: 'oversized_or_malformed_body', statusCode: 413 });
    return genericErrorResponse(413, 'Request could not be processed.', requestId);
  }

  try {
    const outcome = await submitIntakeRequest(bodyResult.body, { rawIp: extractClientIp(request) });

    switch (outcome.kind) {
      case 'accepted':
        logIntakeEvent({ requestId, route, outcome: 'accepted', statusCode: 200, publicReference: outcome.publicReference });
        return NextResponse.json({ publicReference: outcome.publicReference, requestId }, { status: 200 });

      case 'validation_error':
        logIntakeEvent({ requestId, route, outcome: 'validation_error', statusCode: 422 });
        return genericErrorResponse(422, 'Some fields could not be validated.', requestId);

      case 'consent_version_stale':
        logIntakeEvent({ requestId, route, outcome: 'consent_version_stale', statusCode: 422 });
        return genericErrorResponse(422, 'Please refresh the page and try again.', requestId);

      case 'turnstile_rejected':
        logIntakeEvent({ requestId, route, outcome: 'turnstile_rejected', statusCode: 400 });
        return genericErrorResponse(400, 'We could not verify your submission. Please try again.', requestId);

      case 'turnstile_provider_error':
        logIntakeEvent({ requestId, route, outcome: 'turnstile_provider_error', statusCode: 503 });
        return genericErrorResponse(503, 'Please try again in a moment.', requestId);

      case 'rate_limited':
        logIntakeEvent({ requestId, route, outcome: `rate_limited_${outcome.scope}`, statusCode: 429 });
        return genericErrorResponse(429, 'Too many requests. Please try again later.', requestId);

      default:
        return genericErrorResponse(500, 'Something went wrong.', requestId);
    }
  } catch (error) {
    reportInternalError(error, { requestId, route, errorCategory: 'intake_persistence' });
    return genericErrorResponse(500, 'Something went wrong. Please try again.', requestId);
  }
}
