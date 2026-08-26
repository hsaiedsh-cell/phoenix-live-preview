-- Durable post-approval delivery lifecycle for customer intake work.

CREATE TABLE public_intake_fulfillments (
  request_id              UUID PRIMARY KEY REFERENCES public_intake_requests(id) ON DELETE RESTRICT,
  quote_offer_id          UUID NOT NULL REFERENCES public_intake_quote_offers(id) ON DELETE RESTRICT,
  status                  TEXT NOT NULL DEFAULT 'accepted',
  approved_at             TIMESTAMPTZ NOT NULL,
  started_at              TIMESTAMPTZ NULL,
  due_at                  TIMESTAMPTZ NOT NULL,
  preview_ready_at        TIMESTAMPTZ NULL,
  payment_pending_at      TIMESTAMPTZ NULL,
  paid_at                 TIMESTAMPTZ NULL,
  final_files_delivered_at TIMESTAMPTZ NULL,
  updated_by_actor_user_id UUID NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_intake_fulfillment_status CHECK (status IN (
    'accepted', 'in_progress', 'preview_ready', 'payment_pending',
    'paid', 'final_files_delivered', 'cancelled'
  )),
  CONSTRAINT chk_intake_fulfillment_due CHECK (due_at >= approved_at)
);

CREATE INDEX idx_intake_fulfillments_status_due
  ON public_intake_fulfillments (status, due_at ASC);

CREATE TABLE public_intake_fulfillment_events (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id             UUID NOT NULL REFERENCES public_intake_requests(id) ON DELETE RESTRICT,
  quote_offer_id         UUID NOT NULL REFERENCES public_intake_quote_offers(id) ON DELETE RESTRICT,
  from_status            TEXT NULL,
  to_status              TEXT NOT NULL,
  actor_user_id          UUID NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_intake_fulfillment_event_from CHECK (
    from_status IS NULL OR from_status IN (
      'accepted', 'in_progress', 'preview_ready', 'payment_pending',
      'paid', 'final_files_delivered', 'cancelled'
    )
  ),
  CONSTRAINT chk_intake_fulfillment_event_to CHECK (to_status IN (
    'accepted', 'in_progress', 'preview_ready', 'payment_pending',
    'paid', 'final_files_delivered', 'cancelled'
  ))
);

CREATE INDEX idx_intake_fulfillment_events_request
  ON public_intake_fulfillment_events (request_id, created_at ASC, id ASC);

ALTER TABLE public_intake_fulfillments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public_intake_fulfillment_events ENABLE ROW LEVEL SECURITY;

-- Existing approved quotations receive a lifecycle without rewriting history.
WITH latest_approved AS (
  SELECT DISTINCT ON (d.request_id)
    d.request_id,
    d.quote_offer_id,
    d.created_at AS approved_at,
    o.delivery_hours
  FROM public_intake_quote_decisions d
  JOIN public_intake_quote_offers o ON o.id = d.quote_offer_id
  WHERE d.decision = 'approved'
  ORDER BY d.request_id, o.version DESC, d.created_at DESC
), inserted AS (
  INSERT INTO public_intake_fulfillments (
    request_id, quote_offer_id, status, approved_at, due_at
  )
  SELECT
    request_id,
    quote_offer_id,
    'accepted',
    approved_at,
    approved_at + make_interval(hours => delivery_hours)
  FROM latest_approved
  ON CONFLICT (request_id) DO NOTHING
  RETURNING request_id, quote_offer_id
)
INSERT INTO public_intake_fulfillment_events (
  request_id, quote_offer_id, from_status, to_status
)
SELECT request_id, quote_offer_id, NULL, 'accepted' FROM inserted;

