// ============================================================
// Phoenix Backend — Report Generation Jobs Repository
// PHX-REPORTS-004 — Report Generation Lifecycle & Secure Artifact
// Delivery Foundation
// ------------------------------------------------------------
// Thin, explicit, parameterized-SQL-only functions against
// report_generation_jobs (migration 0005_report_generation_jobs.sql). No
// ORM, no string interpolation with user input.
//
// ---- Fencing (Phase 1 Addendum A §3 / Addendum B §2) -------------------
// Every write this module makes that mutates a job a worker currently
// holds is fenced by `WHERE locked_by = $workerId` (completeJob(),
// failOrRequeueJob()) — a worker that has lost its lease (reclaimed by
// reclaimStaleJobs() below, and possibly re-claimed by a different
// worker instance) can never overwrite another worker's outcome. Callers
// MUST check the returned row count / null-vs-row result and treat "zero
// rows affected" as "I no longer hold this job" — never as an error to
// retry.
//
// ---- Claim query never claims an exhausted job (Addendum B §2) --------
// claimNextJob()'s WHERE clause includes `attempt_count < $maxAttempts`
// — a job already at or beyond the configured maximum can never be
// claimed again, by any worker, even if it were somehow still 'Queued'.
// ============================================================

import type { Pool, PoolClient } from 'pg';
import { getDatabasePool } from '../db/client';
import { withTransaction } from '../db/transaction';
import { recordAudit } from './audit.repository';

type Queryable = Pool | PoolClient;

export type ReportJobStatus = 'Queued' | 'Processing' | 'Succeeded' | 'Failed';

export interface ReportJobRecord {
  id: string;
  reportId: string;
  reportVersion: number;
  status: ReportJobStatus;
  attemptCount: number;
  availableAt: string;
  lockedAt: string | null;
  lockedBy: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ReportJobRow {
  id: string;
  report_id: string;
  report_version: number;
  status: ReportJobStatus;
  attempt_count: number;
  available_at: string;
  locked_at: string | null;
  locked_by: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

function mapReportJobRow(row: ReportJobRow): ReportJobRecord {
  return {
    id: row.id,
    reportId: row.report_id,
    reportVersion: row.report_version,
    status: row.status,
    attemptCount: row.attempt_count,
    availableAt: row.available_at,
    lockedAt: row.locked_at,
    lockedBy: row.locked_by,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Inserts one Queued job for (reportId, reportVersion). Callers must
 * already be inside the same transaction as the report-status UPDATE
 * that put the report into 'Generating' (see routes/reports.ts) — the
 * migration's uq_report_generation_jobs_active partial unique index is
 * the concurrency-safe guarantee against two active jobs ever existing
 * for the same (report_id, report_version); a unique-violation here
 * indicates a real race and is rethrown for the caller's existing
 * isUniqueViolation()-style handling (matching reports.ts's existing
 * pattern for reports' own active-request index).
 */
export async function createReportJob(
  input: { reportId: string; reportVersion: number },
  client: PoolClient
): Promise<ReportJobRecord> {
  const result = await client.query<ReportJobRow>(
    `INSERT INTO report_generation_jobs (report_id, report_version, status)
     VALUES ($1, $2, 'Queued')
     RETURNING
       id, report_id, report_version, status, attempt_count, available_at,
       locked_at, locked_by, last_error, created_at, updated_at`,
    [input.reportId, input.reportVersion]
  );
  return mapReportJobRow(result.rows[0]);
}

/**
 * Atomically claims the single oldest claimable Queued job — `FOR
 * UPDATE SKIP LOCKED` so N concurrent worker processes never claim the
 * same row, `attempt_count < $maxAttempts` so an exhausted job can never
 * be (re-)claimed (Addendum B §2), `available_at <= now()` so a
 * bounded-backoff-delayed requeue isn't claimed early. Increments
 * attempt_count as part of the same claiming UPDATE. Returns null if no
 * claimable job exists. Must be called with its own borrowed
 * PoolClient/transaction — see workers/report-generation-worker.ts.
 */
export async function claimNextJob(client: PoolClient, workerId: string, maxAttempts: number): Promise<ReportJobRecord | null> {
  const candidate = await client.query<{ id: string }>(
    `SELECT id
     FROM report_generation_jobs
     WHERE status = 'Queued'
       AND available_at <= now()
       AND attempt_count < $1
     ORDER BY available_at ASC
     LIMIT 1
     FOR UPDATE SKIP LOCKED`,
    [maxAttempts]
  );

  const claimableId = candidate.rows[0]?.id;
  if (!claimableId) return null;

  const claimed = await client.query<ReportJobRow>(
    `UPDATE report_generation_jobs
     SET status = 'Processing',
         locked_at = now(),
         locked_by = $2,
         attempt_count = attempt_count + 1,
         updated_at = now()
     WHERE id = $1
     RETURNING
       id, report_id, report_version, status, attempt_count, available_at,
       locked_at, locked_by, last_error, created_at, updated_at`,
    [claimableId, workerId]
  );

  return mapReportJobRow(claimed.rows[0]);
}

/**
 * Refreshes locked_at for a job this worker still holds (Addendum A §3
 * heartbeat). Fenced by locked_by — a worker whose lease was already
 * reclaimed cannot resurrect it via a heartbeat. Returns true if the
 * heartbeat was actually applied (this worker still holds the lease).
 */
export async function heartbeatJob(jobId: string, workerId: string, client: Queryable = getDatabasePool()): Promise<boolean> {
  const result = await client.query(
    `UPDATE report_generation_jobs
     SET locked_at = now(), updated_at = now()
     WHERE id = $1 AND status = 'Processing' AND locked_by = $2`,
    [jobId, workerId]
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Fenced terminal success. Returns true only if this worker still held
 * the lease at the time of this UPDATE (0 rows affected means the lease
 * was lost — see file header; the caller MUST NOT proceed to mark the
 * report Available if this returns false).
 */
export async function completeJob(jobId: string, workerId: string, client: PoolClient): Promise<boolean> {
  const result = await client.query(
    `UPDATE report_generation_jobs
     SET status = 'Succeeded', updated_at = now()
     WHERE id = $1 AND status = 'Processing' AND locked_by = $2`,
    [jobId, workerId]
  );
  return (result.rowCount ?? 0) > 0;
}

export interface FailOrRequeueInput {
  jobId: string;
  workerId: string;
  attemptCount: number;
  maxAttempts: number;
  backoffBaseSeconds: number;
  sanitizedError: string;
}

export type FailOrRequeueOutcome = 'requeued' | 'terminally-failed' | 'lease-lost';

/**
 * Fenced failure handling (Addendum A §5 / Addendum B §2): requeues
 * (locks cleared, bounded linear backoff applied to available_at) when
 * attemptCount < maxAttempts, or marks the job terminally Failed when
 * attemptCount >= maxAttempts. Both writes are fenced by locked_by — if
 * this worker no longer holds the lease, returns 'lease-lost' and
 * writes nothing; the caller must not then also transition the report
 * (that would race whichever process actually now owns this job/report).
 */
export async function failOrRequeueJob(input: FailOrRequeueInput, client: PoolClient): Promise<FailOrRequeueOutcome> {
  if (input.attemptCount < input.maxAttempts) {
    const backoffSeconds = input.attemptCount * input.backoffBaseSeconds;
    const result = await client.query(
      `UPDATE report_generation_jobs
       SET status = 'Queued',
           locked_at = NULL,
           locked_by = NULL,
           available_at = now() + ($3 * interval '1 second'),
           last_error = $4,
           updated_at = now()
       WHERE id = $1 AND status = 'Processing' AND locked_by = $2`,
      [input.jobId, input.workerId, backoffSeconds, input.sanitizedError]
    );
    return (result.rowCount ?? 0) > 0 ? 'requeued' : 'lease-lost';
  }

  const result = await client.query(
    `UPDATE report_generation_jobs
     SET status = 'Failed',
         locked_at = NULL,
         locked_by = NULL,
         last_error = $3,
         updated_at = now()
     WHERE id = $1 AND status = 'Processing' AND locked_by = $2`,
    [input.jobId, input.workerId, input.sanitizedError]
  );
  return (result.rowCount ?? 0) > 0 ? 'terminally-failed' : 'lease-lost';
}

/**
 * Lease-reclaim sweep, part 1: reclaims stale Processing jobs that still
 * have attempts remaining, in one set-based UPDATE (safe as a bulk
 * operation — this branch never touches the `reports` table, so no
 * per-row report/audit fencing is needed here). Run at the top of every
 * worker poll cycle, before attempting a claim.
 */
export async function reclaimNonExhaustedStaleJobs(
  client: Queryable,
  input: { leaseTimeoutSeconds: number; maxAttempts: number; backoffBaseSeconds: number }
): Promise<number> {
  const result = await client.query(
    `UPDATE report_generation_jobs
     SET status = 'Queued',
         locked_at = NULL,
         locked_by = NULL,
         available_at = now() + (attempt_count * $2 * interval '1 second'),
         last_error = 'Worker lease expired before completion; job reclaimed for retry.',
         updated_at = now()
     WHERE status = 'Processing'
       AND locked_at < now() - ($1 * interval '1 second')
       AND attempt_count < $3`,
    [input.leaseTimeoutSeconds, input.backoffBaseSeconds, input.maxAttempts]
  );
  return result.rowCount ?? 0;
}

/**
 * Lease-reclaim sweep, part 2a: a plain (non-locking) read identifying
 * stale Processing jobs that have EXHAUSTED their attempts. Each id
 * returned here must be finalized individually via
 * finalizeExhaustedStaleJob() below, in its own transaction — never
 * batch-updated, per execution control #8 ("every exhausted stale-job
 * transition must atomically update the job, the matching report
 * version, and the system audit record" — a single set-based UPDATE
 * across many jobs could touch several different reports, which cannot
 * be expressed as one atomic job+report+audit unit).
 */
export async function findExhaustedStaleJobIds(input: { leaseTimeoutSeconds: number; maxAttempts: number }): Promise<string[]> {
  const pool = getDatabasePool();
  const result = await pool.query<{ id: string }>(
    `SELECT id
     FROM report_generation_jobs
     WHERE status = 'Processing'
       AND locked_at < now() - ($1 * interval '1 second')
       AND attempt_count >= $2`,
    [input.leaseTimeoutSeconds, input.maxAttempts]
  );
  return result.rows.map((row) => row.id);
}

export type FinalizeExhaustedJobOutcome = 'finalized' | 'finalized-report-already-changed' | 'already-handled';

/**
 * Lease-reclaim sweep, part 2b: atomically finalizes ONE exhausted,
 * stale Processing job — re-verifies (under `FOR UPDATE`) that it is
 * still Processing, still stale, and still at/over maxAttempts (a
 * defensive re-check, since this runs in its own transaction, separate
 * from findExhaustedStaleJobIds()'s plain read), then in the SAME
 * transaction: marks the job Failed, fencedly transitions the matching
 * report (`status = 'Generating' AND report_version = <job's version>`)
 * to Failed, and — only if that report transition actually affected a
 * row — writes the `report.generation.failed` audit record (actor
 * null). This satisfies execution control #8 exactly: job, matching
 * report version, and audit record are one atomic unit.
 *
 * If the report's fencing condition does not match (e.g. another
 * process already changed its status/version), the job is still marked
 * Failed (it genuinely IS exhausted) but no audit row is written for a
 * report transition that did not happen — outcome
 * 'finalized-report-already-changed'.
 */
export async function finalizeExhaustedStaleJob(
  jobId: string,
  input: { leaseTimeoutSeconds: number; maxAttempts: number }
): Promise<FinalizeExhaustedJobOutcome> {
  return withTransaction(async (client) => {
    const lockedResult = await client.query<{
      id: string;
      report_id: string;
      report_version: number;
      attempt_count: number;
      locked_at: string | null;
      status: ReportJobStatus;
    }>(
      `SELECT id, report_id, report_version, attempt_count, locked_at, status
       FROM report_generation_jobs
       WHERE id = $1
         AND status = 'Processing'
         AND locked_at < now() - ($2 * interval '1 second')
         AND attempt_count >= $3
       FOR UPDATE`,
      [jobId, input.leaseTimeoutSeconds, input.maxAttempts]
    );

    const locked = lockedResult.rows[0];
    if (!locked) return 'already-handled';

    const sanitizedReason = 'Exceeded maximum generation attempts after a stale worker lease.';

    await client.query(
      `UPDATE report_generation_jobs
       SET status = 'Failed', locked_at = NULL, locked_by = NULL, last_error = $2, updated_at = now()
       WHERE id = $1`,
      [jobId, sanitizedReason]
    );

    const reportResult = await client.query<{ workspace_id: string }>(
      `UPDATE reports
       SET status = 'Failed', failure_reason = $3, updated_at = now()
       WHERE id = $1 AND status = 'Generating' AND report_version = $2
       RETURNING workspace_id`,
      [locked.report_id, locked.report_version, sanitizedReason]
    );

    const reportRow = reportResult.rows[0];
    if (!reportRow) return 'finalized-report-already-changed';

    await recordAudit(
      {
        workspaceId: reportRow.workspace_id,
        actorUserId: null,
        action: 'report.generation.failed',
        entityType: 'Report',
        entityId: locked.report_id,
        changes: { status: ['Generating', 'Failed'] },
        context: 'Stale worker lease exhausted maximum attempts.',
      },
      client
    );

    return 'finalized';
  });
}

/**
 * True if a valid (not stale) Processing job/lease currently exists for
 * (reportId, reportVersion) — used by the artifact-reconciliation
 * sweep's race-safety check (Addendum B §1, condition 2): a file backing
 * a job that is still genuinely being processed must never be deleted,
 * regardless of the file's age.
 */
export async function hasValidProcessingLease(
  reportId: string,
  reportVersion: number,
  leaseTimeoutSeconds: number
): Promise<boolean> {
  const pool = getDatabasePool();
  const result = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM report_generation_jobs
       WHERE report_id = $1 AND report_version = $2
         AND status = 'Processing'
         AND locked_at >= now() - ($3 * interval '1 second')
     ) AS exists`,
    [reportId, reportVersion, leaseTimeoutSeconds]
  );
  return result.rows[0]?.exists ?? false;
}

/** True if a report_generation_jobs row exists at all for (reportId, reportVersion) — used by the reconciliation sweep's condition 1 is actually checked against report_artifacts, not this; this helper exists for QA/introspection use. */
export async function jobExistsForReportVersion(reportId: string, reportVersion: number): Promise<boolean> {
  const pool = getDatabasePool();
  const result = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM report_generation_jobs WHERE report_id = $1 AND report_version = $2
     ) AS exists`,
    [reportId, reportVersion]
  );
  return result.rows[0]?.exists ?? false;
}
