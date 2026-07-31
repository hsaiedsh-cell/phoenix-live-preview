// ============================================================
// POST /api/intake
// PHX-LAUNCH-001 (R1: PHX-LAUNCH-001-R1 §2.1, §2.3, §2.4)
// ------------------------------------------------------------
// Thin HTTP wrapper. All real logic lives in
// src/lib/intake/submit.service.ts so QA can exercise it directly
// with injected fake adapters.
// ============================================================

import { NextResponse } from 'next/server';
import { submitIntakeRequest } from '@/lib/intake/submit.service';
import {
  newRequestId,
  genericErrorResponse,
  logIntakeEvent,
  reportInternalError,
  readBoundedJsonBody,
  extractClientIp,
  requireJsonContentType,
  isCrossSiteBrowserRequest,
  isOriginAllowed,
} from '@/lib/intake/http';

export const runtime = 'nodejs';

export async function POST(request: Request): Promise<NextResponse> {
  const requestId = newRequestId();
  const route = 'POST /api/intake';

  if (!requireJsonContentType(request)) {
    logIntakeEvent({ requestId, route, outcome: 'unsupported_content_type', statusCode: 415 });
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

      case 'idempotency_conflict':
        logIntakeEvent({ requestId, route, outcome: 'idempotency_conflict', statusCode: 409 });
        return genericErrorResponse(409, 'This request could not be processed. Please refresh and try again.', requestId);

      case 'submission_in_progress':
        // R2 §1.2 item 5: a bounded, safe response for a concurrent
        // duplicate submission that is still being processed by
        // another in-flight attempt with the same idempotency key --
        // never creates a second request, never calls Turnstile
        // again. 202 Accepted signals "your prior submission is still
        // being handled", distinct from both success (200) and any
        // error status.
        logIntakeEvent({ requestId, route, outcome: 'submission_in_progress', statusCode: 202 });
        return NextResponse.json({ status: 'in_progress', requestId }, { status: 202 });

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
