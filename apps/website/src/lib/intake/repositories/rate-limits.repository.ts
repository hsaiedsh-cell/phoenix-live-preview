// ============================================================
// public_intake_rate_limits repository
// PHX-LAUNCH-001
// ------------------------------------------------------------
// Fixed-window counters keyed by HMAC hash — never a raw IP or raw
// email (see ../hash.ts). One window per (limiter_key, window
// start); the window start is floored to the hour so a rolling
// count never needs a background sweep to reset itself.
// ============================================================

import { intakeQuery } from '../db';

export function currentWindowStart(now: Date = new Date()): Date {
  const floored = new Date(now);
  floored.setUTCMinutes(0, 0, 0);
  return floored;
}

export interface RateLimitCheckResult {
  count: number;
  limit: number;
  exceeded: boolean;
}

/**
 * Atomically increments the counter for `limiterKey` in the current
 * hour window and returns the resulting count. Uses
 * INSERT ... ON CONFLICT DO UPDATE against the
 * uq_rate_limits_key_window unique index, so concurrent requests
 * cannot race past the limit.
 */
export async function incrementAndCheck(limiterKey: string, limit: number, now: Date = new Date()): Promise<RateLimitCheckResult> {
  const windowStart = currentWindowStart(now);
  const rows = await intakeQuery<{ request_count: number }>(
    `INSERT INTO public_intake_rate_limits (limiter_key, window_started_at, request_count)
     VALUES ($1, $2, 1)
     ON CONFLICT (limiter_key, window_started_at)
     DO UPDATE SET request_count = public_intake_rate_limits.request_count + 1, updated_at = now()
     RETURNING request_count`,
    [limiterKey, windowStart]
  );
  const count = rows[0].request_count;
  return { count, limit, exceeded: count > limit };
}

/** Read-only check (no increment) — used to reason about a key without consuming a slot, e.g. in QA. */
export async function peekCount(limiterKey: string, now: Date = new Date()): Promise<number> {
  const windowStart = currentWindowStart(now);
  const rows = await intakeQuery<{ request_count: number }>(
    `SELECT request_count FROM public_intake_rate_limits WHERE limiter_key = $1 AND window_started_at = $2`,
    [limiterKey, windowStart]
  );
  return rows[0]?.request_count ?? 0;
}
