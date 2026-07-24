// ============================================================
// Phoenix Backend — Report Generation Worker (continuous)
// PHX-REPORTS-004 — Report Generation Lifecycle & Secure Artifact
// Delivery Foundation
// ------------------------------------------------------------
// Continuous development worker process. NOT started by src/index.ts —
// this is a separate, independently-runnable process (task brief §4.3:
// "no untracked in-process timer as the lifecycle mechanism" — this
// process itself uses a plain, visible poll loop, not a hidden timer
// tacked onto the API server). Run via `pnpm db:worker:dev` (see
// package.json).
//
// A process-unique workerId (crypto.randomUUID()) is generated once at
// startup — every fenced write this worker makes is scoped to this id
// for the lifetime of the process (Phase 1 Addendum A §3).
//
// assertReportWorkerConfigSafe() is called once, here, before the poll
// loop starts — an unsafe configuration (see config/report-worker-env.ts)
// aborts startup with a clear error rather than running with silently
// unsafe lease/lock timing.
// ============================================================

import { isDatabaseConfigured, closeDatabasePool } from '../db/client';
import { getReportWorkerConfig, assertReportWorkerConfigSafe } from '../config/report-worker-env';
import { processOneCycle, generateWorkerId } from '../services/report-generation.service';
import { runArtifactReconciliation } from './report-artifact-reconciliation';

function log(message: string): void {
  // eslint-disable-next-line no-console
  console.log(`[phoenix-backend:report-worker] ${message}`);
}

function logError(message: string): void {
  // eslint-disable-next-line no-console
  console.error(`[phoenix-backend:report-worker] ${message}`);
}

async function main(): Promise<void> {
  if (!isDatabaseConfigured()) {
    logError('Database is not enabled/configured. Set PHOENIX_ENABLE_DATABASE=true and DATABASE_URL, then re-run.');
    process.exitCode = 1;
    return;
  }

  const config = getReportWorkerConfig();
  assertReportWorkerConfigSafe(config); // Throws (aborts startup) on an unsafe configuration — see file header.

  const workerId = generateWorkerId();
  log(`Starting continuous report generation worker. workerId=${workerId}`);
  log(
    `Config: pollIntervalSeconds=${config.pollIntervalSeconds} leaseTimeoutSeconds=${config.leaseTimeoutSeconds} ` +
      `heartbeatIntervalSeconds=${config.heartbeatIntervalSeconds} reconciliationGraceSeconds=${config.reconciliationGraceSeconds} ` +
      `maxAttempts=${config.maxAttempts} backoffBaseSeconds=${config.backoffBaseSeconds}`
  );

  let shuttingDown = false;
  process.on('SIGINT', () => {
    log('Received SIGINT — finishing current cycle and shutting down.');
    shuttingDown = true;
  });
  process.on('SIGTERM', () => {
    log('Received SIGTERM — finishing current cycle and shutting down.');
    shuttingDown = true;
  });

  let cyclesSinceReconciliation = 0;
  const RECONCILE_EVERY_N_CYCLES = 12; // Roughly every ~1 minute at the default 5s poll interval — a background maintenance pass, not a hot path.

  while (!shuttingDown) {
    try {
      const result = await processOneCycle(workerId, config);
      if (result.outcome !== 'idle') {
        log(`Cycle result: ${result.outcome} (report ${result.reportId})`);
      }
    } catch (err) {
      logError(`Unhandled error during generation cycle: ${err instanceof Error ? err.message : String(err)}`);
    }

    cyclesSinceReconciliation += 1;
    if (cyclesSinceReconciliation >= RECONCILE_EVERY_N_CYCLES) {
      cyclesSinceReconciliation = 0;
      try {
        const summary = await runArtifactReconciliation();
        if (summary.deleted > 0 || summary.scanned > 0) {
          log(
            `Artifact reconciliation: scanned=${summary.scanned} deleted=${summary.deleted} ` +
              `retained=${summary.retainedNoMetadataButRecentOrLeased}`
          );
        }
      } catch (err) {
        logError(`Unhandled error during artifact reconciliation: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    await new Promise((resolve) => setTimeout(resolve, config.pollIntervalSeconds * 1000));
  }

  await closeDatabasePool();
  log('Worker shut down cleanly.');
}

if (require.main === module) {
  void main();
}
