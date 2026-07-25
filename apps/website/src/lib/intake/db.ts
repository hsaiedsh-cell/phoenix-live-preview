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

import { Pool, types, type QueryResultRow } from 'pg';
import { serverConfig } from './config';

// R1 bug fix: node-postgres returns BIGINT (OID 20) columns as JS
// strings by default, to avoid silent precision loss for values
// that could exceed Number.MAX_SAFE_INTEGER. Every BIGINT column in
// this schema (declared_size_bytes, verified_size_bytes,
// max_file_size_bytes, max_total_size_bytes) is a byte count bounded
// well under 100MB, nowhere close to that limit, so parsing them as
// JS numbers is safe -- and necessary, since upload-flow.service.ts
// does strict `===` comparisons between provider-observed sizes
// (numbers) and these declared/verified sizes. Without this, those
// comparisons silently and permanently failed (e.g. `1000 !== '1000'`),
// which is exactly the "first completion succeeds" failure caught by
// gate6-upload-r1.qa.ts during this sprint.
types.setTypeParser(20, (value: string) => parseInt(value, 10));

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
      // R1: withAdvisoryLock (below) holds ONE dedicated connection
      // for the full duration of a locked flow, including the
      // nested queries that flow makes through this SAME pool (rate
      // limiting, event recording). A burst of N truly concurrent
      // submissions sharing one idempotency key can therefore each
      // hold a connection blocked on the advisory lock while the
      // eventual lock-winner still needs a free connection for its
      // own nested queries -- with too small a pool this is a
      // self-deadlock, not just slowness. max is sized with headroom
      // above the realistic concurrent-duplicate-submission count
      // (a legitimate client only ever has one in-flight request per
      // key; this only matters for network-retry races, typically
      // 2-3 at once) rather than raised without bound.
      max: 15,
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

/** Runs `fn` inside a single client/transaction, committing on success and rolling back on any error. */
export async function withIntakeTransaction<T>(fn: (query: TransactionQuery) => Promise<T>): Promise<T> {
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

/**
 * R1 (§2.1/§2.2): checks out ONE dedicated client and holds a
 * session-scoped Postgres advisory lock (`pg_advisory_lock`, NOT the
 * transaction-scoped `pg_advisory_xact_lock`) for the duration of
 * `fn`. This is the standard Postgres primitive for serializing
 * concurrent callers across a sequence of statements that includes
 * an external network call in the middle (here: Turnstile
 * verification) — the lock is independent of any SQL transaction
 * boundary, so `fn` may open and commit its own short transactions
 * via `locked.transaction(...)` without ever holding a transaction
 * open while awaiting the external call. This is what makes
 * "concurrent same-idempotency-key submissions create exactly one
 * request row" true even though Turnstile verification must not run
 * inside a held DB transaction (PHX-LAUNCH-001-R1 §4.3).
 */
export interface LockedClient {
  /** A single statement against the locked client, outside any transaction. */
  query: TransactionQuery;
  /** Runs `txFn` inside BEGIN/COMMIT (or ROLLBACK on error) on the SAME locked client. */
  transaction: <T>(txFn: (query: TransactionQuery) => Promise<T>) => Promise<T>;
}

export async function withAdvisoryLock<T>(lockKeyText: string, fn: (locked: LockedClient) => Promise<T>): Promise<T> {
  const client = await getIntakePool().connect();
  try {
    await client.query('SELECT pg_advisory_lock(hashtext($1))', [lockKeyText]);
    try {
      const plainQuery: TransactionQuery = async <R extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []) => {
        const result = await client.query<R>(text, params);
        return result.rows;
      };
      const transaction = async <T2>(txFn: (query: TransactionQuery) => Promise<T2>): Promise<T2> => {
        await client.query('BEGIN');
        try {
          const scopedQuery: TransactionQuery = async <R extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []) => {
            const result = await client.query<R>(text, params);
            return result.rows;
          };
          const value = await txFn(scopedQuery);
          await client.query('COMMIT');
          return value;
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
      };
      return await fn({ query: plainQuery, transaction });
    } finally {
      // Always attempt to release the session lock, even if fn threw
      // — an unreleased advisory lock would otherwise deadlock every
      // future submission using the same idempotency key hash.
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', [lockKeyText]).catch(() => undefined);
    }
  } finally {
    client.release();
  }
}

/** Test-only: allows QA scripts to reset the shared pool between isolated test runs. */
export function __resetIntakePoolForTests(): void {
  pool = undefined;
}
