// ============================================================
// Intake database client -- server-only
// PHX-LAUNCH-001 (R2: PHX-LAUNCH-001-R2 §1)
// ------------------------------------------------------------
// Thin wrapper around a lazily-created `pg.Pool`, matching
// apps/backend/src/db/client.ts's established convention: no Pool is
// constructed at import time, so `next build` and every static/type
// gate succeed with zero database configuration present. Raw,
// parameterized SQL only -- no ORM, matching this repo's standing
// convention for every other data-access module.
//
// R2: the R1 `withAdvisoryLock` helper (a session-scoped
// `pg_advisory_lock` held across the external Turnstile call) has
// been REMOVED entirely. It required a persistent session-mode
// database connection, which Supabase's transaction-mode connection
// pooler -- the normally-recommended mode for serverless traffic,
// and the target for this app's Vercel runtime -- does not
// guarantee: a pooler may hand different physical connections to
// different statements within what the application believes is one
// "session", silently breaking a session-scoped lock. It also caused
// a real, reproduced pool self-deadlock under concurrency (see the
// R1 Implementation Report). Idempotency safety is now implemented
// entirely through short, independent statements/transactions against
// a genuinely UNIQUE column (see
// repositories/idempotency-keys.repository.ts) -- no advisory lock,
// no held connection, no code path that spans an external network
// call while holding a connection at all.
// ============================================================

import { Pool, types, type QueryResultRow } from 'pg';
import { serverConfig } from './config';

// R1 bug fix (still required): node-postgres returns BIGINT (OID 20)
// columns as JS strings by default, to avoid silent precision loss
// for values that could exceed Number.MAX_SAFE_INTEGER. Every BIGINT
// column in this schema (declared_size_bytes, verified_size_bytes,
// max_file_size_bytes, max_total_size_bytes) is a byte count bounded
// well under 100MB, nowhere close to that limit, so parsing them as
// JS numbers is safe -- and necessary, since upload-flow.service.ts
// does strict `===` comparisons between provider-recorded sizes
// (numbers) and these declared/verified sizes.
types.setTypeParser(20, (value: string) => parseInt(value, 10));

let pool: Pool | undefined;
let poolMaxOverride: number | undefined;

function isLocalConnection(connectionString: string): boolean {
  return /localhost|127\.0\.0\.1/.test(connectionString);
}

export function getIntakePool(): Pool {
  if (!pool) {
    const connectionString = serverConfig.databaseUrl;
    pool = new Pool({
      connectionString,
      // Hosted Supabase Postgres requires TLS; local/isolated
      // PostgreSQL used for local verification does not present a
      // valid chain, so only require (not verify) locally.
      ssl: isLocalConnection(connectionString) ? undefined : { rejectUnauthorized: true },
      // R2: no operation in this module ever holds a connection open
      // across an external network call anymore (see header comment),
      // so this pool size is a normal serverless-function concurrency
      // setting, not a deadlock-avoidance workaround -- R2's own QA
      // (gate-idempotency-r2.qa.ts) deliberately runs the ENTIRE
      // 20+-way concurrency proof against a pool forced down to 3-5
      // connections, specifically to demonstrate that a small pool no
      // longer causes a self-deadlock.
      max: poolMaxOverride ?? 10,
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

/** Shape of the transaction-scoped query function passed into withIntakeTransaction's callback. */
export type TransactionQuery = <R extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]) => Promise<R[]>;

/**
 * Runs `fn` inside a single short-lived client/transaction,
 * committing on success and rolling back on any error. The client is
 * checked out from the pool immediately before BEGIN and released
 * immediately after COMMIT/ROLLBACK -- callers must never await an
 * external network call (Turnstile, Resend, Supabase Storage,
 * Sentry, or anything else) from inside `fn`, since that would hold
 * a pooled connection open for the duration of that call. Every R2
 * caller of this function follows that rule; see submit.service.ts
 * and upload-flow.service.ts for the short-transaction-then-release
 * pattern this enables.
 */
export async function withIntakeTransaction<T>(fn: (query: TransactionQuery) => Promise<T>): Promise<T> {
  const client = await getIntakePool().connect();
  try {
    await client.query('BEGIN');
    const scopedQuery: TransactionQuery = async <R extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []) => {
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

/**
 * Test-only: allows QA scripts to reset the shared pool between
 * isolated test runs, optionally forcing a specific (small) pool max
 * for the NEXT getIntakePool() call -- used by R2's deadlock QA to
 * prove correctness under a deliberately saturated pool.
 */
export function __resetIntakePoolForTests(maxOverride?: number): void {
  pool = undefined;
  poolMaxOverride = maxOverride;
}
