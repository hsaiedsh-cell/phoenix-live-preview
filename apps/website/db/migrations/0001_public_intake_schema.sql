-- ============================================================
-- Phoenix Website — Migration 0001: Public Intake Schema
-- PHX-LAUNCH-001 — Phoenix Private Beta & Request Intake Launch
-- ------------------------------------------------------------
-- Additive schema for the public, unauthenticated request-intake
-- workflow served by apps/website. This schema is intentionally
-- separate from apps/backend's authenticated Phoenix domain schema
-- (organizations, workspaces, assessments, pbrs_scores, reports,
-- audit_records, etc.) — no existing table is altered, and no
-- existing table is referenced here. This migration does not
-- change PBRS scoring, PBRS dimensions, Certification/Passport
-- logic, or the authenticated Platform/Dashboard schema in any way.
--
-- Target: Supabase-hosted PostgreSQL. All server writes/reads to
-- these tables happen exclusively through service-role-authenticated
-- Next.js Route Handlers in apps/website/src/app/api — never from
-- browser code, and never with the anonymous/authenticated Supabase
-- roles. Accordingly every table below has Row Level Security
-- enabled with ZERO policies defined: with RLS ON and no policies,
-- PostgreSQL denies all access to every role except the table owner
-- and roles with BYPASSRLS (Supabase's service_role has BYPASSRLS
-- by default). This is the intended, most restrictive posture — do
-- not add anon/authenticated policies to these tables.
--
-- THIS FILE IS NOT APPLIED TO ANY HOSTED SUPABASE PROJECT BY THIS
-- SPRINT. It has been verified only against a local, isolated
-- PostgreSQL 16 instance (see PHX-LAUNCH-001-FINAL-IMPLEMENTATION-
-- REPORT.md, Gate 3 evidence). Applying it to a real Supabase
-- project is an explicit later step requiring owner approval and
-- hosted-project credentials, per the mandatory stop conditions in
-- the PHX-LAUNCH-001 execution package.
-- ============================================================

-- Extensions ---------------------------------------------------
-- gen_random_uuid() via pgcrypto and CITEXT for case-insensitive
-- email comparisons, matching apps/backend/db/migrations/0001's
-- established convention.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

-- ============================================================
-- public_intake_requests
-- ============================================================
-- One row per public Request Assessment / Book a Demo / General
-- submission. public_reference is the only identifier ever shown
-- to the customer or placed in outbound email — the UUID primary
-- key is never exposed externally.
CREATE TABLE public_intake_requests (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference        TEXT NOT NULL,
  request_type            TEXT NOT NULL,
  first_name              TEXT NOT NULL,
  last_name               TEXT NOT NULL,
  work_email_normalized   CITEXT NOT NULL,
  company                 TEXT NOT NULL,
  role                    TEXT NOT NULL,
  phone                   TEXT NULL,
  country                 TEXT NULL,
  estimated_timeline      TEXT NULL,
  message                 TEXT NOT NULL,
  status                  TEXT NOT NULL DEFAULT 'received',
  privacy_consent         BOOLEAN NOT NULL,
  privacy_version         TEXT NOT NULL,
  terms_version           TEXT NOT NULL,
  marketing_consent       BOOLEAN NOT NULL DEFAULT false,
  consent_timestamp       TIMESTAMPTZ NOT NULL,
  -- HMAC-SHA256(INTAKE_HASH_SECRET, idempotencyKey) — never the raw
  -- client-supplied key. UNIQUE enforces "duplicate row not created
  -- on replay" at the database layer, not only in application logic.
  idempotency_key_hash    TEXT NOT NULL,
  -- HMAC-SHA256(INTAKE_HASH_SECRET, normalized-ip) — raw IP is never
  -- received by this table. Nullable because some deployment fronts
  -- (e.g. certain proxies) may not supply a client IP; absence must
  -- not block a legitimate submission.
  ip_hash                 TEXT NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_intake_requests_type
    CHECK (request_type IN ('assessment', 'demo', 'general')),
  CONSTRAINT chk_intake_requests_status
    CHECK (status IN (
      'received', 'under_review', 'upload_invited', 'files_received',
      'quoted', 'accepted', 'rejected', 'closed'
    )),
  CONSTRAINT chk_intake_requests_privacy_consent_required
    CHECK (privacy_consent = true),
  CONSTRAINT chk_intake_requests_first_name_len
    CHECK (char_length(first_name) BETWEEN 1 AND 100),
  CONSTRAINT chk_intake_requests_last_name_len
    CHECK (char_length(last_name) BETWEEN 1 AND 100),
  CONSTRAINT chk_intake_requests_company_len
    CHECK (char_length(company) BETWEEN 1 AND 200),
  CONSTRAINT chk_intake_requests_role_len
    CHECK (char_length(role) BETWEEN 1 AND 200),
  CONSTRAINT chk_intake_requests_message_len
    CHECK (char_length(message) BETWEEN 1 AND 5000),
  CONSTRAINT chk_intake_requests_phone_len
    CHECK (phone IS NULL OR char_length(phone) <= 40),
  CONSTRAINT chk_intake_requests_country_len
    CHECK (country IS NULL OR char_length(country) <= 100),
  CONSTRAINT chk_intake_requests_timeline_len
    CHECK (estimated_timeline IS NULL OR char_length(estimated_timeline) <= 100)
);

-- Public reference is the customer-facing identifier — must never
-- collide, and is looked up on every finalize/upload-session call.
CREATE UNIQUE INDEX uq_intake_requests_public_reference
  ON public_intake_requests (public_reference);

-- R1: idempotency is now a time-bounded 15-minute contract, tracked
-- in the separate public_intake_idempotency_keys table below (NOT a
-- forever-unique index on this column) — see that table's header
-- comment and PHX-LAUNCH-001-R1 §2.2. idempotency_key_hash is kept
-- here only as non-unique audit/debug metadata on the row that was
-- actually created.
CREATE INDEX idx_intake_requests_idempotency_key_hash
  ON public_intake_requests (idempotency_key_hash);

CREATE INDEX idx_intake_requests_work_email
  ON public_intake_requests (work_email_normalized);

CREATE INDEX idx_intake_requests_status
  ON public_intake_requests (status);

CREATE INDEX idx_intake_requests_created_at
  ON public_intake_requests (created_at);

ALTER TABLE public_intake_requests ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- public_intake_idempotency_keys  (R2: transaction-pooler-compatible
-- state machine — replaces R1's session-scoped advisory-lock design)
-- ============================================================
-- R1 used a session-scoped `pg_advisory_lock`, held for the whole
-- submit flow including the external Turnstile call. That requires
-- a persistent session-mode database connection, which the target
-- Vercel serverless runtime cannot guarantee when traffic is routed
-- through Supabase's transaction-mode connection pooler (the
-- normally-recommended mode for serverless traffic) — a pooler may
-- hand different physical connections to different statements within
-- what the application believes is one "session", silently breaking
-- session-scoped locks. R1 also discovered a real pool self-deadlock
-- under concurrency once the advisory-lock client's own nested
-- queries needed additional connections from the same saturated pool.
--
-- R2 replaces both the lock mechanism and the underlying assumption:
-- there is no advisory lock anywhere in this table's usage. Instead,
-- idempotency_key_hash is a genuine UNIQUE column, and every state
-- transition is a single atomic statement (INSERT ... ON CONFLICT ...
-- DO UPDATE ... WHERE, or an owner-checked UPDATE), each its own
-- short transaction that a transaction-mode pooler handles fine —
-- never a session-scoped lock, never a connection held open across
-- an external network call. See submit.service.ts's
-- claimIdempotencyKey / releaseIdempotencyClaim / completeIdempotencyClaim.
--
-- state machine:
--   pending    -- claimed by exactly one attempt (owner_token_hash
--                 identifies which one); only that owner may
--                 complete or fail it.
--   completed  -- request_id is set; a matching-fingerprint replay
--                 returns the same public reference without ever
--                 touching Turnstile again.
--   failed     -- immediately reclaimable by a new attempt, same as
--                 an expired row.
--
-- payload_fingerprint is a hash of the safe matching fields
-- (normalized work email + requestType) so the same key cannot be
-- replayed against a different payload — a mismatch is rejected as a
-- conflict, not silently accepted, in either the pending or
-- completed state.
CREATE TABLE public_intake_idempotency_keys (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key_hash    TEXT NOT NULL,
  payload_fingerprint     TEXT NOT NULL,
  state                   TEXT NOT NULL DEFAULT 'pending',
  -- Hash of a server-generated, per-claim-attempt random token.
  -- Never derived from or equal to any client-supplied value.
  -- Proves "only the owner of the active claim may complete or fail
  -- it" (R2 §1.2 item 7) without needing a session-scoped lock.
  owner_token_hash        TEXT NOT NULL,
  request_id              UUID NULL REFERENCES public_intake_requests(id) ON DELETE CASCADE,
  expires_at              TIMESTAMPTZ NOT NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_idempotency_keys_state CHECK (state IN ('pending', 'completed', 'failed')),
  -- request_id is set if and only if the claim is completed.
  CONSTRAINT chk_idempotency_keys_request_id_consistency CHECK (
    (state = 'completed' AND request_id IS NOT NULL)
    OR (state <> 'completed' AND request_id IS NULL)
  )
);

-- Genuinely UNIQUE this time (unlike R1) — the atomic
-- INSERT ... ON CONFLICT (idempotency_key_hash) DO UPDATE ... WHERE
-- pattern is exactly what requires this to be a real unique
-- constraint; it is what the database uses to detect "is there
-- already an active claim for this key" in a single statement, with
-- no separate lock of any kind.
CREATE UNIQUE INDEX uq_idempotency_keys_hash
  ON public_intake_idempotency_keys (idempotency_key_hash);

CREATE INDEX idx_idempotency_keys_request_id
  ON public_intake_idempotency_keys (request_id);

ALTER TABLE public_intake_idempotency_keys ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- public_intake_events
-- ============================================================
-- Append-only operational event log per request, mirroring the
-- append-only discipline already established for audit_records /
-- report_artifacts in apps/backend. There is no UPDATE or DELETE
-- path anywhere in application code for this table (see
-- src/repositories/intake-events.repository.ts, insert-only).
--
-- detail is restricted by application-layer discipline (never the
-- backing store) to non-sensitive structured metadata only: it must
-- never contain the customer's message body, raw IP, Turnstile
-- token, upload token, file name, or any provider secret. See Gate 8
-- evidence for the QA proving this.
CREATE TABLE public_intake_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id    UUID NOT NULL REFERENCES public_intake_requests(id) ON DELETE CASCADE,
  event_type    TEXT NOT NULL,
  detail        JSONB NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_intake_events_type CHECK (event_type IN (
    'request.received',
    'request.validation_rejected',
    'request.consent_missing',
    'request.turnstile_rejected',
    'request.turnstile_provider_error',
    'request.turnstile_provider_timeout',
    'request.rate_limited_ip',
    'request.rate_limited_email',
    'request.duplicate_suppressed',
    'request.idempotency_replay',
    'request.idempotency_conflict',
    'request.idempotency_in_progress',
    'request.idempotency_claim_released',
    'request.confirmation_email_sent',
    'request.confirmation_email_failed',
    'request.internal_notification_sent',
    'request.internal_notification_failed',
    'request.status_changed',
    'request.upload_session_created',
    'request.upload_invited',
    'request.upload_session_reissued',
    'request.upload_invite_email_sent',
    'request.upload_invite_email_failed',
    'request.upload_session_revoked',
    'upload.token_denied_invalid',
    'upload.token_denied_expired',
    'upload.token_denied_revoked',
    'upload.token_denied_used',
    'upload.token_accepted',
    'upload.reservation_created',
    'upload.reservation_failed',
    'upload.object_signed',
    'upload.file_rejected_type',
    'upload.file_rejected_size',
    'upload.file_rejected_extension',
    'upload.completion_denied_unknown_key',
    'upload.completion_denied_foreign_session',
    'upload.completion_denied_already_completed',
    'upload.completion_denied_metadata_mismatch',
    'upload.completion_denied_session_revalidation_failed',
    'upload.completion_verified',
    'upload.finalization_rejected_zero_files',
    'upload.finalization_denied_request_state',
    'upload.finalization_denied_pending_reservations',
    'upload.session_finalized',
    'upload.reservation_cancelled',
    'upload.cancellation_denied',
    'upload.orphan_cleaned',
    'upload.orphan_object_deleted',
    'upload.orphan_object_delete_failed',
    'request.files_received',
    'request.upload_complete_notification_sent',
    'request.upload_complete_notification_failed',
    'request.rejected',
    'request.closed',
    'monitoring.error_captured'
  ))
);

CREATE INDEX idx_intake_events_request_id
  ON public_intake_events (request_id);

CREATE INDEX idx_intake_events_type_created_at
  ON public_intake_events (event_type, created_at);

ALTER TABLE public_intake_events ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- public_upload_sessions
-- ============================================================
-- One row per invitation-only upload link. The raw token is never
-- persisted anywhere — only a SHA-256 hash of it, so a database
-- compromise alone cannot mint a working upload link.
CREATE TABLE public_upload_sessions (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id              UUID NOT NULL REFERENCES public_intake_requests(id) ON DELETE CASCADE,
  token_hash              TEXT NOT NULL,
  status                  TEXT NOT NULL DEFAULT 'active',
  max_files               SMALLINT NOT NULL DEFAULT 5,
  max_file_size_bytes     BIGINT NOT NULL DEFAULT 20971520,   -- 20 MB
  max_total_size_bytes    BIGINT NOT NULL DEFAULT 62914560,   -- 60 MB
  expires_at              TIMESTAMPTZ NOT NULL,
  used_at                 TIMESTAMPTZ NULL,
  revoked_at              TIMESTAMPTZ NULL,
  -- R1: set exactly once, by an atomic
  -- `UPDATE ... WHERE finalized_at IS NULL` (see
  -- upload-flow.service.ts's finalizeSessionOnce). Whichever
  -- concurrent request wins this update is the ONLY one that
  -- transitions the parent request to files_received and requests
  -- the upload-complete notification — see PHX-LAUNCH-001-R1's
  -- "Session Finalization Semantics" correction.
  finalized_at            TIMESTAMPTZ NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_upload_sessions_status
    CHECK (status IN ('active', 'used', 'revoked', 'expired')),
  CONSTRAINT chk_upload_sessions_max_files
    CHECK (max_files > 0 AND max_files <= 5),
  CONSTRAINT chk_upload_sessions_max_file_size
    CHECK (max_file_size_bytes > 0 AND max_file_size_bytes <= 20971520),
  CONSTRAINT chk_upload_sessions_max_total_size
    CHECK (max_total_size_bytes > 0 AND max_total_size_bytes <= 62914560)
);

CREATE UNIQUE INDEX uq_upload_sessions_token_hash
  ON public_upload_sessions (token_hash);

-- At most one ACTIVE session per request at a time. Reissuing
-- requires revoking the prior session first (app-layer + this
-- partial unique index enforce the same rule at two layers).
CREATE UNIQUE INDEX uq_upload_sessions_one_active_per_request
  ON public_upload_sessions (request_id)
  WHERE status = 'active';

CREATE INDEX idx_upload_sessions_request_id
  ON public_upload_sessions (request_id);

CREATE INDEX idx_upload_sessions_expires_at
  ON public_upload_sessions (expires_at);

ALTER TABLE public_upload_sessions ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- public_intake_files  (R1: durable upload RESERVATION record)
-- ============================================================
-- One row per signed-upload-URL issuance, created in the SAME
-- transaction as the concurrency-safe quota check (see
-- upload-flow.service.ts's signUploadObject, which does
-- `SELECT ... FOR UPDATE` on the parent upload session before
-- inserting this row) — never created client-side, never created
-- from client-supplied completion metadata.
--
-- storage_object_key is always server-generated (see
-- src/lib/intake/object-key.ts) and is never derived from
-- original_filename, which is retained purely as display/audit
-- metadata and must never be interpolated into a storage path.
--
-- declared_* columns are what the client claimed when requesting the
-- signed URL (used only for the pre-upload quota check).
-- verified_* columns are populated ONLY from the storage provider's
-- own provider-recorded size/Content-Type metadata at completion time (see
-- StorageAdapter.verifyObjectExists) — completion never trusts
-- client-supplied contentType/size/filename (PHX-LAUNCH-001-R1 §1.3).
CREATE TABLE public_intake_files (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id              UUID NOT NULL REFERENCES public_intake_requests(id) ON DELETE CASCADE,
  upload_session_id       UUID NOT NULL REFERENCES public_upload_sessions(id) ON DELETE CASCADE,
  storage_object_key      TEXT NOT NULL,
  original_filename       TEXT NOT NULL,
  declared_content_type   TEXT NOT NULL,
  declared_size_bytes     BIGINT NOT NULL,
  reservation_status      TEXT NOT NULL DEFAULT 'reserved',
  verified_content_type   TEXT NULL,
  verified_size_bytes     BIGINT NULL,
  scan_status             TEXT NOT NULL DEFAULT 'pending_review',
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at            TIMESTAMPTZ NULL,
  -- R5 (§6): hash of a client-generated, per-file-entry reservation
  -- key (never the raw key itself). Nullable because sign requests
  -- issued before this revision (none exist yet -- never applied to
  -- hosted Supabase) had no such key; every NEW sign request always
  -- supplies one. Bound to (upload_session_id, reservation_key_hash)
  -- via the unique index below, which is the entire mechanism that
  -- makes a same-key sign retry idempotent -- see
  -- upload-flow.service.ts's signUploadObject.
  reservation_key_hash    TEXT NULL,

  CONSTRAINT chk_intake_files_declared_content_type CHECK (declared_content_type IN (
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'image/png',
    'image/jpeg',
    'text/plain'
  )),
  CONSTRAINT chk_intake_files_verified_content_type CHECK (verified_content_type IS NULL OR verified_content_type IN (
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'image/png',
    'image/jpeg',
    'text/plain'
  )),
  CONSTRAINT chk_intake_files_declared_size
    CHECK (declared_size_bytes > 0 AND declared_size_bytes <= 20971520),
  CONSTRAINT chk_intake_files_verified_size
    CHECK (verified_size_bytes IS NULL OR (verified_size_bytes > 0 AND verified_size_bytes <= 20971520)),
  CONSTRAINT chk_intake_files_reservation_status
    CHECK (reservation_status IN ('reserved', 'completed', 'failed', 'expired', 'cancelled')),
  CONSTRAINT chk_intake_files_scan_status
    CHECK (scan_status IN ('pending_review', 'cleared', 'quarantined')),
  CONSTRAINT chk_intake_files_original_filename_len
    CHECK (char_length(original_filename) BETWEEN 1 AND 255),
  -- Defense in depth: completed_at is set if and only if the
  -- reservation is completed. The application still uses an
  -- explicit atomic UPDATE ... WHERE reservation_status = 'reserved'
  -- to prevent a double-completion race; this CHECK cannot by itself
  -- prevent that race, only detect an inconsistent row.
  CONSTRAINT chk_intake_files_completed_at_consistency CHECK (
    (reservation_status = 'completed' AND completed_at IS NOT NULL)
    OR (reservation_status <> 'completed' AND completed_at IS NULL)
  )
);

CREATE UNIQUE INDEX uq_intake_files_storage_object_key
  ON public_intake_files (storage_object_key);

-- R5 (§6): partial unique index (only when a key was actually
-- supplied) -- a same (upload_session_id, reservation_key_hash) pair
-- can only ever match ONE row, which is what lets signUploadObject
-- treat a retried sign request (same client-generated key) as "reuse
-- this reservation", not "create a second one, consuming quota
-- again".
CREATE UNIQUE INDEX uq_intake_files_session_reservation_key
  ON public_intake_files (upload_session_id, reservation_key_hash)
  WHERE reservation_key_hash IS NOT NULL;

CREATE INDEX idx_intake_files_request_id
  ON public_intake_files (request_id);

CREATE INDEX idx_intake_files_upload_session_id
  ON public_intake_files (upload_session_id);

-- R1: the per-session file COUNT (<=5) and total byte BUDGET
-- (<=60MB) are now enforced inside one transaction that also holds
-- `SELECT ... FOR UPDATE` on the parent public_upload_sessions row
-- (see upload-flow.service.ts's signUploadObject), so concurrent
-- sign requests serialize on that row lock and cannot jointly
-- exceed either limit. The count/sum below include every row whose
-- reservation_status is 'reserved' OR 'completed' (i.e. every
-- non-failed, non-expired reservation), per PHX-LAUNCH-001-R1 §1.2.
-- See scripts/qa/gate6r1-upload-r1.qa.ts for the concurrency proof.
ALTER TABLE public_intake_files ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- public_intake_rate_limits
-- ============================================================
-- Fixed-window counters keyed by HMAC hash of IP / normalized email
-- / idempotency key. Never stores a raw IP address or raw email.
CREATE TABLE public_intake_rate_limits (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  limiter_key         TEXT NOT NULL,
  window_started_at   TIMESTAMPTZ NOT NULL,
  request_count       INTEGER NOT NULL DEFAULT 1,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_rate_limits_count CHECK (request_count > 0),
  CONSTRAINT chk_rate_limits_key_len CHECK (char_length(limiter_key) BETWEEN 1 AND 200)
);

-- One counter row per (limiter_key, window). Application code does
-- an atomic upsert (INSERT ... ON CONFLICT DO UPDATE SET
-- request_count = request_count + 1) against this index.
CREATE UNIQUE INDEX uq_rate_limits_key_window
  ON public_intake_rate_limits (limiter_key, window_started_at);

CREATE INDEX idx_rate_limits_key
  ON public_intake_rate_limits (limiter_key);

ALTER TABLE public_intake_rate_limits ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- End of migration 0001 (public intake schema).
-- No table, column, index, or constraint in this file alters,
-- references, or depends on any table owned by apps/backend
-- (organizations, workspaces, assessments, pbrs_scores,
-- pbrs_dimension_scores, derived_signals, pbrs_certifications,
-- reports, report_artifacts, audit_records, auth_identities, etc.).
-- ============================================================
