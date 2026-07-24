// ============================================================
// POST /api/upload/:token/complete
// PHX-LAUNCH-001
// ------------------------------------------------------------
// Public endpoint, invitation-only. Verifies the object actually
// exists in private storage (never trusts the client's claimed
// size/existence) before recording file metadata.
// ============================================================

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { completeUploadObject, finishUploadSession } from '@/lib/intake/upload-flow.service';
import { newRequestId, genericErrorResponse, logIntakeEvent, reportInternalError, readBoundedJsonBody } from '@/lib/intake/http';

export const runtime = 'nodejs';

const completeBodySchema = z.object({
  storageObjectKey: z.string().trim().min(1).max(500),
  originalFilename: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(1).max(200),
  finishSession: z.boolean().optional().default(false),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
): Promise<NextResponse> {
  const { token } = await params;
  const requestId = newRequestId();
  const route = 'POST /api/upload/[token]/complete';

  const bodyResult = await readBoundedJsonBody(request);
  if (!bodyResult.ok) {
    return genericErrorResponse(413, 'Request could not be processed.', requestId);
  }
  const parsed = completeBodySchema.safeParse(bodyResult.body);
  if (!parsed.success) {
    return genericErrorResponse(422, 'Invalid request.', requestId);
  }

  try {
    const outcome = await completeUploadObject(token, parsed.data);
    switch (outcome.kind) {
      case 'denied':
        logIntakeEvent({ requestId, route, outcome: `denied_${outcome.reason}`, statusCode: 404 });
        return genericErrorResponse(404, 'This upload link is not valid.', requestId);
      case 'object_not_found':
        logIntakeEvent({ requestId, route, outcome: 'object_not_found', statusCode: 422 });
        return genericErrorResponse(422, 'We could not verify that file. Please try again.', requestId);
      case 'ok':
        if (parsed.data.finishSession) {
          await finishUploadSession(token);
        }
        logIntakeEvent({ requestId, route, outcome: 'ok', statusCode: 200 });
        return NextResponse.json({ fileCount: outcome.fileCount, requestId }, { status: 200 });
    }
  } catch (error) {
    reportInternalError(error, { requestId, route, errorCategory: 'upload_completion' });
    return genericErrorResponse(500, 'Something went wrong.', requestId);
  }
}
