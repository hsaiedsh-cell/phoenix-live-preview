// ============================================================
// Turnstile verification adapter
// PHX-LAUNCH-001
// ------------------------------------------------------------
// Uses native fetch only — no SDK dependency added, per Gate 2's
// "do not add a dependency when native APIs are sufficient".
//
// Route handlers depend on the `TurnstileVerifier` interface, not on
// this concrete implementation, so QA can inject a deterministic
// test double instead of calling the real Cloudflare endpoint. This
// module's `verifyTurnstileToken` export is the ONLY thing that
// talks to the real provider, and is never exercised without a real
// TURNSTILE_SECRET_KEY.
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

        const data = (await response.json()) as { success?: boolean };
        return data.success ? { success: true } : { success: false, reason: 'invalid_token' };
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
