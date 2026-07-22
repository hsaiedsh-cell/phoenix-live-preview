// ============================================================
// Phoenix Backend — Seed Runner
// PHX-BACKEND-003 — Read-Only Workspace & Assessment Endpoints
// ------------------------------------------------------------
// Minimal raw-SQL dev seed runner. Loads db/seeds/0001_dev_seed.sql and
// executes it inside a single transaction. This is a manual CLI command
// only — it is never invoked from src/index.ts, src/server.ts, or any
// request path, and the backend boots and serves /health regardless of
// whether seed data has been loaded.
//
// Idempotency: every INSERT in the seed file uses deterministic UUIDs
// and ON CONFLICT (id) DO NOTHING, so re-running this command after a
// prior successful (or partially failed, pre-migration-safe) run is
// safe and simply reports 0 newly-affected rows for records that
// already exist.
//
// Usage:
//   DATABASE_URL=... PHOENIX_ENABLE_DATABASE=true pnpm db:seed:dev
// ============================================================

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { closeDatabasePool, getDatabasePool, isDatabaseConfigured } from './client';

const SEEDS_DIR = join(__dirname, '..', '..', 'db', 'seeds');
const SEED_FILE = '0001_dev_seed.sql';

function log(message: string): void {
  // eslint-disable-next-line no-console
  console.log(`[phoenix-backend:seed] ${message}`);
}

function logError(message: string): void {
  // eslint-disable-next-line no-console
  console.error(`[phoenix-backend:seed] ${message}`);
}

/** Safe summary counts only — never logs row contents (emails, names, etc). */
async function logSummary(pool: ReturnType<typeof getDatabasePool>): Promise<void> {
  const tables = [
    'organizations',
    'departments',
    'workspaces',
    'users',
    'workspace_users',
    'assets',
    'asset_versions',
    'assessments',
    'assessment_steps',
    'evidence_items',
    'pbrs_scores',
    'pbrs_dimension_scores',
    'derived_signals',
    'pbrs_passports',
    'activity_logs',
    'audit_records',
  ];

  for (const table of tables) {
    const result = await pool.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM ${table}`);
    log(`  ${table}: ${result.rows[0]?.count ?? '0'} row(s)`);
  }
}

export async function runSeed(): Promise<void> {
  if (!isDatabaseConfigured()) {
    throw new Error(
      'Database is not enabled/configured. Set PHOENIX_ENABLE_DATABASE=true and DATABASE_URL, then re-run this command. ' +
        'The seed runner refuses to silently no-op when the database is unconfigured.'
    );
  }

  const fullPath = join(SEEDS_DIR, SEED_FILE);
  let sql: string;
  try {
    sql = readFileSync(fullPath, 'utf8');
  } catch (err) {
    throw new Error(
      `Could not read seed file at ${fullPath}: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const pool = getDatabasePool();
  const client = await pool.connect();

  try {
    log(`Running ${SEED_FILE} (idempotent — safe to re-run)...`);
    // The seed file itself wraps its statements in BEGIN/COMMIT, so this
    // is executed as a single multi-statement query rather than via the
    // migration runner's per-file transaction wrapper.
    await client.query(sql);
    log('Seed applied (or already present).');
  } catch (err) {
    throw new Error(`Seed ${SEED_FILE} failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    client.release();
  }

  log('Seed summary (row counts only — no seed data content logged):');
  await logSummary(pool);
}

async function main(): Promise<void> {
  try {
    await runSeed();
    await closeDatabasePool();
    process.exit(0);
  } catch (err) {
    logError(err instanceof Error ? err.message : String(err));
    await closeDatabasePool().catch(() => undefined);
    process.exit(1);
  }
}

// Only run when invoked directly as a CLI (db:seed / db:seed:dev), not
// when imported.
if (require.main === module) {
  void main();
}
