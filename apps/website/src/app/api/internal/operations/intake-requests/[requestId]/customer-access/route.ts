import { NextResponse } from 'next/server';
import { z } from 'zod';
import { grantCustomerAccess } from '@/lib/intake/repositories/customer-portal.repository';
import { findById } from '@/lib/intake/repositories/intake-requests.repository';
import {
  getIntakeServiceActorUserId,
  getIntakeServiceRequestId,
  intakeServiceUnauthorizedResponse,
  isValidIntakeServiceRequest,
  readBoundedJsonBody,
  reportInternalError,
  requireJsonContentType,
} from '@/lib/intake/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const ROUTE = 'POST /api/internal/operations/intake-requests/[requestId]/customer-access';
const requestIdSchema = z.string().uuid();
const bodySchema = z.object({ customerUserId: z.string().uuid() }).strict();

export async function POST(request: Request, { params }: { params: Promise<{ requestId: string }> }): Promise<NextResponse> {
  const correlationId = getIntakeServiceRequestId(request);
  if (!isValidIntakeServiceRequest(request)) return intakeServiceUnauthorizedResponse(correlationId);
  const actorUserId = getIntakeServiceActorUserId(request);
  const parsedRequestId = requestIdSchema.safeParse((await params).requestId);
  if (!actorUserId || !parsedRequestId.success || !requireJsonContentType(request)) {
    return NextResponse.json({ error: 'Invalid customer access request.', requestId: correlationId }, { status: 400 });
  }
  const body = await readBoundedJsonBody(request);
  const parsedBody = body.ok ? bodySchema.safeParse(body.body) : null;
  if (!parsedBody?.success) return NextResponse.json({ error: 'Invalid customer access request.', requestId: correlationId }, { status: 400 });
  try {
    const intakeRequest = await findById(parsedRequestId.data);
    if (!intakeRequest || intakeRequest.status !== 'accepted') {
      return NextResponse.json({ error: 'Request not found.', requestId: correlationId }, { status: 404 });
    }
    await grantCustomerAccess({ requestId: intakeRequest.id, customerUserId: parsedBody.data.customerUserId, actorUserId });
    return NextResponse.json({ status: 'granted', requestId: correlationId }, { status: 200, headers: { 'Cache-Control': 'no-store, private' } });
  } catch (error) {
    reportInternalError(error, { requestId: correlationId, route: ROUTE, errorCategory: 'intake_persistence', statusCode: 500 });
    return NextResponse.json({ error: 'Something went wrong.', requestId: correlationId }, { status: 500 });
  }
}
