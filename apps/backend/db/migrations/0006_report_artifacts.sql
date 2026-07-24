-- ============================================================
-- Phoenix Backend — Migration 0006: Report Artifacts
-- PHX-REPORTS-004 — Report Generation Lifecycle & Secure Artifact
-- Delivery Foundation
-- ------------------------------------------------------------
-- Immutable per-version artifact metadata, one row per successfully
-- stored generated report file. This table is INSERT-only from
-- application code (see src/repositories/report-artifacts.repository.ts)
-- — there is no UPDATE path anywhere in this backend for this table,
-- matching audit_records' append-only discipline (0001_initial_schema.sql).
-- A retry/regeneration always increments reports.report_version first
-- (existing PHX-REPORTS-004 lifecycle rule), so a new attempt always
-- gets its own new artifact row here rather than overwriting a prior
-- version's metadata — prior-version history is therefore preserved by
-- construction, not by a special case in this table's design.
--
-- storage_key is server-generated only (see
-- src/storage/report-artifact-store.ts) — never accepted from a client
-- request, and never returned by any public API response (see
-- src/repositories/reports.repository.ts's canonical report read model,
-- which deliberately omits storage_key/sha256 from every response
-- shape). sha256/size_bytes are computed from the actual bytes written
-- to storage, not trusted from any external input.
-- ============================================================

CREATE TABLE report_artifacts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id      UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  report_version INTEGER NOT NULL,
  storage_key    TEXT NOT NULL,
  filename       TEXT NOT NULL,
  content_type   TEXT NOT NULL,
  size_bytes     BIGINT NOT NULL,
  sha256         TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_report_artifacts_size CHECK (size_bytes >= 0),
  CONSTRAINT chk_report_artifacts_sha256_length CHECK (char_length(sha256) = 64)
);

-- Immutable: exactly one artifact row per generation attempt.
CREATE UNIQUE INDEX uq_report_artifacts_report_version
  ON report_artifacts (report_id, report_version);

-- Supports "does an artifact row already exist for this report's
-- CURRENT version?" lookups from the download endpoint and the
-- reconciliation sweep.
CREATE INDEX idx_report_artifacts_report_id
  ON report_artifacts (report_id);

-- ============================================================
-- End of migration 0006.
-- ============================================================
