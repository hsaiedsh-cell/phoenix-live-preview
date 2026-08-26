CREATE TABLE public_intake_preview_proofs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES public_intake_requests(id) ON DELETE RESTRICT,
  quote_offer_id UUID NOT NULL REFERENCES public_intake_quote_offers(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL,
  original_filename TEXT NOT NULL,
  storage_object_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'uploading',
  uploaded_by_actor_user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ NULL,
  CONSTRAINT uq_intake_preview_version UNIQUE (request_id, version),
  CONSTRAINT chk_intake_preview_status CHECK (status IN ('uploading','ready','superseded')),
  CONSTRAINT chk_intake_preview_type CHECK (content_type IN ('application/pdf','image/png','image/jpeg')),
  CONSTRAINT chk_intake_preview_size CHECK (size_bytes BETWEEN 1 AND 20971520)
);

CREATE TABLE public_intake_preview_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  preview_proof_id UUID NOT NULL REFERENCES public_intake_preview_proofs(id) ON DELETE RESTRICT,
  request_id UUID NOT NULL REFERENCES public_intake_requests(id) ON DELETE RESTRICT,
  customer_user_id UUID NOT NULL,
  decision TEXT NOT NULL,
  reason TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_intake_preview_decision CHECK (decision IN ('approved','revision_requested')),
  CONSTRAINT chk_intake_preview_reason CHECK (
    (decision='approved' AND reason IS NULL) OR
    (decision='revision_requested' AND char_length(reason) BETWEEN 1 AND 4000)
  )
);

CREATE UNIQUE INDEX uq_intake_preview_terminal_decision
  ON public_intake_preview_decisions(preview_proof_id)
  WHERE decision='approved';
CREATE INDEX idx_intake_preview_request ON public_intake_preview_proofs(request_id,version DESC);
CREATE INDEX idx_intake_preview_decisions_request ON public_intake_preview_decisions(request_id,created_at ASC);
ALTER TABLE public_intake_preview_proofs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public_intake_preview_decisions ENABLE ROW LEVEL SECURITY;
