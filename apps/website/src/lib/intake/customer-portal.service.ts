import {
  addQuoteMessage,
  customerCanAccessRequest,
  listCustomerPortalRequests,
  listQuoteDecisions,
  listQuoteMessages,
  listQuoteOffers,
  recordCustomerDecision,
  type QuoteDecision,
} from './repositories/customer-portal.repository';
import { findById } from './repositories/intake-requests.repository';

export interface CustomerPortalRequestSummary {
  requestId: string;
  publicReference: string;
  requestType: string;
  company: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export async function listCustomerRequests(customerUserId: string): Promise<CustomerPortalRequestSummary[]> {
  const rows = await listCustomerPortalRequests(customerUserId);
  return rows.map((row) => ({
    requestId: row.request_id,
    publicReference: row.public_reference,
    requestType: row.request_type,
    company: row.company,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }));
}

export async function getCustomerRequestDetail(requestId: string, customerUserId: string) {
  if (!(await customerCanAccessRequest(requestId, customerUserId))) return null;
  const request = (await listCustomerPortalRequests(customerUserId)).find((item) => item.request_id === requestId);
  if (!request) return null;

  const [offers, decisions, messages] = await Promise.all([
    listQuoteOffers(requestId),
    listQuoteDecisions(requestId),
    listQuoteMessages(requestId),
  ]);

  return {
    request: {
      requestId: request.request_id,
      publicReference: request.public_reference,
      requestType: request.request_type,
      company: request.company,
      status: request.status,
      createdAt: request.created_at.toISOString(),
      updatedAt: request.updated_at.toISOString(),
    },
    offers: offers.map((offer) => ({
      quoteOfferId: offer.id,
      version: offer.version,
      priceAmount: Number(offer.price_amount),
      currency: offer.currency,
      deliveryHours: offer.delivery_hours,
      fileFormats: offer.file_formats,
      revisionRounds: offer.revision_rounds,
      additionalRevisionPrice: Number(offer.additional_revision_price),
      termsSnapshot: offer.terms_snapshot,
      sentAt: offer.sent_at.toISOString(),
    })),
    decisions: decisions.map((decision) => ({
      decisionId: decision.id,
      quoteOfferId: decision.quote_offer_id,
      decision: decision.decision,
      reason: decision.reason,
      createdAt: decision.created_at.toISOString(),
    })),
    messages: messages.map((message) => ({
      messageId: message.id,
      quoteOfferId: message.quote_offer_id,
      authorType: message.author_type,
      message: message.message,
      createdAt: message.created_at.toISOString(),
    })),
  };
}

export async function getOperatorRequestPortalDetail(requestId: string) {
  const request = await findById(requestId);
  if (!request) return null;
  const [offers, decisions, messages] = await Promise.all([
    listQuoteOffers(requestId), listQuoteDecisions(requestId), listQuoteMessages(requestId),
  ]);
  return {
    request: {
      requestId: request.id, publicReference: request.public_reference,
      requestType: request.request_type, company: request.company, status: request.status,
      createdAt: request.created_at.toISOString(), updatedAt: request.updated_at.toISOString(),
    },
    offers: offers.map((offer) => ({
      quoteOfferId: offer.id, version: offer.version, priceAmount: Number(offer.price_amount),
      currency: offer.currency, deliveryHours: offer.delivery_hours, fileFormats: offer.file_formats,
      revisionRounds: offer.revision_rounds, additionalRevisionPrice: Number(offer.additional_revision_price),
      termsSnapshot: offer.terms_snapshot, sentAt: offer.sent_at.toISOString(),
    })),
    decisions: decisions.map((decision) => ({
      decisionId: decision.id, quoteOfferId: decision.quote_offer_id, decision: decision.decision,
      reason: decision.reason, createdAt: decision.created_at.toISOString(),
    })),
    messages: messages.map((message) => ({
      messageId: message.id, quoteOfferId: message.quote_offer_id, authorType: message.author_type,
      message: message.message, createdAt: message.created_at.toISOString(),
    })),
  };
}

export async function sendOperatorQuoteMessage(input: {
  requestId: string; quoteOfferId: string; operatorUserId: string; message: string;
}) {
  const request = await findById(input.requestId);
  const offer = (await listQuoteOffers(input.requestId)).find((item) => item.id === input.quoteOfferId);
  if (!request || !offer) return null;
  const message = await addQuoteMessage({
    requestId: input.requestId, quoteOfferId: input.quoteOfferId,
    authorType: 'operator', authorUserId: input.operatorUserId, message: input.message,
  });
  return { messageId: message.id, createdAt: message.created_at.toISOString() };
}

export async function decideCustomerQuote(input: {
  requestId: string;
  quoteOfferId: string;
  customerUserId: string;
  decision: QuoteDecision;
  reason?: string;
  termsAcceptedVersion?: string;
}) {
  const decision = await recordCustomerDecision(input);
  return {
    decisionId: decision.id,
    decision: decision.decision,
    createdAt: decision.created_at.toISOString(),
  };
}

export async function sendCustomerQuoteMessage(input: {
  requestId: string;
  quoteOfferId: string;
  customerUserId: string;
  message: string;
}) {
  const message = await addQuoteMessage({
    requestId: input.requestId,
    quoteOfferId: input.quoteOfferId,
    authorType: 'customer',
    authorUserId: input.customerUserId,
    message: input.message,
  });
  return {
    messageId: message.id,
    createdAt: message.created_at.toISOString(),
  };
}
