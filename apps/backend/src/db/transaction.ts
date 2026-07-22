// ============================================================
// Phoenix Backend — Transaction Helper
// PHX-BACKEND-007 — Ownership Enforcement & Audit Logging Foundation
// ------------------------------------------------------------
// Small, generic BEGIN/COMMIT/ROLLBACK wrapper, factored out of the
// hand-written transaction block already present in
// repositories/assessments.repository.ts's submitAssessment() (that
// function is left as-is — see its own file header — this helper is
// for the NEW transactional call sites this sprint adds: create
// assessment + activity + audit, submit assessment + activity + audit,
// add/update/delete evidence + activity + audit).
//
// No ORM — this is a ~15-line wrapper around `pg`'s PoolClient, not a
// query builder or migration tool. Every repository function called
// inside `fn` must accept the same `client` this helper hands it
// (rather than calling getDatabasePool() itself) so all statements run
// on the SAME connection inside the SAME transaction — see
// repositories/assessments.repository.ts / evidence.repository.ts /
// activity.repository.ts / audit.repository.ts, every write function
// in which now takes an optional trailing `client?: PoolClient`
// parameter (falling back to a fresh pool.query() call when omitted,
// which preserves every pre-existing non-transactional call site and
// unit-test-style direct call).
// ============================================================

import type { PoolClient } from 'pg';
import { getDatabasePool } from './client';

/**
 * Runs `fn` inside a single BEGIN/COMMIT transaction on one borrowed
 * PoolClient, passing that client to `fn` so every statement `fn`
 * issues (directly or via repository functions that accept a `client`
 * parameter) participates in the same transaction. Rolls back and
 * rethrows on any error; always releases the client back to the pool.
 */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const pool = getDatabasePool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
