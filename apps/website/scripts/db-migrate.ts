// ============================================================
// Phoenix Website — Intake Migration Runner
// PHX-LAUNCH-001
// ------------------------------------------------------------
// Applies every *.sql file in db/migrations, in filename order,
// tracked by filename + sha256 checksum in an
// intake_schema_migrations table (a distinct name from the backend's
// own schema_migrations table, since this targets a different
// database — Supabase Postgres for public intake — never the
// backend's local PostgreSQL).
//
// Manual CLI only. Never invoked at Next.js build or boot time.
//
// Usage:
//   INTAKE_DATABASE_URL=postgres://... npx tsx scripts/db-migrate.ts
// ============================================================

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';

const MIGRATIONS_DIR = join(__dirname, '..', 'db', 'migrations');

function log(message: string): void {
  // eslint-disable-next-line no-console
  console.log(`[phoenix-website:db-migrate] ${message}`);
}

function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

interface MigrationFile {
  filename: string;
  sql: string;
  checksum: string;
}

function loadMigrationFiles(): MigrationFile[] {
  const entries = readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith('.sql'));
  entries.sort();
  return entries.map((filename) => {
    const sql = readFileSync(join(MIGRATIONS_DIR, filename), 'utf8');
    return { filename, sql, checksum: sha256(sql) };
  });
}

async function main(): Promise<void> {
  const connectionString = process.env.INTAKE_DATABASE_URL;
  if (!connectionString) {
    log('INTAKE_DATABASE_URL is not set. Refusing to run.');
    process.exitCode = 1;
    return;
  }

  const isLocal = /localhost|127\.0\.0\.1/.test(connectionString);
  const pool = new Pool({
    connectionString,
    ssl: isLocal ? undefined : { rejectUnauthorized: true },
  });

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS intake_schema_migrations (
        filename    TEXT PRIMARY KEY,
        checksum    TEXT NOT NULL,
        applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const files = loadMigrationFiles();
    const appliedRows = await pool.query<{ filename: string; checksum: string }>(
      'SELECT filename, checksum FROM intake_schema_migrations'
    );
    const applied = new Map(appliedRows.rows.map((row) => [row.filename, row.checksum]));

    for (const file of files) {
      const existingChecksum = applied.get(file.filename);
      if (existingChecksum) {
        if (existingChecksum !== file.checksum) {
          throw new Error(
            `Checksum mismatch for already-applied migration ${file.filename}. Refusing to continue.`
          );
        }
        log(`skip (already applied): ${file.filename}`);
        continue;
      }

      log(`applying: ${file.filename}`);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(file.sql);
        await client.query(
          'INSERT INTO intake_schema_migrations (filename, checksum) VALUES ($1, $2)',
          [file.filename, file.checksum]
        );
        await client.query('COMMIT');
        log(`applied: ${file.filename}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }

    log('done.');
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('[phoenix-website:db-migrate] failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
