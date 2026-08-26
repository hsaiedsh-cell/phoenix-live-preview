-- ============================================================
-- Phoenix Website — Migration 0003: Customer Portal Quotations
-- ------------------------------------------------------------
-- Durable, server-owned records for customer access, versioned
-- quotations, customer decisions, and negotiation messages.
-- Customer-facing APIs must resolve the authenticated Phoenix user
-- through public_intake_customer_access before reading these rows.
-- ============================================================

CREATE TABLE public_intake_customer_access (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id               UUID NOT NULL REFERENCES public_intake_requests(id) ON DELETE RESTRICT,
  customer_user_id         UUID NOT NULL,
  granted_by_actor_user_id UUID NOT NULL,
  granted_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at               TIMESTAMPTZ NULL,

  CONSTRAINT chk_customer_access_revocation
    CHECK (revoked_at IS NULL OR revoked_at >= granted_at)
);

CREATE UNIQUE INDEX uq_intake_customer_access_active_request
  ON public_intake_customer_access (request_id)
  WHERE revoked_at IS NULL;

CREATE INDEX idx_intake_customer_access_user
  ON public_intake_customer_access (customer_user_id, granted_at DESC)
  WHERE revoked_at IS NULL;

CREATE TABLE public_intake_quote_offers (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id                 UUID NOT NULL REFERENCES public_intake_requests(id) ON DELETE RESTRICT,
  version                    INTEGER NOT NULL,
  price_amount               NUMERIC(12,2) NOT NULL,
  currency                   TEXT NOT NULL,
  delivery_hours             INTEGER NOT NULL,
  file_formats               TEXT[] NOT NULL,
  revision_rounds            INTEGER NOT NULL,
  additional_revision_price NUMERIC(12,2) NOT NULL,
  terms_snapshot             TEXT NOT NULL,
  sent_by_actor_user_id      UUID NOT NULL,
  sent_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_intake_quote_offer_version UNIQUE (request_id, version),
  CONSTRAINT chk_intake_quote_offer_version CHECK (version >= 1),
  CONSTRAINT chk_intake_quote_offer_price CHECK (price_amount > 0),
  CONSTRAINT chk_intake_quote_offer_currency CHECK (currency IN ('USD', 'AED')),
  CONSTRAINT chk_intake_quote_offer_delivery CHECK (delivery_hours BETWEEN 1 AND 720),
  CONSTRAINT chk_intake_quote_offer_formats CHECK (
    cardinality(file_formats) BETWEEN 1 AND 6
    AND file_formats <@ ARRAY['AI','SVG','JPEG','PNG','PDF','EPS']::TEXT[]
  ),
  CONSTRAINT chk_intake_quote_offer_revisions CHECK (revision_rounds BETWEEN 0 AND 20),
  CONSTRAINT chk_intake_quote_offer_extra_price CHECK (additional_revision_price >= 0),
  CONSTRAINT chk_intake_quote_offer_terms CHECK (char_length(terms_snapshot) BETWEEN 1 AND 10000),
  CONSTRAINT chk_intake_quote_offer_timestamps CHECK (created_at <= sent_at)
);

CREATE INDEX idx_intake_quote_offers_request
  ON public_intake_quote_offers (request_id, version DESC);

CREATE TABLE public_intake_quote_decisions (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_offer_id         UUID NOT NULL REFERENCES public_intake_quote_offers(id) ON DELETE RESTRICT,
  request_id             UUID NOT NULL REFERENCES public_intake_requests(id) ON DELETE RESTRICT,
  customer_user_id       UUID NOT NULL,
  decision               TEXT NOT NULL,
  reason                 TEXT NULL,
  terms_accepted_version TEXT NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_intake_quote_decision
    CHECK (decision IN ('approved', 'declined', 'changes_requested')),
  CONSTRAINT chk_intake_quote_decision_reason
    CHECK (
      (decision = 'approved' AND reason IS NULL)
      OR (decision IN ('declined', 'changes_requested') AND char_length(reason) BETWEEN 1 AND 4000)
    ),
  CONSTRAINT chk_intake_quote_decision_terms
    CHECK (
      (decision = 'approved' AND terms_accepted_version IS NOT NULL)
      OR (decision <> 'approved' AND terms_accepted_version IS NULL)
    )
);

CREATE INDEX idx_intake_quote_decisions_request
  ON public_intake_quote_decisions (request_id, created_at ASC, id ASC);

CREATE INDEX idx_intake_quote_decisions_offer
  ON public_intake_quote_decisions (quote_offer_id, created_at ASC, id ASC);

CREATE UNIQUE INDEX uq_intake_quote_terminal_decision
  ON public_intake_quote_decisions (quote_offer_id)
  WHERE decision IN ('approved', 'declined');

CREATE TABLE public_intake_quote_messages (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_offer_id   UUID NOT NULL REFERENCES public_intake_quote_offers(id) ON DELETE RESTRICT,
  request_id       UUID NOT NULL REFERENCES public_intake_requests(id) ON DELETE RESTRICT,
  author_type      TEXT NOT NULL,
  author_user_id   UUID NOT NULL,
  message          TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_intake_quote_message_author CHECK (author_type IN ('customer', 'operator')),
  CONSTRAINT chk_intake_quote_message_body CHECK (char_length(message) BETWEEN 1 AND 4000)
);

CREATE INDEX idx_intake_quote_messages_request
  ON public_intake_quote_messages (request_id, created_at ASC, id ASC);

ALTER TABLE public_intake_customer_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public_intake_quote_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public_intake_quote_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public_intake_quote_messages ENABLE ROW LEVEL SECURITY;

-- Offers, decisions, and negotiation messages are evidence. They are
-- append-only: corrections are represented by a new quote version or
-- a later message, never by rewriting history.
CREATE FUNCTION enforce_intake_quote_evidence_append_only()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'customer portal quotation evidence is append-only';
END;
$$;

CREATE TRIGGER trg_intake_quote_offers_append_only
BEFORE UPDATE OR DELETE ON public_intake_quote_offers
FOR EACH ROW EXECUTE FUNCTION enforce_intake_quote_evidence_append_only();

CREATE TRIGGER trg_intake_quote_decisions_append_only
BEFORE UPDATE OR DELETE ON public_intake_quote_decisions
FOR EACH ROW EXECUTE FUNCTION enforce_intake_quote_evidence_append_only();

CREATE TRIGGER trg_intake_quote_messages_append_only
BEFORE UPDATE OR DELETE ON public_intake_quote_messages
FOR EACH ROW EXECUTE FUNCTION enforce_intake_quote_evidence_append_only();

-- Enforce that redundant request_id columns always match their quote.
CREATE FUNCTION enforce_intake_quote_request_consistency()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  offer_request_id UUID;
BEGIN
  SELECT request_id INTO offer_request_id
  FROM public_intake_quote_offers
  WHERE id = NEW.quote_offer_id;

  IF offer_request_id IS NULL OR offer_request_id <> NEW.request_id THEN
    RAISE EXCEPTION 'quote evidence request does not match its offer';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_intake_quote_decision_request_consistency
BEFORE INSERT ON public_intake_quote_decisions
FOR EACH ROW EXECUTE FUNCTION enforce_intake_quote_request_consistency();

CREATE TRIGGER trg_intake_quote_message_request_consistency
BEFORE INSERT ON public_intake_quote_messages
FOR EACH ROW EXECUTE FUNCTION enforce_intake_quote_request_consistency();

