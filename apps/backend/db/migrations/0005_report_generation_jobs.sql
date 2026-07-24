-- ============================================================
-- Phoenix Backend — Migration 0005: Report Generation Jobs
-- PHX-REPORTS-004 — Report Generation Lifecycle & Secure Artifact
-- Delivery Foundation
-- ------------------------------------------------------------
-- A minimal, database-backed job queue for asynchronous report
-- generation. No ORM, no external queue service — a plain table,
-- claimed with PostgreSQL's `FOR UPDATE SKIP LOCKED` (see
-- src/repositories/report-jobs.repository.ts), matching this project's
-- existing "parameterized SQL only, no framework" discipline.
--
-- Pure ADDITIONS after 0004_report_version.sql — no ALTER on any
-- existing table. Applies identically to a fresh database (0001-0006 in
-- order) and to an already-migrated 0001-0004 database (0005, 0006
-- applied on top).
--
-- ---- Active-job uniqueness (mirrors 0003's uq_reports_active_request) --
-- Only one Queued/Processing job may exist per (report_id,
-- report_version) at a time — the same "partial unique index is the
-- real, concurrency-safe guarantee; an app-level pre-check only gives a
-- clean error message on the non-racing path" pattern 0003 already
-- established for reports.status. Unlike 0003's index, no NULL-handling
-- modifier is needed here — report_id/report_version are both always
-- present (NOT NULL), so a plain partial unique index is sufficient
-- (no NULLS NOT DISTINCT required).
--
-- ---- Claim/lease/attempt fields ---------------------------------------
-- attempt_count   — incremented by the claim UPDATE itself (see
--                   report-jobs.repository.ts's claimNextJob()), checked
--                   against a configured max before a job may be claimed
--                   at all (see the claimable partial index below) and
--                   again by the generation service before deciding
--                   requeue-vs-terminal-fail.
-- available_at    — when this job becomes claimable. Set to `now()` at
--                   insert time; re-stamped forward (bounded backoff) on
--                   a requeue, and re-stamped by the lease-reclaim sweep
--                   when a stale Processing job is returned to Queued.
-- locked_at       — set when a worker claims (Processing) and refreshed
--                   by that worker's periodic heartbeat while it holds
--                   the job; a Processing job whose locked_at is older
--                   than the configured lease timeout is treated as
--                   abandoned by the reclaim sweep.
-- locked_by       — the process-unique worker id that currently holds
--                   this job (crypto.randomUUID() per worker-process
--                   start, not a hostname/PID) — every terminal write
--                   this project's worker makes is fenced by
--                   `WHERE locked_by = $workerId`, so a worker that has
--                   lost its lease (reclaimed by the sweep, or reclaimed
--                   and re-claimed by a different worker instance) can
--                   never overwrite another worker's outcome.
-- last_error      — sanitized only (never a stack trace, filesystem
--                   path, or SQL fragment) — same sanitization boundary
--                   as reports.failure_reason.
-- ============================================================

CREATE TABLE report_generation_jobs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id      UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  report_version INTEGER NOT NULL,
  status         TEXT NOT NULL, -- 'Queued' | 'Processing' | 'Succeeded' | 'Failed'
  attempt_count  INTEGER NOT NULL DEFAULT 0,
  available_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at      TIMESTAMPTZ NULL,
  locked_by      TEXT NULL,
  last_error     TEXT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_report_generation_jobs_status
    CHECK (status IN ('Queued', 'Processing', 'Succeeded', 'Failed')),
  CONSTRAINT chk_report_generation_jobs_attempt_count
    CHECK (attempt_count >= 0)
);

-- Only one active (Queued/Processing) job per (report_id, report_version).
CREATE UNIQUE INDEX uq_report_generation_jobs_active
  ON report_generation_jobs (report_id, report_version)
  WHERE status IN ('Queued', 'Processing');

-- Supports the claim query's WHERE status = 'Queued' AND available_at <= now()
-- ORDER BY available_at ASC scan.
CREATE INDEX idx_report_generation_jobs_claimable
  ON report_generation_jobs (available_at)
  WHERE status = 'Queued';

-- Supports the lease-reclaim sweep's WHERE status = 'Processing' AND
-- locked_at < <cutoff> scan.
CREATE INDEX idx_report_generation_jobs_processing_locked_at
  ON report_generation_jobs (locked_at)
  WHERE status = 'Processing';

-- Supports report-scoped job lookups (e.g. "does a valid Processing lease
-- exist for this (report_id, report_version)?" — used by the artifact
-- reconciliation sweep's race-safety check).
CREATE INDEX idx_report_generation_jobs_report_version
  ON report_generation_jobs (report_id, report_version);

-- ============================================================
-- End of migration 0005.
-- ============================================================
