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

-- Idempotent replay of the same submission must resolve to the same
-- row, never create a second one.
CREATE UNIQUE INDEX uq_intake_requests_idempotency_key_hash
  ON public_intake_requests (idempotency_key_hash);

CREATE INDEX idx_intake_requests_work_email
  ON public_intake_requests (work_email_normalized);

CREATE INDEX idx_intake_requests_status
  ON public_intake_requests (status);

CREATE INDEX idx_intake_requests_created_at
  ON public_intake_requests (created_at);

ALTER TABLE public_intake_requests ENABLE ROW LEVEL SECURITY;

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
    'request.rate_limited_ip',
    'request.rate_limited_email',
    'request.duplicate_suppressed',
    'request.confirmation_email_sent',
    'request.confirmation_email_failed',
    'request.internal_notification_sent',
    'request.internal_notification_failed',
    'request.status_changed',
    'request.upload_session_created',
    'request.upload_invited',
    'request.upload_invite_email_sent',
    'request.upload_invite_email_failed',
    'request.upload_session_revoked',
    'upload.token_denied_invalid',
    'upload.token_denied_expired',
    'upload.token_denied_revoked',
    'upload.token_denied_used',
    'upload.token_accepted',
    'upload.object_signed',
    'upload.file_rejected_type',
    'upload.file_rejected_size',
    'upload.completion_verified',
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
-- public_intake_files
-- ============================================================
-- One row per file accepted into private storage. storage_object_key
-- is always server-generated (see
-- src/storage/intake-object-key.ts) and is never derived from
-- original_filename, which is retained purely as display/audit
-- metadata and must never be interpolated into a storage path.
CREATE TABLE public_intake_files (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id              UUID NOT NULL REFERENCES public_intake_requests(id) ON DELETE CASCADE,
  upload_session_id       UUID NOT NULL REFERENCES public_upload_sessions(id) ON DELETE CASCADE,
  storage_object_key       TEXT NOT NULL,
  original_filename       TEXT NOT NULL,
  content_type            TEXT NOT NULL,
  size_bytes               BIGINT NOT NULL,
  scan_status              TEXT NOT NULL DEFAULT 'pending_review',
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_intake_files_content_type CHECK (content_type IN (
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'image/png',
    'image/jpeg',
    'text/plain'
  )),
  CONSTRAINT chk_intake_files_size
    CHECK (size_bytes > 0 AND size_bytes <= 20971520),
  CONSTRAINT chk_intake_files_scan_status
    CHECK (scan_status IN ('pending_review', 'cleared', 'quarantined')),
  CONSTRAINT chk_intake_files_original_filename_len
    CHECK (char_length(original_filename) BETWEEN 1 AND 255)
);

CREATE UNIQUE INDEX uq_intake_files_storage_object_key
  ON public_intake_files (storage_object_key);

CREATE INDEX idx_intake_files_request_id
  ON public_intake_files (request_id);

CREATE INDEX idx_intake_files_upload_session_id
  ON public_intake_files (upload_session_id);

-- Per-session file COUNT (<=5) is enforced in application code at
-- insert time (COUNT(*) WHERE upload_session_id = $1 FOR UPDATE),
-- matching this repo's no-ORM, explicit-transaction convention. The
-- per-session TOTAL byte budget (<=60MB) is likewise summed and
-- enforced in application code before each signed-upload URL is
-- issued; PostgreSQL CHECK constraints cannot express a
-- cross-row aggregate. See Gate 6 QA evidence for the enforcement
-- tests covering both limits.
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
