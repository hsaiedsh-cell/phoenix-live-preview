import { NextResponse } from 'next/server';
import { z } from 'zod';
import { decideCustomerQuote } from '@/lib/intake/customer-portal.service';
import { getIntakeServiceActorUserId, getIntakeServiceRequestId, intakeServiceUnauthorizedResponse, isValidIntakeServiceRequest, readBoundedJsonBody, reportInternalError, requireJsonContentType } from '@/lib/intake/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const ROUTE = 'POST /api/internal/customer/intake-requests/[requestId]/quotes/[quoteOfferId]/decisions';
const paramsSchema = z.object({ requestId: z.string().uuid(), quoteOfferId: z.string().uuid() });
const bodySchema = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('approved'), termsAcceptedVersion: z.string().min(1).max(100) }).strict(),
  z.object({ decision: z.literal('declined'), reason: z.string().trim().min(1).max(4000) }).strict(),
  z.object({ decision: z.literal('changes_requested'), reason: z.string().trim().min(1).max(4000) }).strict(),
]);

export async function POST(request: Request, { params }: { params: Promise<{ requestId: string; quoteOfferId: string }> }): Promise<NextResponse> {
  const correlationId = getIntakeServiceRequestId(request);
  if (!isValidIntakeServiceRequest(request)) return intakeServiceUnauthorizedResponse(correlationId);
  const customerUserId = getIntakeServiceActorUserId(request);
  const parsedParams = paramsSchema.safeParse(await params);
  if (!customerUserId || !parsedParams.success || !requireJsonContentType(request)) return NextResponse.json({ error: 'Invalid decision request.', requestId: correlationId }, { status: 400 });
  const body = await readBoundedJsonBody(request);
  const parsedBody = body.ok ? bodySchema.safeParse(body.body) : null;
  if (!parsedBody?.success) return NextResponse.json({ error: 'Invalid decision request.', requestId: correlationId }, { status: 400 });
  try {
    const result = await decideCustomerQuote({
      ...parsedParams.data, customerUserId, decision: parsedBody.data.decision,
      reason: 'reason' in parsedBody.data ? parsedBody.data.reason : undefined,
      termsAcceptedVersion: 'termsAcceptedVersion' in parsedBody.data ? parsedBody.data.termsAcceptedVersion : undefined,
    });
    return NextResponse.json({ ...result, requestId: correlationId }, { status: 201, headers: { 'Cache-Control': 'no-store, private' } });
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    const status = code === 'portal_access_denied' || code === 'portal_quote_not_found' ? 404 : code.startsWith('portal_quote_') ? 409 : 500;
    if (status === 500) reportInternalError(error, { requestId: correlationId, route: ROUTE, errorCategory: 'intake_persistence', statusCode: 500 });
    return NextResponse.json({ error: status === 404 ? 'Request not found.' : status === 409 ? 'This quotation can no longer be changed.' : 'Something went wrong.', requestId: correlationId }, { status });
  }
}
