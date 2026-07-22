// ============================================================
// Phoenix Backend — Migration Runner
// PHX-BACKEND-002 — Local PostgreSQL + Migration Execution
// ------------------------------------------------------------
// Minimal raw-SQL migration runner. Applies every *.sql file in
// db/migrations, in filename order, tracked by filename + sha256
// checksum in a schema_migrations table. Each migration runs inside its
// own transaction. This is a manual CLI command only — it is never
// invoked from src/index.ts or src/server.ts, and the backend boots and
// serves /health regardless of whether migrations have been run.
//
// Usage:
//   DATABASE_URL=... PHOENIX_ENABLE_DATABASE=true pnpm db:migrate:dev
// ============================================================

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PoolClient } from 'pg';
import { getDatabasePool, isDatabaseConfigured, closeDatabasePool } from './client';

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'db', 'migrations');

interface MigrationFile {
  filename: string;
  fullPath: string;
  sql: string;
  checksum: string;
}

function log(message: string): void {
  // eslint-disable-next-line no-console
  console.log(`[phoenix-backend:migrate] ${message}`);
}

function logError(message: string): void {
  // eslint-disable-next-line no-console
  console.error(`[phoenix-backend:migrate] ${message}`);
}

function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function loadMigrationFiles(): MigrationFile[] {
  let entries: string[];
  try {
    entries = readdirSync(MIGRATIONS_DIR);
  } catch (err) {
    throw new Error(
      `Could not read migrations directory at ${MIGRATIONS_DIR}: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }

  return entries
    .filter((name) => name.toLowerCase().endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b))
    .map((filename) => {
      const fullPath = join(MIGRATIONS_DIR, filename);
      const sql = readFileSync(fullPath, 'utf8');
      return { filename, fullPath, sql, checksum: sha256(sql) };
    });
}

async function ensureMigrationsTable(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id          SERIAL PRIMARY KEY,
      filename    TEXT NOT NULL UNIQUE,
      checksum    TEXT NOT NULL,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

async function getAppliedMigrations(client: PoolClient): Promise<Map<string, string>> {
  const result = await client.query<{ filename: string; checksum: string }>(
    'SELECT filename, checksum FROM schema_migrations'
  );
  const applied = new Map<string, string>();
  for (const row of result.rows) {
    applied.set(row.filename, row.checksum);
  }
  return applied;
}

async function applyMigration(client: PoolClient, migration: MigrationFile): Promise<void> {
  log(`Applying migration ${migration.filename}`);
  try {
    await client.query('BEGIN');
    await client.query(migration.sql);
    await client.query(
      'INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)',
      [migration.filename, migration.checksum]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw new Error(
      `Migration ${migration.filename} failed and was rolled back: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
}

export async function runMigrations(): Promise<void> {
  if (!isDatabaseConfigured()) {
    throw new Error(
      'Database is not enabled/configured. Set PHOENIX_ENABLE_DATABASE=true and DATABASE_URL, then re-run this command. ' +
        'The migration runner refuses to silently no-op when the database is unconfigured.'
    );
  }

  const migrations = loadMigrationFiles();
  if (migrations.length === 0) {
    log('No .sql migration files found. Nothing to do.');
    return;
  }

  const pool = getDatabasePool();
  const client = await pool.connect();

  try {
    await ensureMigrationsTable(client);
    const applied = await getAppliedMigrations(client);

    let appliedCount = 0;
    let skippedCount = 0;

    for (const migration of migrations) {
      const existingChecksum = applied.get(migration.filename);

      if (existingChecksum !== undefined) {
        if (existingChecksum !== migration.checksum) {
          throw new Error(
            `Checksum mismatch for already-applied migration ${migration.filename}. ` +
              'The file content has changed since it was applied. Migrations must never be edited after being applied — ' +
              'create a new migration file instead.'
          );
        }
        log(`Skipping already applied migration ${migration.filename}`);
        skippedCount += 1;
        continue;
      }

      await applyMigration(client, migration);
      appliedCount += 1;
    }

    log(`Migration complete (${appliedCount} applied, ${skippedCount} already applied/skipped).`);
  } finally {
    client.release();
  }
}

async function main(): Promise<void> {
  try {
    await runMigrations();
    await closeDatabasePool();
    process.exit(0);
  } catch (err) {
    logError(err instanceof Error ? err.message : String(err));
    await closeDatabasePool().catch(() => undefined);
    process.exit(1);
  }
}

// Only run when invoked directly as a CLI (db:migrate / db:migrate:dev),
// not when imported (e.g. by tests).
if (require.main === module) {
  void main();
}
