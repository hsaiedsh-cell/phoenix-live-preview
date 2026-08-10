import { NextResponse } from 'next/server';
import { listCustomerRequests } from '@/lib/intake/customer-portal.service';
import { getIntakeServiceActorUserId, getIntakeServiceRequestId, intakeServiceUnauthorizedResponse, isValidIntakeServiceRequest, reportInternalError } from '@/lib/intake/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const ROUTE = 'GET /api/internal/customer/intake-requests';

export async function GET(request: Request): Promise<NextResponse> {
  const requestId = getIntakeServiceRequestId(request);
  if (!isValidIntakeServiceRequest(request)) return intakeServiceUnauthorizedResponse(requestId);
  const customerUserId = getIntakeServiceActorUserId(request);
  if (!customerUserId) return intakeServiceUnauthorizedResponse(requestId);
  try {
    const requests = await listCustomerRequests(customerUserId);
    return NextResponse.json({ requests, requestId }, { headers: { 'Cache-Control': 'no-store, private' } });
  } catch (error) {
    reportInternalError(error, { requestId, route: ROUTE, errorCategory: 'intake_persistence', statusCode: 500 });
    return NextResponse.json({ error: 'Something went wrong.', requestId }, { status: 500 });
  }
}
