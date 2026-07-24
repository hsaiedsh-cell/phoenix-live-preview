// ============================================================
// Phoenix Backend — Entry Point
// PHX-BACKEND-001 — Backend Foundation & Database Skeleton
// PHX-BACKEND-009 — Production Auth Preparation
// ------------------------------------------------------------
// Starts the HTTP server. Boots without DATABASE_URL, without any auth
// secret, and without any paid/hosted service. See
// docs/backend/PHX_BACKEND_001_IMPLEMENTATION_REPORT.md for the full
// contract.
//
// ---- PHX-BACKEND-009: production auth-mode guard ----------------------
// assertAuthModeSafeToBoot() (see src/config/env.ts) is called once,
// here, before the server starts listening — the one place this
// backend deliberately fails fast. getBackendEnv() itself still never
// throws (see that file's header); this is a separate, explicit check
// so a production boot with PHOENIX_AUTH_MODE=dev-header still
// selected exits immediately with a clear message instead of quietly
// trusting a caller-supplied header in production.
//
// ---- PHX-REPORTS-004: report-worker configuration guard ---------------
// assertReportWorkerConfigSafe() (see src/config/report-worker-env.ts)
// is called the same way, immediately after the auth-mode check — an
// unsafe worker/storage configuration (e.g. heartbeat >= lease timeout,
// reconciliation grace <= lease timeout, maxAttempts < 1,
// backoffBaseSeconds <= 0) aborts startup with a specific error naming
// which invariant failed, exactly like the auth-mode guard above.
// getReportWorkerConfig() itself never throws (same "resolution never
// throws" contract as getBackendEnv()); this explicit assertion is the
// one place that can. The continuous worker
// (workers/report-generation-worker.ts) and the once/batch CLI
// (workers/report-worker-once.ts) already call this same function
// themselves at their own startup — this addition ensures the API
// server enforces the identical guarantee, since the server also reads
// this configuration (e.g. the download endpoint's
// REPORT_MAX_ARTIFACT_BYTES bound) even though it is not itself a
// worker process.
// ============================================================

import { createServer } from './server';
import { assertAuthModeSafeToBoot, getBackendEnv } from './config/env';
import { assertReportWorkerConfigSafe, getReportWorkerConfig } from './config/report-worker-env';

const env = getBackendEnv();

try {
  assertAuthModeSafeToBoot(env);
} catch (err) {
  // eslint-disable-next-line no-console
  console.error(
    `[phoenix-backend] Startup aborted — unsafe auth mode for this environment:\n` +
      `  ${err instanceof Error ? err.message : String(err)}`
  );
  process.exit(1);
}

try {
  assertReportWorkerConfigSafe(getReportWorkerConfig());
} catch (err) {
  // eslint-disable-next-line no-console
  console.error(
    `[phoenix-backend] Startup aborted — unsafe report-worker configuration:\n` +
      `  ${err instanceof Error ? err.message : String(err)}`
  );
  process.exit(1);
}

const app = createServer();

app.listen(env.port, () => {
  // eslint-disable-next-line no-console
  console.log(
    `[phoenix-backend] listening on port ${env.port} ` +
      `(nodeEnv=${env.nodeEnv}, apiVersion=${env.apiVersion}, ` +
      `database=${env.databaseEnabled ? 'enabled(unconnected)' : 'disabled'}, ` +
      `authMode=${env.authMode})`
  );
});
