CREATE TABLE IF NOT EXISTS public_intake_final_deliverables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public_intake_requests(id) ON DELETE CASCADE,
  quote_offer_id uuid NOT NULL REFERENCES public_intake_quote_offers(id) ON DELETE RESTRICT,
  original_filename text NOT NULL CHECK (char_length(original_filename) BETWEEN 1 AND 255),
  storage_object_key text NOT NULL UNIQUE,
  content_type text NOT NULL CHECK (content_type IN ('application/zip','application/x-zip-compressed')),
  size_bytes bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 52428800),
  status text NOT NULL DEFAULT 'uploading' CHECK (status IN ('uploading','ready')),
  uploaded_by_actor_user_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS public_intake_final_deliverables_request_idx
  ON public_intake_final_deliverables(request_id, created_at DESC);

ALTER TABLE public_intake_final_deliverables ENABLE ROW LEVEL SECURITY;
