// ============================================================
// Turnstile verification adapter
// PHX-LAUNCH-001 (R4: PHX-LAUNCH-001-R4 §7 -- hostname/action contract)
// ------------------------------------------------------------
// Uses native fetch only -- no SDK dependency added, per Gate 2's
// "do not add a dependency when native APIs are sufficient".
//
// Route handlers depend on the `TurnstileVerifier` interface, not on
// this concrete implementation, so QA can inject a deterministic
// test double instead of calling the real Cloudflare endpoint. This
// module's live adapter is the ONLY thing that talks to the real
// provider, and is never exercised without a real TURNSTILE_SECRET_KEY
// -- no live success is claimed by this codebase (PHX-LAUNCH-001-R4 §7,
// §9): the hostname/action checks below are implemented and
// unit-testable now, using environment-driven exact values, but
// proving them against a real Cloudflare Siteverify response remains
// a deployed-environment Go/No-Go item.
//
// R4 (§7): the Siteverify response's own `hostname` field is checked
// against an explicit, environment-driven allowlist
// (TURNSTILE_ALLOWED_HOSTNAMES), and its `action` field is checked
// against the expected action (TURNSTILE_EXPECTED_ACTION, default
// "public-intake") that the client widget is expected to supply.
// Either check failing is treated as `invalid_token` (a real,
// distinguishable rejection) -- never silently accepted, and never
// conflated with `provider_error` (a network/availability problem).
// Both checks are SKIPPED (not enforced) when their corresponding
// environment variable is unset, so this remains safe to run in any
// environment that hasn't configured them yet; before Private Beta
// Go, both must be configured (see the R4 Vercel Setup Guide).
// ============================================================

import { serverConfig } from '../config';

export interface TurnstileVerifier {
  verify(token: string, remoteIp?: string): Promise<TurnstileVerificationResult>;
}

export type TurnstileVerificationResult =
  | { success: true }
  | { success: false; reason: 'invalid_token' | 'provider_error' };

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const VERIFY_TIMEOUT_MS = 5000;
const DEFAULT_EXPECTED_ACTION = 'public-intake';

interface SiteverifyResponse {
  success?: boolean;
  hostname?: string;
  action?: string;
}

/** R4 (§7): parses a comma-separated exact-hostname allowlist; returns null (check skipped) when unset. */
function getAllowedHostnames(): string[] | null {
  const raw = process.env.TURNSTILE_ALLOWED_HOSTNAMES;
  if (!raw) return null;
  const hostnames = raw
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
  return hostnames.length > 0 ? hostnames : null;
}

function getExpectedAction(): string {
  return process.env.TURNSTILE_EXPECTED_ACTION || DEFAULT_EXPECTED_ACTION;
}

/**
 * Pure decision function, exported for direct QA -- given a parsed
 * Siteverify response and the current environment configuration,
 * decides whether the hostname/action contract is satisfied. No I/O.
 */
export function evaluateSiteverifyContract(response: SiteverifyResponse): { ok: true } | { ok: false; reason: 'hostname_mismatch' | 'action_mismatch' } {
  const allowedHostnames = getAllowedHostnames();
  if (allowedHostnames && (!response.hostname || !allowedHostnames.includes(response.hostname.toLowerCase()))) {
    return { ok: false, reason: 'hostname_mismatch' };
  }
  const expectedAction = getExpectedAction();
  if (process.env.TURNSTILE_EXPECTED_ACTION !== undefined || response.action !== undefined) {
    // Only enforced once either side has actually opted in: an
    // explicitly configured expected action, or a response that
    // actually included one (meaning the client widget did supply
    // `action`, so it's meaningful to check it even under the
    // default expected value).
    if (response.action !== expectedAction) {
      return { ok: false, reason: 'action_mismatch' };
    }
  }
  return { ok: true };
}

export function createLiveTurnstileVerifier(): TurnstileVerifier {
  return {
    async verify(token: string, remoteIp?: string): Promise<TurnstileVerificationResult> {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS);
      try {
        const body = new URLSearchParams({
          secret: serverConfig.turnstileSecretKey,
          response: token,
        });
        if (remoteIp) body.set('remoteip', remoteIp);

        const response = await fetch(VERIFY_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body,
          signal: controller.signal,
        });

        if (!response.ok) {
          return { success: false, reason: 'provider_error' };
        }

        const data = (await response.json()) as SiteverifyResponse;
        if (!data.success) {
          return { success: false, reason: 'invalid_token' };
        }
        const contract = evaluateSiteverifyContract(data);
        if (!contract.ok) {
          return { success: false, reason: 'invalid_token' };
        }
        return { success: true };
      } catch {
        // Network failure, timeout (AbortController fires here too),
        // or malformed JSON -- treated as a distinguishable provider
        // failure, never as "invalid token", so operators can tell
        // the two apart in events. The server fails CLOSED either
        // way: neither outcome results in the submission being
        // accepted (PHX-LAUNCH-001-R1 §2.5).
        return { success: false, reason: 'provider_error' };
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

/**
 * Deterministic test double for QA/adapter tests. Never performs
 * network I/O. `outcomes` lets a single test drive a scripted
 * sequence (e.g. success, then a provider failure) across
 * successive calls.
 */
export function createFakeTurnstileVerifier(
  outcomes: TurnstileVerificationResult[]
): TurnstileVerifier & { callCount: number } {
  let index = 0;
  return {
    callCount: 0,
    async verify() {
      const outcome = outcomes[Math.min(index, outcomes.length - 1)];
      index += 1;
      this.callCount += 1;
      return outcome;
    },
  };
}
