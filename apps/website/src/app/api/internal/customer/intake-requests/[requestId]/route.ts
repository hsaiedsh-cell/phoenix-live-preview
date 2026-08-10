import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getCustomerRequestDetail } from '@/lib/intake/customer-portal.service';
import { getIntakeServiceActorUserId, getIntakeServiceRequestId, intakeServiceUnauthorizedResponse, isValidIntakeServiceRequest, reportInternalError } from '@/lib/intake/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const ROUTE = 'GET /api/internal/customer/intake-requests/[requestId]';
const requestIdSchema = z.string().uuid();

export async function GET(request: Request, { params }: { params: Promise<{ requestId: string }> }): Promise<NextResponse> {
  const correlationId = getIntakeServiceRequestId(request);
  if (!isValidIntakeServiceRequest(request)) return intakeServiceUnauthorizedResponse(correlationId);
  const customerUserId = getIntakeServiceActorUserId(request);
  const parsed = requestIdSchema.safeParse((await params).requestId);
  if (!customerUserId || !parsed.success) return NextResponse.json({ error: 'Request not found.', requestId: correlationId }, { status: 404 });
  try {
    const detail = await getCustomerRequestDetail(parsed.data, customerUserId);
    if (!detail) return NextResponse.json({ error: 'Request not found.', requestId: correlationId }, { status: 404 });
    return NextResponse.json({ ...detail, requestId: correlationId }, { headers: { 'Cache-Control': 'no-store, private' } });
  } catch (error) {
    reportInternalError(error, { requestId: correlationId, route: ROUTE, errorCategory: 'intake_persistence', statusCode: 500 });
    return NextResponse.json({ error: 'Something went wrong.', requestId: correlationId }, { status: 500 });
  }
}
