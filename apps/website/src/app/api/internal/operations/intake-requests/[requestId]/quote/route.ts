import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { sendEmailSafely } from '@/lib/intake/adapters';
import { buildQuoteEmail } from '@/lib/intake/adapters/email.adapter';
import { applyOperatorAction } from '@/lib/intake/operator-actions.service';
import { findById } from '@/lib/intake/repositories/intake-requests.repository';
import { createQuoteOffer } from '@/lib/intake/repositories/customer-portal.repository';
import {
  genericErrorResponse,
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

const ROUTE = 'POST /api/internal/operations/intake-requests/[requestId]/quote';
const requestIdSchema = z.string().uuid();
const quoteSchema = z.object({
  priceAmount: z.number().positive().max(1_000_000),
  currency: z.enum(['USD', 'AED']),
  deliveryHours: z.number().int().min(1).max(720),
  fileFormats: z.array(z.enum(['AI', 'SVG', 'JPEG', 'PNG', 'PDF', 'EPS'])).min(1).max(6),
  revisionRounds: z.number().int().min(0).max(20),
  additionalRevisionPrice: z.number().nonnegative().max(100_000),
}).strict();

function noStore(response: NextResponse): NextResponse {
  response.headers.set('Cache-Control', 'no-store, private');
  return response;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ requestId: string }> }
): Promise<NextResponse> {
  const correlationId = getIntakeServiceRequestId(request);
  if (!isValidIntakeServiceRequest(request)) return noStore(intakeServiceUnauthorizedResponse(correlationId));
  const actorUserId = getIntakeServiceActorUserId(request);
  if (!actorUserId) return noStore(genericErrorResponse(400, 'Invalid service actor attribution.', correlationId));
  const parsedRequestId = requestIdSchema.safeParse((await params).requestId);
  if (!parsedRequestId.success || !requireJsonContentType(request)) {
    return noStore(genericErrorResponse(400, 'Invalid quotation request.', correlationId));
  }
  const body = await readBoundedJsonBody(request);
  if (!body.ok) return noStore(genericErrorResponse(400, 'Invalid quotation request.', correlationId));
  const quote = quoteSchema.safeParse(body.body);
  if (!quote.success) return noStore(genericErrorResponse(400, 'Invalid quotation details.', correlationId));

  try {
    const intakeRequest = await findById(parsedRequestId.data);
    if (!intakeRequest) return noStore(genericErrorResponse(404, 'Request not found.', correlationId));
    const isResend = intakeRequest.status === 'accepted';
    if (intakeRequest.status !== 'files_received' && !isResend) {
      return noStore(genericErrorResponse(409, 'The request is not ready for quotation.', correlationId));
    }

    const email = buildQuoteEmail({
      publicReference: intakeRequest.public_reference,
      firstName: intakeRequest.first_name,
      ...quote.data,
    });
    email.to = intakeRequest.work_email_normalized;
    email.idempotencyKey = isResend
      ? `quote-resend/${intakeRequest.id}/${correlationId}`
      : `quote/${intakeRequest.id}/${quote.data.currency}-${quote.data.priceAmount.toFixed(2)}`;
    const sent = await sendEmailSafely(email);
    if (!sent.success) return noStore(genericErrorResponse(503, 'The quotation email could not be sent.', correlationId));

    const termsSnapshot = [
      `Delivery: ${quote.data.deliveryHours} hours after approval.`,
      `Deliverables: ${quote.data.fileFormats.join(', ')}.`,
      `Included revisions: ${quote.data.revisionRounds} rounds.`,
      `Additional revisions: ${quote.data.currency} ${quote.data.additionalRevisionPrice.toFixed(2)} per round.`,
      'Phoenix provides a preview proof before payment. Final editable and high-resolution files are released after full payment.',
      'Major redesigns or new creative directions are quoted separately. Font matching is subject to availability and licensing.',
    ].join('\n');
    const offerFingerprint = createHash('sha256').update(JSON.stringify({
      requestId: intakeRequest.id,
      ...quote.data,
      termsSnapshot,
    })).digest('hex');
    await createQuoteOffer({
      requestId: intakeRequest.id,
      ...quote.data,
      termsSnapshot,
      actorUserId,
      deliveryIdempotencyKey: `quote-offer/${intakeRequest.id}/${offerFingerprint}`,
    });

    if (isResend) {
      return noStore(NextResponse.json({ status: 'quoted', emailSent: true, requestId: correlationId }, { status: 200 }));
    }

    const outcome = await applyOperatorAction(intakeRequest.id, 'quote', actorUserId);
    if (outcome.kind !== 'ok') {
      return noStore(genericErrorResponse(outcome.kind === 'not_found' ? 404 : 409, 'The request status changed before this action completed.', correlationId));
    }
    return noStore(NextResponse.json({ status: 'quoted', emailSent: true, requestId: correlationId }, { status: 200 }));
  } catch (error) {
    reportInternalError(error, { requestId: correlationId, route: ROUTE, errorCategory: 'email_delivery', statusCode: 500 });
    return noStore(genericErrorResponse(500, 'Something went wrong.', correlationId));
  }
}
