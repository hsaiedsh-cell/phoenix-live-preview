// ============================================================
// Phoenix Backend — Report Worker & Artifact Storage Environment Contract
// PHX-REPORTS-004 — Report Generation Lifecycle & Secure Artifact
// Delivery Foundation
// ------------------------------------------------------------
// Mirrors config/env.ts's contract exactly: resolving configuration
// here NEVER throws and never requires any of these vars to be set —
// every value has a safe, documented default (see .env.example). The
// one place this module is allowed to abort the process is
// assertReportWorkerConfigSafe(), a separate, explicitly-invoked
// function (called once by both the backend server and the worker
// process at startup, before either starts serving/polling) — same
// split as env.ts's getBackendEnv() (never throws) vs.
// assertAuthModeSafeToBoot() (throws, explicitly invoked).
//
// ---- Why these specific invariants are validated ----------------------
// See docs/reports/PHX_REPORTS_004_IMPLEMENTATION_REPORT.md for the full
// rationale; summarized at each check below. All four were required by
// ChatGPT architecture/QA review (Phase 1 Addendum B, item 2) as
// concrete boot-time guards against configurations that would silently
// break lease/lock safety rather than fail loudly.
// ============================================================

function readEnvVar(name: string): string | undefined {
  const value = process.env[name];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function readIntEnvVar(name: string, fallback: number): number {
  const raw = readEnvVar(name);
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) ? parsed : fallback;
}

export interface ReportWorkerConfig {
  /** Local filesystem directory the local artifact-store adapter writes under. Never committed to Git — see root .gitignore. */
  storageLocalDir: string;
  /** Byte-size cap enforced before an artifact is written or read. A renderer whose output exceeds this fails generation rather than being silently truncated. */
  maxArtifactBytes: number;
  /** Retention window: an Available report's expires_at is set to generatedAt + this many seconds. */
  retentionSeconds: number;
  /** Worker poll interval for the continuous dev loop. */
  pollIntervalSeconds: number;
  /** A Processing job whose locked_at is older than this is treated as abandoned by the lease-reclaim sweep. */
  leaseTimeoutSeconds: number;
  /** How often a worker actively holding a job refreshes locked_at while rendering. Must be < leaseTimeoutSeconds. */
  heartbeatIntervalSeconds: number;
  /** A file with no report_artifacts row and no valid Processing lease is eligible for reconciliation-delete only once older than this. Must be > leaseTimeoutSeconds. */
  reconciliationGraceSeconds: number;
  /** Maximum generation attempts before a job/report is marked terminally Failed. Must be >= 1. */
  maxAttempts: number;
  /** Bounded linear backoff base — requeue delay is attempt_count * this. Must be > 0. */
  backoffBaseSeconds: number;
  /** Hard cap on assets considered by the workspace-portfolio-summary template — see report-render-data.repository.ts. Exceeding this fails generation closed rather than silently truncating the portfolio. */
  portfolioMaxAssets: number;
}

/**
 * Resolves report-worker/artifact-storage configuration from env vars.
 * Never throws; every value has a safe, documented default (see
 * .env.example). Safe to call at any time, from any process (server or
 * worker) — same contract as config/env.ts's getBackendEnv().
 */
export function getReportWorkerConfig(): ReportWorkerConfig {
  return {
    storageLocalDir: readEnvVar('REPORT_STORAGE_LOCAL_DIR') ?? './storage',
    maxArtifactBytes: readIntEnvVar('REPORT_MAX_ARTIFACT_BYTES', 25 * 1024 * 1024), // 25MB
    retentionSeconds: readIntEnvVar('REPORT_RETENTION_SECONDS', 7 * 24 * 60 * 60), // 7 days
    pollIntervalSeconds: readIntEnvVar('REPORT_WORKER_POLL_INTERVAL_SECONDS', 5),
    leaseTimeoutSeconds: readIntEnvVar('REPORT_WORKER_LEASE_SECONDS', 120),
    heartbeatIntervalSeconds: readIntEnvVar('REPORT_WORKER_HEARTBEAT_SECONDS', 30),
    reconciliationGraceSeconds: readIntEnvVar('REPORT_ARTIFACT_RECONCILIATION_GRACE_SECONDS', 300),
    maxAttempts: readIntEnvVar('REPORT_WORKER_MAX_ATTEMPTS', 3),
    backoffBaseSeconds: readIntEnvVar('REPORT_WORKER_BACKOFF_BASE_SECONDS', 10),
    portfolioMaxAssets: readIntEnvVar('REPORT_PORTFOLIO_MAX_ASSETS', 500),
  };
}

/**
 * Throws a specific, actionable error if any of the four Phase 1
 * Addendum B invariants is violated:
 *   1. heartbeatIntervalSeconds < leaseTimeoutSeconds — a heartbeat that
 *      isn't strictly more frequent than the lease timeout could let a
 *      genuinely-alive worker's lease expire between heartbeats.
 *   2. reconciliationGraceSeconds > leaseTimeoutSeconds — a grace period
 *      that isn't longer than the lease timeout could let the artifact
 *      reconciliation sweep delete a file whose owning worker is still
 *      legitimately inside its lease window.
 *   3. maxAttempts >= 1 — zero/negative would mean no job could ever be
 *      attempted at all.
 *   4. backoffBaseSeconds > 0 — zero/negative would defeat the bounded
 *      backoff's purpose.
 * Never called from getReportWorkerConfig() itself (which must remain
 * non-throwing, per this module's header) — called once, explicitly, by
 * src/index.ts and the worker's entry point, before either starts
 * serving/polling. No invariant is silently clamped/corrected.
 */
export function assertReportWorkerConfigSafe(config: ReportWorkerConfig = getReportWorkerConfig()): void {
  const problems: string[] = [];

  if (!(config.heartbeatIntervalSeconds < config.leaseTimeoutSeconds)) {
    problems.push(
      `REPORT_WORKER_HEARTBEAT_SECONDS (${config.heartbeatIntervalSeconds}) must be strictly less than ` +
        `REPORT_WORKER_LEASE_SECONDS (${config.leaseTimeoutSeconds}), or a live worker's lease could expire between heartbeats.`
    );
  }

  if (!(config.reconciliationGraceSeconds > config.leaseTimeoutSeconds)) {
    problems.push(
      `REPORT_ARTIFACT_RECONCILIATION_GRACE_SECONDS (${config.reconciliationGraceSeconds}) must be strictly greater than ` +
        `REPORT_WORKER_LEASE_SECONDS (${config.leaseTimeoutSeconds}), or artifact reconciliation could race a live worker's ` +
        'in-flight generation attempt.'
    );
  }

  if (!(config.maxAttempts >= 1)) {
    problems.push(`REPORT_WORKER_MAX_ATTEMPTS (${config.maxAttempts}) must be >= 1.`);
  }

  if (!(config.backoffBaseSeconds > 0)) {
    problems.push(`REPORT_WORKER_BACKOFF_BASE_SECONDS (${config.backoffBaseSeconds}) must be > 0.`);
  }

  if (problems.length > 0) {
    throw new Error(
      'Unsafe report-worker configuration — refusing to start. ' +
        problems.join(' ') +
        ' See .env.example and docs/reports/PHX_REPORTS_004_IMPLEMENTATION_REPORT.md.'
    );
  }
}
