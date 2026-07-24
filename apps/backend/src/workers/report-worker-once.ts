// ============================================================
// Phoenix Backend — Report Generation Worker (once/batch)
// PHX-REPORTS-004 — Report Generation Lifecycle & Secure Artifact
// Delivery Foundation
// ------------------------------------------------------------
// Deterministic CLI entry point for QA: runs the lease sweep, then
// claims and processes jobs one at a time until no more are claimable,
// then exits. No polling loop, no setInterval-based lifecycle — see
// task brief §4.3's "single-batch/once mode for deterministic QA".
//
// Usage:
//   DATABASE_URL=... PHOENIX_ENABLE_DATABASE=true pnpm db:worker:once:dev
// ============================================================

import { isDatabaseConfigured, closeDatabasePool } from '../db/client';
import { getReportWorkerConfig, assertReportWorkerConfigSafe } from '../config/report-worker-env';
import { processOneCycle, generateWorkerId } from '../services/report-generation.service';
import { runArtifactReconciliation } from './report-artifact-reconciliation';

function log(message: string): void {
  // eslint-disable-next-line no-console
  console.log(`[phoenix-backend:report-worker-once] ${message}`);
}

function logError(message: string): void {
  // eslint-disable-next-line no-console
  console.error(`[phoenix-backend:report-worker-once] ${message}`);
}

async function main(): Promise<void> {
  if (!isDatabaseConfigured()) {
    logError('Database is not enabled/configured. Set PHOENIX_ENABLE_DATABASE=true and DATABASE_URL, then re-run.');
    process.exitCode = 1;
    return;
  }

  const config = getReportWorkerConfig();
  assertReportWorkerConfigSafe(config);

  const workerId = generateWorkerId();
  log(`Starting once/batch run. workerId=${workerId}`);

  let processedCount = 0;
  const MAX_JOBS_PER_RUN = 200; // Safety bound — this CLI is for QA/deterministic runs, not an unbounded drain.

  for (let i = 0; i < MAX_JOBS_PER_RUN; i++) {
    const result = await processOneCycle(workerId, config);
    if (result.outcome === 'idle') break;
    processedCount += 1;
    log(`Processed job ${i + 1}: ${result.outcome} (report ${result.reportId})`);
  }

  log(`Done. Jobs processed this run: ${processedCount}.`);

  const summary = await runArtifactReconciliation();
  log(`Artifact reconciliation: scanned=${summary.scanned} deleted=${summary.deleted} retained=${summary.retainedNoMetadataButRecentOrLeased}`);

  await closeDatabasePool();
  process.exit(0);
}

if (require.main === module) {
  void main().catch((err) => {
    logError(err instanceof Error ? err.message : String(err));
    void closeDatabasePool().catch(() => undefined);
    process.exit(1);
  });
}
