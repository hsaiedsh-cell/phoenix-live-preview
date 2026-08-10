import { NextResponse } from 'next/server';
import { z } from 'zod';
import { sendOperatorQuoteMessage } from '@/lib/intake/customer-portal.service';
import { getIntakeServiceActorUserId, getIntakeServiceRequestId, intakeServiceUnauthorizedResponse, isValidIntakeServiceRequest, readBoundedJsonBody, reportInternalError, requireJsonContentType } from '@/lib/intake/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const paramsSchema = z.object({ requestId: z.string().uuid(), quoteOfferId: z.string().uuid() });
const bodySchema = z.object({ message: z.string().trim().min(1).max(4000) }).strict();

export async function POST(request: Request, { params }: { params: Promise<{ requestId: string; quoteOfferId: string }> }): Promise<NextResponse> {
  const correlationId = getIntakeServiceRequestId(request);
  if (!isValidIntakeServiceRequest(request)) return intakeServiceUnauthorizedResponse(correlationId);
  const actorUserId = getIntakeServiceActorUserId(request);
  const parsedParams = paramsSchema.safeParse(await params);
  if (!actorUserId || !parsedParams.success || !requireJsonContentType(request)) return NextResponse.json({ error: 'Invalid message request.', requestId: correlationId }, { status: 400 });
  const body = await readBoundedJsonBody(request);
  const parsedBody = body.ok ? bodySchema.safeParse(body.body) : null;
  if (!parsedBody?.success) return NextResponse.json({ error: 'Invalid message request.', requestId: correlationId }, { status: 400 });
  try {
    const result = await sendOperatorQuoteMessage({ ...parsedParams.data, operatorUserId: actorUserId, message: parsedBody.data.message });
    if (!result) return NextResponse.json({ error: 'Request not found.', requestId: correlationId }, { status: 404 });
    return NextResponse.json({ ...result, requestId: correlationId }, { status: 201, headers: { 'Cache-Control': 'no-store, private' } });
  } catch (error) {
    reportInternalError(error, { requestId: correlationId, route: 'POST operator quote message', errorCategory: 'intake_persistence', statusCode: 500 });
    return NextResponse.json({ error: 'Something went wrong.', requestId: correlationId }, { status: 500 });
  }
}
