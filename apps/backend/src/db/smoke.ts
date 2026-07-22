// ============================================================
// Phoenix Backend — Database Smoke Script
// PHX-BACKEND-002 — Local PostgreSQL + Migration Execution
// ------------------------------------------------------------
// Manual CLI check: verifies the database connects, confirms the
// schema_migrations table exists and reports how many migrations have
// been applied, and counts/list public tables. Never invoked at backend
// startup.
//
// Usage:
//   DATABASE_URL=... PHOENIX_ENABLE_DATABASE=true pnpm db:smoke:dev
// ============================================================

import { closeDatabasePool, getDatabasePool, isDatabaseConfigured } from './client';

function log(message: string): void {
  // eslint-disable-next-line no-console
  console.log(`[phoenix-backend:smoke] ${message}`);
}

function logError(message: string): void {
  // eslint-disable-next-line no-console
  console.error(`[phoenix-backend:smoke] ${message}`);
}

async function main(): Promise<void> {
  if (!isDatabaseConfigured()) {
    logError(
      'Database is not enabled/configured. Set PHOENIX_ENABLE_DATABASE=true and DATABASE_URL, then re-run this command.'
    );
    process.exitCode = 1;
    return;
  }

  const pool = getDatabasePool();

  try {
    await pool.query('SELECT 1');
    log('Database connected');

    const migrationsTableCheck = await pool.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'schema_migrations'
       ) AS exists`
    );

    if (migrationsTableCheck.rows[0]?.exists) {
      log('Migrations table found');
      const countResult = await pool.query<{ count: string }>(
        'SELECT COUNT(*)::text AS count FROM schema_migrations'
      );
      log(`Applied migrations: ${countResult.rows[0]?.count ?? '0'}`);
    } else {
      log('Migrations table NOT found (run pnpm db:migrate:dev first)');
    }

    const tablesResult = await pool.query<{ table_name: string }>(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public'
       ORDER BY table_name`
    );

    log(`Public tables: ${tablesResult.rows.length}`);
    const preview = tablesResult.rows.slice(0, 10).map((row) => row.table_name);
    if (preview.length > 0) {
      log(`First ${preview.length} table(s): ${preview.join(', ')}`);
    }
  } catch (err) {
    logError(`Smoke check failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  } finally {
    await closeDatabasePool();
  }
}

if (require.main === module) {
  void main();
}
