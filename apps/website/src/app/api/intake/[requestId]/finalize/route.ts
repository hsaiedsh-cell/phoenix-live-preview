// ============================================================
// POST /api/intake/:requestId/finalize
// PHX-LAUNCH-001
// ------------------------------------------------------------
// Internal-only route (see src/lib/intake/http.ts's
// isValidOpsSecret) — never called from browser code, only from
// the operations CLI (scripts/ops/intake-ops.ts).
// ============================================================

import { NextResponse } from 'next/server';
import { finalizeIntakeRequest, type FinalizeAction } from '@/lib/intake/finalize.service';
import { finalizeRequestSchema } from '@/lib/intake/schema';
import {
  newRequestId,
  genericErrorResponse,
  logIntakeEvent,
  reportInternalError,
  readBoundedJsonBody,
  isValidOpsSecret,
} from '@/lib/intake/http';

export const runtime = 'nodejs';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ requestId: string }> }
): Promise<NextResponse> {
  const { requestId: intakeRequestId } = await params;
  const requestId = newRequestId();
  const route = 'POST /api/intake/[requestId]/finalize';

  if (!isValidOpsSecret(request)) {
    logIntakeEvent({ requestId, route, outcome: 'ops_secret_invalid', statusCode: 401 });
    return genericErrorResponse(401, 'Unauthorized.', requestId);
  }

  const bodyResult = await readBoundedJsonBody(request);
  if (!bodyResult.ok) {
    return genericErrorResponse(413, 'Request could not be processed.', requestId);
  }
  const parsed = finalizeRequestSchema.safeParse(bodyResult.body);
  if (!parsed.success) {
    return genericErrorResponse(422, 'Invalid action.', requestId);
  }

  try {
    const outcome = await finalizeIntakeRequest(intakeRequestId, parsed.data.action as FinalizeAction);
    switch (outcome.kind) {
      case 'not_found':
        logIntakeEvent({ requestId, route, outcome: 'not_found', statusCode: 404 });
        return genericErrorResponse(404, 'Request not found.', requestId);
      case 'invalid_transition':
        logIntakeEvent({ requestId, route, outcome: 'invalid_transition', statusCode: 409 });
        return genericErrorResponse(409, `Cannot move from ${outcome.from} to ${outcome.to}.`, requestId);
      case 'ok':
        logIntakeEvent({ requestId, route, outcome: 'ok', statusCode: 200 });
        return NextResponse.json({ status: outcome.status, requestId }, { status: 200 });
    }
  } catch (error) {
    reportInternalError(error, { requestId, route, errorCategory: 'intake_persistence' });
    return genericErrorResponse(500, 'Something went wrong.', requestId);
  }
}
