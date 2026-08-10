import { intakeQuery, withIntakeTransaction, type TransactionQuery } from '../db';

export type QuoteCurrency = 'USD' | 'AED';
export type QuoteFileFormat = 'AI' | 'SVG' | 'JPEG' | 'PNG' | 'PDF' | 'EPS';
export type QuoteDecision = 'approved' | 'declined' | 'changes_requested';
export type QuoteMessageAuthor = 'customer' | 'operator';

export interface QuoteOfferRow {
  id: string;
  request_id: string;
  version: number;
  price_amount: string;
  currency: QuoteCurrency;
  delivery_hours: number;
  file_formats: QuoteFileFormat[];
  revision_rounds: number;
  additional_revision_price: string;
  delivery_idempotency_key: string;
  terms_snapshot: string;
  sent_by_actor_user_id: string;
  sent_at: Date;
  created_at: Date;
}

export interface QuoteDecisionRow {
  id: string;
  quote_offer_id: string;
  request_id: string;
  customer_user_id: string;
  decision: QuoteDecision;
  reason: string | null;
  terms_accepted_version: string | null;
  created_at: Date;
}

export interface QuoteMessageRow {
  id: string;
  quote_offer_id: string;
  request_id: string;
  author_type: QuoteMessageAuthor;
  author_user_id: string;
  message: string;
  created_at: Date;
}

export interface CreateQuoteOfferInput {
  requestId: string;
  priceAmount: number;
  currency: QuoteCurrency;
  deliveryHours: number;
  fileFormats: QuoteFileFormat[];
  revisionRounds: number;
  additionalRevisionPrice: number;
  termsSnapshot: string;
  actorUserId: string;
  deliveryIdempotencyKey: string;
}

export interface CustomerPortalRequestRow {
  request_id: string;
  public_reference: string;
  request_type: string;
  company: string;
  status: string;
  created_at: Date;
  updated_at: Date;
}

export async function grantCustomerAccess(input: {
  requestId: string;
  customerUserId: string;
  actorUserId: string;
}): Promise<void> {
  await withIntakeTransaction(async (query) => {
    await query(
      `UPDATE public_intake_customer_access
       SET revoked_at = now()
       WHERE request_id = $1 AND revoked_at IS NULL AND customer_user_id <> $2`,
      [input.requestId, input.customerUserId]
    );
    await query(
      `INSERT INTO public_intake_customer_access (
         request_id, customer_user_id, granted_by_actor_user_id
       ) VALUES ($1,$2,$3)
       ON CONFLICT (request_id) WHERE revoked_at IS NULL DO NOTHING`,
      [input.requestId, input.customerUserId, input.actorUserId]
    );
  });
}

export async function customerCanAccessRequest(requestId: string, customerUserId: string): Promise<boolean> {
  const rows = await intakeQuery<{ allowed: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM public_intake_customer_access
       WHERE request_id = $1 AND customer_user_id = $2 AND revoked_at IS NULL
     ) AS allowed`,
    [requestId, customerUserId]
  );
  return rows[0]?.allowed === true;
}

export async function listCustomerPortalRequests(customerUserId: string): Promise<CustomerPortalRequestRow[]> {
  return intakeQuery<CustomerPortalRequestRow>(
    `SELECT
       r.id AS request_id,
       r.public_reference,
       r.request_type,
       r.company,
       r.status,
       r.created_at,
       r.updated_at
     FROM public_intake_customer_access a
     JOIN public_intake_requests r ON r.id = a.request_id
     WHERE a.customer_user_id = $1 AND a.revoked_at IS NULL
     ORDER BY r.created_at DESC, r.id DESC`,
    [customerUserId]
  );
}

export async function createQuoteOffer(input: CreateQuoteOfferInput): Promise<QuoteOfferRow> {
  return withIntakeTransaction(async (query) => {
    const request = await query<{ id: string; status: string }>(
      `SELECT id, status FROM public_intake_requests WHERE id = $1 FOR UPDATE`,
      [input.requestId]
    );
    if (!request[0]) throw new Error('portal_request_not_found');
    if (!['files_received', 'quoted', 'accepted'].includes(request[0].status)) {
      throw new Error('portal_request_not_quotable');
    }

    const rows = await query<QuoteOfferRow>(
      `INSERT INTO public_intake_quote_offers (
         request_id, version, price_amount, currency, delivery_hours,
         file_formats, revision_rounds, additional_revision_price,
         terms_snapshot, sent_by_actor_user_id, delivery_idempotency_key
       )
       SELECT $1, COALESCE(MAX(version), 0) + 1, $2,$3,$4,$5,$6,$7,$8,$9,$10
       FROM public_intake_quote_offers
       WHERE request_id = $1
       ON CONFLICT (delivery_idempotency_key) DO NOTHING
       RETURNING *`,
      [
        input.requestId,
        input.priceAmount,
        input.currency,
        input.deliveryHours,
        input.fileFormats,
        input.revisionRounds,
        input.additionalRevisionPrice,
        input.termsSnapshot,
        input.actorUserId,
        input.deliveryIdempotencyKey,
      ]
    );
    if (rows[0]) return rows[0];
    const replay = await query<QuoteOfferRow>(
      `SELECT * FROM public_intake_quote_offers
       WHERE delivery_idempotency_key = $1 AND request_id = $2`,
      [input.deliveryIdempotencyKey, input.requestId]
    );
    if (!replay[0]) throw new Error('portal_quote_idempotency_conflict');
    return replay[0];
  });
}

export async function listQuoteOffers(requestId: string): Promise<QuoteOfferRow[]> {
  return intakeQuery<QuoteOfferRow>(
    `SELECT * FROM public_intake_quote_offers
     WHERE request_id = $1 ORDER BY version DESC`,
    [requestId]
  );
}

async function lockAuthorizedLatestOffer(
  query: TransactionQuery,
  requestId: string,
  quoteOfferId: string,
  customerUserId: string
): Promise<QuoteOfferRow> {
  const access = await query<{ id: string }>(
    `SELECT id FROM public_intake_customer_access
     WHERE request_id = $1 AND customer_user_id = $2 AND revoked_at IS NULL
     FOR UPDATE`,
    [requestId, customerUserId]
  );
  if (!access[0]) throw new Error('portal_access_denied');

  const offers = await query<QuoteOfferRow>(
    `SELECT * FROM public_intake_quote_offers
     WHERE id = $1 AND request_id = $2 FOR UPDATE`,
    [quoteOfferId, requestId]
  );
  const offer = offers[0];
  if (!offer) throw new Error('portal_quote_not_found');

  const newer = await query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM public_intake_quote_offers
       WHERE request_id = $1 AND version > $2
     ) AS exists`,
    [requestId, offer.version]
  );
  if (newer[0]?.exists) throw new Error('portal_quote_superseded');
  return offer;
}

export async function recordCustomerDecision(input: {
  requestId: string;
  quoteOfferId: string;
  customerUserId: string;
  decision: QuoteDecision;
  reason?: string;
  termsAcceptedVersion?: string;
}): Promise<QuoteDecisionRow> {
  return withIntakeTransaction(async (query) => {
    await lockAuthorizedLatestOffer(
      query,
      input.requestId,
      input.quoteOfferId,
      input.customerUserId
    );
    const terminal = await query<{ id: string }>(
      `SELECT id FROM public_intake_quote_decisions
       WHERE quote_offer_id = $1 AND decision IN ('approved', 'declined')
       FOR UPDATE`,
      [input.quoteOfferId]
    );
    if (terminal[0]) throw new Error('portal_quote_already_decided');

    const rows = await query<QuoteDecisionRow>(
      `INSERT INTO public_intake_quote_decisions (
         quote_offer_id, request_id, customer_user_id, decision,
         reason, terms_accepted_version
       ) VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING *`,
      [
        input.quoteOfferId,
        input.requestId,
        input.customerUserId,
        input.decision,
        input.reason ?? null,
        input.termsAcceptedVersion ?? null,
      ]
    );
    return rows[0];
  });
}

export async function addQuoteMessage(input: {
  requestId: string;
  quoteOfferId: string;
  authorType: QuoteMessageAuthor;
  authorUserId: string;
  message: string;
}): Promise<QuoteMessageRow> {
  return withIntakeTransaction(async (query) => {
    if (input.authorType === 'customer') {
      await lockAuthorizedLatestOffer(
        query,
        input.requestId,
        input.quoteOfferId,
        input.authorUserId
      );
    }
    const rows = await query<QuoteMessageRow>(
      `INSERT INTO public_intake_quote_messages (
         quote_offer_id, request_id, author_type, author_user_id, message
       ) VALUES ($1,$2,$3,$4,$5)
       RETURNING *`,
      [input.quoteOfferId, input.requestId, input.authorType, input.authorUserId, input.message]
    );
    return rows[0];
  });
}

export async function listQuoteDecisions(requestId: string): Promise<QuoteDecisionRow[]> {
  return intakeQuery<QuoteDecisionRow>(
    `SELECT * FROM public_intake_quote_decisions
     WHERE request_id = $1 ORDER BY created_at ASC, id ASC`,
    [requestId]
  );
}

export async function listQuoteMessages(requestId: string): Promise<QuoteMessageRow[]> {
  return intakeQuery<QuoteMessageRow>(
    `SELECT * FROM public_intake_quote_messages
     WHERE request_id = $1 ORDER BY created_at ASC, id ASC`,
    [requestId]
  );
}
