// ============================================================
// Phoenix Backend — Report Generation Service
// PHX-REPORTS-004 — Report Generation Lifecycle & Secure Artifact
// Delivery Foundation
// ------------------------------------------------------------
// Orchestrates one worker's "claim -> render -> store -> commit" cycle.
// Called by both the continuous worker loop and the deterministic
// once/batch CLI (workers/report-generation-worker.ts,
// scripts/report-worker-once.ts) — the actual generation logic lives
// here exactly once.
//
// ---- Ordering (Phase 1 Addendum A §4, corrected) ------------------------
//   1. Render bytes in memory (rendering/index.ts).
//   2. Write to a deterministic key via the artifact store's atomic
//      temp-then-rename write (file now exists on disk, no DB row yet).
//   3. ONE transaction: fenced report Generating->Available UPDATE FIRST
//      (if this affects 0 rows, roll back immediately — never proceed to
//      the artifact-metadata insert) -> insert report_artifacts row ->
//      fenced job-completion UPDATE (if this affects 0 rows, roll back
//      the whole transaction, including the report/artifact writes that
//      haven't committed yet) -> activity ('ReportGenerated', actor
//      null, actorDisplayName 'Phoenix System') -> audit
//      ('report.generated', actor null) -> COMMIT.
//   4. If step 3 rolls back for ANY reason (fencing miss at either
//      point, constraint violation, connection drop), the file written
//      in step 2 is deleted before this function returns — never a
//      silent orphan, never a report marked Available before the
//      transaction actually committed.
// ============================================================

import { randomUUID } from 'node:crypto';
import { getReportWorkerConfig, type ReportWorkerConfig } from '../config/report-worker-env';
import { getReportArtifactStore, buildReportArtifactKey } from '../storage/report-artifact-store';
import { renderReport } from '../rendering';
import { withTransaction } from '../db/transaction';
import {
  claimNextJob,
  completeJob,
  failOrRequeueJob,
  heartbeatJob,
  reclaimNonExhaustedStaleJobs,
  findExhaustedStaleJobIds,
  finalizeExhaustedStaleJob,
  type ReportJobRecord,
} from '../repositories/report-jobs.repository';
import { createReportArtifact } from '../repositories/report-artifacts.repository';
import {
  completeReportGeneration,
  failReportGeneration,
  getReportGenerationContext,
} from '../repositories/reports.repository';
import { recordActivity } from '../repositories/activity.repository';
import { recordAudit } from '../repositories/audit.repository';

/** A generic, sanitized failure message safe to store/display — never a raw error message, stack trace, path, or SQL fragment. */
function sanitizeUnknownError(): string {
  return 'Report generation failed while rendering or storing the report. Please retry.';
}

class LeaseLostError extends Error {
  constructor() {
    super('Worker lost its lease on this job before the generation transaction could commit.');
    this.name = 'LeaseLostError';
  }
}

export type ProcessOneCycleResult =
  | { outcome: 'idle' }
  | { outcome: 'completed'; reportId: string }
  | { outcome: 'requeued'; reportId: string }
  | { outcome: 'terminally-failed'; reportId: string }
  | { outcome: 'lease-lost'; reportId: string };

/**
 * Runs the lease-reclaim sweep (Phase 1 Addendum B §2's two branches)
 * for one poll cycle. Safe to call repeatedly; idempotent per-job (a
 * job already reclaimed/finalized by a prior call is simply not
 * matched again).
 */
export async function runLeaseSweep(config: ReportWorkerConfig = getReportWorkerConfig()): Promise<void> {
  await withTransaction((client) =>
    reclaimNonExhaustedStaleJobs(client, {
      leaseTimeoutSeconds: config.leaseTimeoutSeconds,
      maxAttempts: config.maxAttempts,
      backoffBaseSeconds: config.backoffBaseSeconds,
    })
  );

  const exhaustedIds = await findExhaustedStaleJobIds({
    leaseTimeoutSeconds: config.leaseTimeoutSeconds,
    maxAttempts: config.maxAttempts,
  });

  for (const jobId of exhaustedIds) {
    // Each job is finalized in its OWN transaction (job + matching
    // report version + audit, all atomic together) — never batched
    // across jobs, per execution control #8.
    await finalizeExhaustedStaleJob(jobId, {
      leaseTimeoutSeconds: config.leaseTimeoutSeconds,
      maxAttempts: config.maxAttempts,
    });
  }
}

/** Claims the single next claimable job, in its own short transaction. Returns null if none is claimable right now. */
async function claimJob(workerId: string, config: ReportWorkerConfig): Promise<ReportJobRecord | null> {
  return withTransaction((client) => claimNextJob(client, workerId, config.maxAttempts));
}

/**
 * Processes one already-claimed job end-to-end: renders, stores, and
 * commits (or requeues/terminally-fails). See file header for the exact
 * ordering and crash-consistency guarantees.
 */
async function processClaimedJob(
  job: ReportJobRecord,
  workerId: string,
  config: ReportWorkerConfig
): Promise<ProcessOneCycleResult> {
  const context = await getReportGenerationContext(job.reportId);
  if (!context) {
    // Report row vanished (should be unreachable — reports.id has an
    // ON DELETE CASCADE from report_generation_jobs, meaning this job
    // row would already be gone too — defensive handling only).
    await withTransaction((client) =>
      failOrRequeueJob(
        {
          jobId: job.id,
          workerId,
          attemptCount: job.attemptCount,
          maxAttempts: config.maxAttempts,
          backoffBaseSeconds: config.backoffBaseSeconds,
          sanitizedError: 'The report record could not be found during generation.',
        },
        client
      )
    );
    return { outcome: 'terminally-failed', reportId: job.reportId };
  }

  // Heartbeat while rendering/storing — refreshes locked_at on an
  // interval strictly shorter than the lease timeout (validated at boot
  // by assertReportWorkerConfigSafe()), so a genuinely-alive worker's
  // lease is never mistakenly reclaimed mid-render.
  const heartbeatHandle = setInterval(() => {
    void heartbeatJob(job.id, workerId);
  }, config.heartbeatIntervalSeconds * 1000);

  try {
    const rendered = await renderReport({
      templateKey: context.templateKey,
      assetId: context.assetId,
      workspaceId: context.workspaceId,
      format: context.format,
      meta: {
        reportName: context.name,
        version: job.reportVersion,
        generatedAt: new Date().toISOString(),
      },
    });

    if (rendered.outcome !== 'ok') {
      const sanitizedReason =
        rendered.outcome === 'portfolio-too-large'
          ? 'Workspace portfolio exceeds the supported report size for this release.'
          : 'The requested report data could not be found or is not supported.';
      return await handleGenerationFailure(job, workerId, config, sanitizedReason);
    }

    const store = getReportArtifactStore();
    const key = buildReportArtifactKey(context.id, job.reportVersion, context.format);

    let writeResult: { sha256: string; sizeBytes: number };
    try {
      writeResult = await store.write({ key, bytes: rendered.bytes, maxBytes: config.maxArtifactBytes });
    } catch {
      return await handleGenerationFailure(job, workerId, config, sanitizeUnknownError());
    }

    try {
      await withTransaction(async (client) => {
        const completed = await completeReportGeneration(client, {
          reportId: context.id,
          expectedVersion: job.reportVersion,
          retentionSeconds: config.retentionSeconds,
        });
        if (!completed) throw new LeaseLostError();

        await createReportArtifact(
          {
            reportId: context.id,
            reportVersion: job.reportVersion,
            storageKey: key,
            filename: `artifact.${context.format}`,
            contentType: rendered.contentType,
            sizeBytes: writeResult.sizeBytes,
            sha256: writeResult.sha256,
          },
          client
        );

        const jobCompleted = await completeJob(job.id, workerId, client);
        if (!jobCompleted) throw new LeaseLostError();

        await recordActivity(
          {
            workspaceId: completed.workspaceId,
            actorUserId: null,
            actorDisplayName: 'Phoenix System',
            type: 'ReportGenerated',
            summary: `Generated report "${context.name}" (v${job.reportVersion}).`,
            relatedEntityType: 'Report',
            relatedEntityId: context.id,
          },
          client
        );

        await recordAudit(
          {
            workspaceId: completed.workspaceId,
            actorUserId: null,
            action: 'report.generated',
            entityType: 'Report',
            entityId: context.id,
            changes: { status: ['Generating', 'Available'] },
          },
          client
        );
      });
    } catch (err) {
      // Fenced write lost the race (lease reclaimed, or report changed
      // concurrently) — the transaction rolled back automatically
      // (withTransaction's own ROLLBACK-on-throw), so nothing above
      // committed. Delete the artifact bytes already written to disk —
      // never a silent orphan file, never a report marked Available
      // before this transaction actually committed.
      await store.delete(key).catch(() => undefined);
      if (err instanceof LeaseLostError) {
        return { outcome: 'lease-lost', reportId: context.id };
      }
      throw err;
    }

    return { outcome: 'completed', reportId: context.id };
  } finally {
    clearInterval(heartbeatHandle);
  }
}

/** Shared failure-path handling for both a typed render-outcome failure and a store-write failure. */
async function handleGenerationFailure(
  job: ReportJobRecord,
  workerId: string,
  config: ReportWorkerConfig,
  sanitizedReason: string
): Promise<ProcessOneCycleResult> {
  return withTransaction(async (client) => {
    const outcome = await failOrRequeueJob(
      {
        jobId: job.id,
        workerId,
        attemptCount: job.attemptCount,
        maxAttempts: config.maxAttempts,
        backoffBaseSeconds: config.backoffBaseSeconds,
        sanitizedError: sanitizedReason,
      },
      client
    );

    if (outcome === 'lease-lost') {
      return { outcome: 'lease-lost', reportId: job.reportId };
    }

    if (outcome === 'requeued') {
      // Report stays 'Generating' — no report-row change, no audit
      // (the job will be retried automatically).
      return { outcome: 'requeued', reportId: job.reportId };
    }

    // outcome === 'terminally-failed' — fenced report transition + audit
    // in the SAME transaction as the job's terminal-Failed write above.
    const failed = await failReportGeneration(client, {
      reportId: job.reportId,
      expectedVersion: job.reportVersion,
      sanitizedReason,
    });

    if (failed) {
      await recordAudit(
        {
          workspaceId: failed.workspaceId,
          actorUserId: null,
          action: 'report.generation.failed',
          entityType: 'Report',
          entityId: job.reportId,
          changes: { status: ['Generating', 'Failed'] },
        },
        client
      );
    }
    // If `failed` is null, the report already changed concurrently —
    // the job is still correctly marked Failed above; no false audit
    // row is written for a report transition that did not happen.

    return { outcome: 'terminally-failed', reportId: job.reportId };
  });
}

/**
 * Runs one full cycle: lease sweep, then claim-and-process at most one
 * job. Returns 'idle' if nothing was claimable. This is the function
 * both the continuous worker loop and the once/batch CLI call.
 */
export async function processOneCycle(workerId: string, config: ReportWorkerConfig = getReportWorkerConfig()): Promise<ProcessOneCycleResult> {
  await runLeaseSweep(config);

  const job = await claimJob(workerId, config);
  if (!job) return { outcome: 'idle' };

  return processClaimedJob(job, workerId, config);
}

/** A fresh process-unique worker id — see config/report-worker-env.ts's assertReportWorkerConfigSafe() for the invariants this worker's config must satisfy before this id is ever used. */
export function generateWorkerId(): string {
  return randomUUID();
}
