// ============================================================
// Phoenix Backend — Database Client
// PHX-BACKEND-002 — Local PostgreSQL + Migration Execution
// ------------------------------------------------------------
// Thin wrapper around a lazily-created `pg.Pool`. The backend must be
// able to boot with no DATABASE_URL and with PHOENIX_ENABLE_DATABASE
// unset/false — nothing in this module runs at import time. A Pool is
// only constructed the first time getDatabasePool() is actually called,
// and only when the database is both enabled and configured.
//
// This module never logs DATABASE_URL or any other credential. Callers
// that need to report status to a client (e.g. the readiness route)
// should use checkDatabaseConnection(), which returns a structured,
// credential-free DatabaseHealth.
// ============================================================

import { Pool } from 'pg';
import { getBackendEnv } from '../config/env';

export type DatabaseStatus = 'disabled' | 'not_configured' | 'connected' | 'connection_failed';

export interface DatabaseHealth {
  enabled: boolean;
  configured: boolean;
  status: DatabaseStatus;
  message?: string;
}

export interface DatabaseConfig {
  enabled: boolean;
  configured: boolean;
  connectionString: string | undefined;
}

let pool: Pool | undefined;
let poolConnectionString: string | undefined;

/**
 * Resolves whether the database is enabled/configured without opening
 * any connection. Safe to call at any time.
 */
export function getDatabaseConfig(): DatabaseConfig {
  const env = getBackendEnv();
  return {
    enabled: env.databaseEnabled,
    configured: Boolean(env.databaseUrl),
    connectionString: env.databaseUrl,
  };
}

/** True only when PHOENIX_ENABLE_DATABASE=true AND DATABASE_URL is set. */
export function isDatabaseConfigured(): boolean {
  const config = getDatabaseConfig();
  return config.enabled && config.configured;
}

/**
 * Lazily creates (once) and returns the shared pg.Pool. Throws if the
 * database is not enabled/configured — callers must check
 * isDatabaseConfigured() (or handle the thrown error) before calling
 * this. Never called at module import time anywhere in this backend.
 */
export function getDatabasePool(): Pool {
  const config = getDatabaseConfig();

  if (!config.enabled || !config.connectionString) {
    throw new Error(
      'Database is not enabled/configured. Set PHOENIX_ENABLE_DATABASE=true and DATABASE_URL before calling getDatabasePool().'
    );
  }

  // Rebuild the pool if the connection string changed since it was last
  // created (mainly relevant for tests / repeated CLI invocations within
  // the same process).
  if (pool && poolConnectionString !== config.connectionString) {
    // Fire-and-forget close of the stale pool; callers awaiting the new
    // pool do not need to wait on this.
    void pool.end().catch(() => undefined);
    pool = undefined;
  }

  if (!pool) {
    pool = new Pool({ connectionString: config.connectionString });
    poolConnectionString = config.connectionString;
  }

  return pool;
}

/** Closes the shared pool, if one was created. Safe to call multiple times. */
export async function closeDatabasePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
    poolConnectionString = undefined;
  }
}

/**
 * Reports database health without ever throwing and without ever
 * exposing credentials. Intended for the readiness route and for CLI
 * tooling (migrate.ts, smoke.ts).
 */
export async function checkDatabaseConnection(): Promise<DatabaseHealth> {
  const config = getDatabaseConfig();

  if (!config.enabled) {
    return { enabled: false, configured: config.configured, status: 'disabled' };
  }

  if (!config.connectionString) {
    return { enabled: true, configured: false, status: 'not_configured' };
  }

  try {
    const activePool = getDatabasePool();
    await activePool.query('SELECT 1');
    return { enabled: true, configured: true, status: 'connected' };
  } catch (err) {
    return {
      enabled: true,
      configured: true,
      status: 'connection_failed',
      // Safe to include — pg error messages describe connection failure
      // reasons (e.g. "connection refused") and never echo the
      // connection string itself.
      message: err instanceof Error ? err.message : 'Unknown database connection error.',
    };
  }
}
