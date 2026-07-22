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
// ============================================================

import { createServer } from './server';
import { assertAuthModeSafeToBoot, getBackendEnv } from './config/env';

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
