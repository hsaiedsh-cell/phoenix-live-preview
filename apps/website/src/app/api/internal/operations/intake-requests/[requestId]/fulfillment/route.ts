import { NextResponse } from 'next/server';
import { z } from 'zod';
import { advanceOperatorFulfillment } from '@/lib/intake/customer-portal.service';
import { sendEmailSafely } from '@/lib/intake/adapters';
import { buildFulfillmentUpdateEmail } from '@/lib/intake/adapters/email.adapter';
import { publicConfig } from '@/lib/intake/config';
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

const requestIdSchema = z.string().uuid();
const bodySchema = z.object({
  status: z.enum([
    'accepted', 'in_progress', 'preview_ready', 'payment_pending',
    'paid', 'final_files_delivered', 'cancelled',
  ]),
}).strict();

export async function POST(
  request: Request,
  { params }: { params: Promise<{ requestId: string }> }
): Promise<NextResponse> {
  const correlationId = getIntakeServiceRequestId(request);
  if (!isValidIntakeServiceRequest(request)) return intakeServiceUnauthorizedResponse(correlationId);
  const actorUserId = getIntakeServiceActorUserId(request);
  const parsedRequestId = requestIdSchema.safeParse((await params).requestId);
  if (!actorUserId || !parsedRequestId.success || !requireJsonContentType(request)) {
    return NextResponse.json({ error: 'Invalid fulfillment request.', requestId: correlationId }, { status: 400 });
  }
  const body = await readBoundedJsonBody(request);
  const parsedBody = body.ok ? bodySchema.safeParse(body.body) : null;
  if (!parsedBody?.success) {
    return NextResponse.json({ error: 'Invalid fulfillment request.', requestId: correlationId }, { status: 400 });
  }
  try {
    const fulfillment = await advanceOperatorFulfillment({
      requestId: parsedRequestId.data,
      toStatus: parsedBody.data.status,
      operatorUserId: actorUserId,
    });
    const intakeRequest = await findById(parsedRequestId.data);
    let emailSent = false;
    if (intakeRequest) {
      const portalUrl = `${publicConfig.platformUrl.replace(/\/$/, '')}/customer/requests/${encodeURIComponent(intakeRequest.id)}`;
      const email = buildFulfillmentUpdateEmail({
        publicReference: intakeRequest.public_reference,
        firstName: intakeRequest.first_name,
        status: fulfillment.status,
        dueAt: new Date(fulfillment.dueAt),
        portalUrl,
      });
      email.to = intakeRequest.work_email_normalized;
      email.idempotencyKey = `fulfillment/${intakeRequest.id}/${fulfillment.status}/${fulfillment.updatedAt}`;
      emailSent = (await sendEmailSafely(email)).success;
    }
    return NextResponse.json(
      { ...fulfillment, emailSent, requestId: correlationId },
      { headers: { 'Cache-Control': 'no-store, private' } }
    );
  } catch (error) {
    if (error instanceof Error && error.message === 'portal_fulfillment_not_found') {
      return NextResponse.json({ error: 'Fulfillment not found.', requestId: correlationId }, { status: 404 });
    }
    if (error instanceof Error && error.message === 'portal_fulfillment_invalid_transition') {
      return NextResponse.json({ error: 'Invalid fulfillment transition.', requestId: correlationId }, { status: 409 });
    }
    reportInternalError(error, {
      requestId: correlationId,
      route: 'POST operator fulfillment',
      errorCategory: 'intake_persistence',
      statusCode: 500,
    });
    return NextResponse.json({ error: 'Something went wrong.', requestId: correlationId }, { status: 500 });
  }
}
