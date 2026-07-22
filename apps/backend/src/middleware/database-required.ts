// ============================================================
// Phoenix Backend — Database Availability Guard
// PHX-BACKEND-003 — Read-Only Workspace & Assessment Endpoints
// ------------------------------------------------------------
// Route-level helper for business (non-health/readiness) endpoints that
// require a working database connection. Health (/health, /api/health)
// and readiness (/api/readiness) remain available with no database at
// all — this guard is never applied to those routes.
//
// Decision (documented in PHX_BACKEND_003_IMPLEMENTATION_REPORT.md):
// business endpoints return HTTP 503 with error code
// DATABASE_UNAVAILABLE when the database is disabled, unconfigured, or
// unreachable. This is intentionally different from /api/readiness,
// which always returns 200 with an `ok` flag in its body (Alpha
// behavior) — 503 is the correct signal for an endpoint that cannot
// serve its actual business response without a database.
//
// Never throws, never crashes the process, never exposes DATABASE_URL
// or any other credential.
// ============================================================

import type { Response } from 'express';
import { checkDatabaseConnection } from '../db/client';
import { ApiErrorCodes, failure } from '../contracts/api-response';
import { getRequestId } from '../lib/http';

// PHX-BACKEND-006: now sourced from the shared ApiErrorCodes map in
// contracts/api-response.ts (still re-exported under this name so
// existing imports of DATABASE_UNAVAILABLE_CODE keep working).
export const DATABASE_UNAVAILABLE_CODE = ApiErrorCodes.DATABASE_UNAVAILABLE;

/**
 * Checks database availability for a business endpoint. If the database
 * is disabled, unconfigured, or unreachable, writes a structured 503
 * ApiFailure to `res` and returns false — callers must return
 * immediately in that case. Returns true (writes nothing) when the
 * database is reachable.
 */
export async function requireDatabase(res: Response): Promise<boolean> {
  const health = await checkDatabaseConnection();

  if (health.status === 'connected') {
    return true;
  }

  const requestId = getRequestId(res);
  // Every non-"connected" status maps to the same client-facing message —
  // the specific reason (disabled/not_configured/connection_failed) is
  // still surfaced in `details.databaseStatus` below for debugging.
  const message = 'Database is not available for this endpoint.';

  res
    .status(503)
    .json(
      failure(
        DATABASE_UNAVAILABLE_CODE,
        message,
        requestId,
        // Safe, credential-free detail — the same status enum already
        // surfaced by /api/readiness.
        { databaseStatus: health.status }
      )
    );

  return false;
}
