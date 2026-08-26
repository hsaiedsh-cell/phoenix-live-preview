import { assertAuthModeSafeToBoot, getBackendEnv } from '../src/config/env';
import { assertReportWorkerConfigSafe, getReportWorkerConfig } from '../src/config/report-worker-env';
import { createServer } from '../src/server';

// Vercel imports this module instead of src/index.ts, so enforce the same
// fail-fast production guards before exporting the serverless Express app.
assertAuthModeSafeToBoot(getBackendEnv());
assertReportWorkerConfigSafe(getReportWorkerConfig());

export default createServer();
