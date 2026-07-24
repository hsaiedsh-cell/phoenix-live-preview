// ============================================================
// Intake database client — server-only
// PHX-LAUNCH-001
// ------------------------------------------------------------
// Thin wrapper around a lazily-created `pg.Pool`, matching
// apps/backend/src/db/client.ts's established convention: no Pool is
// constructed at import time, so `next build` and every static/type
// gate succeed with zero database configuration present. Raw,
// parameterized SQL only — no ORM, matching this repo's standing
// convention for every other data-access module.
// ============================================================

import { Pool, type QueryResultRow } from 'pg';
import { serverConfig } from './config';

let pool: Pool | undefined;

function isLocalConnection(connectionString: string): boolean {
  return /localhost|127\.0\.0\.1/.test(connectionString);
}

export function getIntakePool(): Pool {
  if (!pool) {
    const connectionString = serverConfig.databaseUrl;
    pool = new Pool({
      connectionString,
      // Hosted Supabase Postgres requires TLS; local/isolated
      // PostgreSQL used for Gate 3 verification does not present a
      // valid chain, so only require (not verify) locally.
      ssl: isLocalConnection(connectionString) ? undefined : { rejectUnauthorized: true },
      max: 5,
    });
  }
  return pool;
}

export async function intakeQuery<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<T[]> {
  const result = await getIntakePool().query<T>(text, params);
  return result.rows;
}

/** Runs `fn` inside a single client/transaction, committing on success and rolling back on any error. */
export async function withIntakeTransaction<T>(
  fn: (query: <R extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]) => Promise<R[]>) => Promise<T>
): Promise<T> {
  const client = await getIntakePool().connect();
  try {
    await client.query('BEGIN');
    const scopedQuery = async <R extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []) => {
      const result = await client.query<R>(text, params);
      return result.rows;
    };
    const value = await fn(scopedQuery);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** Test-only: allows QA scripts to reset the shared pool between isolated test runs. */
export function __resetIntakePoolForTests(): void {
  pool = undefined;
}
