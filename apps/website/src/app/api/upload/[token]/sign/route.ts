// ============================================================
// POST /api/upload/:token/sign
// PHX-LAUNCH-001
// ------------------------------------------------------------
// Public endpoint, invitation-only. Enforces MIME allowlist,
// per-file size, per-session file count, and per-session total size
// before ever calling the storage adapter.
// ============================================================

import { NextResponse } from 'next/server';
import { signUploadObject } from '@/lib/intake/upload-flow.service';
import { uploadSignSchema } from '@/lib/intake/schema';
import { newRequestId, genericErrorResponse, logIntakeEvent, reportInternalError, readBoundedJsonBody } from '@/lib/intake/http';

export const runtime = 'nodejs';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
): Promise<NextResponse> {
  const { token } = await params;
  const requestId = newRequestId();
  const route = 'POST /api/upload/[token]/sign';

  const bodyResult = await readBoundedJsonBody(request);
  if (!bodyResult.ok) {
    return genericErrorResponse(413, 'Request could not be processed.', requestId);
  }
  const parsed = uploadSignSchema.safeParse(bodyResult.body);
  if (!parsed.success) {
    logIntakeEvent({ requestId, route, outcome: 'validation_error', statusCode: 422 });
    return genericErrorResponse(422, 'This file cannot be accepted.', requestId);
  }

  try {
    const outcome = await signUploadObject(token, parsed.data);
    switch (outcome.kind) {
      case 'denied':
        logIntakeEvent({ requestId, route, outcome: `denied_${outcome.reason}`, statusCode: 404 });
        return genericErrorResponse(404, 'This upload link is not valid.', requestId);
      case 'rejected':
        logIntakeEvent({ requestId, route, outcome: `rejected_${outcome.reason}`, statusCode: 422 });
        return genericErrorResponse(422, 'This file cannot be accepted.', requestId);
      case 'ok':
        logIntakeEvent({ requestId, route, outcome: 'ok', statusCode: 200 });
        return NextResponse.json(
          { uploadUrl: outcome.uploadUrl, storageObjectKey: outcome.storageObjectKey, requestId },
          { status: 200 }
        );
    }
  } catch (error) {
    reportInternalError(error, { requestId, route, errorCategory: 'upload_signing' });
    return genericErrorResponse(500, 'Something went wrong.', requestId);
  }
}
