ALTER TABLE public_intake_quote_offers
  ADD COLUMN delivery_idempotency_key TEXT NOT NULL;

ALTER TABLE public_intake_quote_offers
  ADD CONSTRAINT chk_intake_quote_offer_idempotency_key
  CHECK (char_length(delivery_idempotency_key) BETWEEN 1 AND 200);

CREATE UNIQUE INDEX uq_intake_quote_offer_delivery_idempotency
  ON public_intake_quote_offers (delivery_idempotency_key);
