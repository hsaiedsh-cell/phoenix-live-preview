-- ============================================================
-- PHX-LAUNCH-002 R2 — operator queue read-model indexes
-- Additive only; the PHX-LAUNCH-001 baseline migration is immutable.
-- ============================================================

CREATE INDEX idx_intake_requests_queue_order
  ON public_intake_requests (created_at DESC, id DESC);

CREATE INDEX idx_intake_requests_status_queue
  ON public_intake_requests (status, created_at DESC, id DESC);

CREATE INDEX idx_intake_requests_type_queue
  ON public_intake_requests (request_type, created_at DESC, id DESC);

CREATE INDEX idx_upload_sessions_request_latest
  ON public_upload_sessions (request_id, created_at DESC, id DESC);

CREATE INDEX idx_intake_files_session_completed
  ON public_intake_files (upload_session_id)
  WHERE reservation_status = 'completed';

CREATE INDEX idx_intake_events_request_history
  ON public_intake_events (request_id, created_at ASC, id ASC);
