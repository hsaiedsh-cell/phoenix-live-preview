import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createLiveSupabaseStorageAdapter } from '@/lib/intake/adapters/storage.adapter';
import { findCompletedFileForOperator } from '@/lib/intake/repositories/intake-files.repository';
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

const ROUTE = 'GET /api/internal/operations/intake-requests/[requestId]/files/[fileId]/download';
const paramsSchema = z.object({ requestId: z.string().uuid(), fileId: z.string().uuid() }).strict();
const DOWNLOAD_TTL_SECONDS = 60;

function noStore(response: NextResponse): NextResponse {
  response.headers.set('Cache-Control', 'no-store, private');
  return response;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ requestId: string; fileId: string }> }
): Promise<NextResponse> {
  const correlationId = getIntakeServiceRequestId(request);
  if (!isValidIntakeServiceRequest(request)) {
    return noStore(intakeServiceUnauthorizedResponse(correlationId));
  }

  const parsed = paramsSchema.safeParse(await params);
  if (!parsed.success) {
    return noStore(genericErrorResponse(400, 'Invalid file identifier.', correlationId));
  }

  try {
    const file = await findCompletedFileForOperator(parsed.data.requestId, parsed.data.fileId);
    if (!file) {
      return noStore(genericErrorResponse(404, 'File not found.', correlationId));
    }
    if (file.scan_status === 'quarantined') {
      return noStore(genericErrorResponse(409, 'This file is quarantined.', correlationId));
    }

    const downloadUrl = await createLiveSupabaseStorageAdapter().createSignedDownloadUrl(
      file.storage_object_key,
      DOWNLOAD_TTL_SECONDS
    );
    const expiresAt = new Date(Date.now() + DOWNLOAD_TTL_SECONDS * 1000).toISOString();
    logIntakeEvent({ requestId: correlationId, route: ROUTE, outcome: 'ok', statusCode: 200 });
    return noStore(NextResponse.json({ downloadUrl, expiresAt, requestId: correlationId }, { status: 200 }));
  } catch (error) {
    reportInternalError(error, {
      requestId: correlationId,
      route: ROUTE,
      errorCategory: 'upload_signing',
      statusCode: 500,
    });
    return noStore(genericErrorResponse(500, 'Something went wrong.', correlationId));
  }
}
