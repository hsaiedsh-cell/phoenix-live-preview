// ============================================================
// Adapter registry
// PHX-LAUNCH-001
// ------------------------------------------------------------
// Route handlers call getTurnstileVerifier()/getEmailSender()/
// getStorageAdapter()/getMonitoringAdapter() rather than importing a
// concrete adapter directly. In the running Next.js server these
// always resolve to the live provider-backed implementation. QA
// scripts (run standalone via tsx, never inside the Next.js
// process) call the matching `__setXForTests` function first to
// inject a fake, exercise route logic extracted into testable
// functions, then call `__resetAdaptersForTests()`.
// ============================================================

import { createLiveTurnstileVerifier, type TurnstileVerifier } from './turnstile.adapter';
import { createLiveEmailSender, type EmailSender } from './email.adapter';
import { createLiveSupabaseStorageAdapter, type StorageAdapter } from './storage.adapter';
import { createLiveSentryAdapter, type MonitoringAdapter } from './monitoring.adapter';

let turnstileOverride: TurnstileVerifier | undefined;
let emailOverride: EmailSender | undefined;
let storageOverride: StorageAdapter | undefined;
let monitoringOverride: MonitoringAdapter | undefined;

let liveTurnstile: TurnstileVerifier | undefined;
let liveEmail: EmailSender | undefined;
let liveStorage: StorageAdapter | undefined;
let liveMonitoring: MonitoringAdapter | undefined;

export function getTurnstileVerifier(): TurnstileVerifier {
  if (turnstileOverride) return turnstileOverride;
  if (!liveTurnstile) liveTurnstile = createLiveTurnstileVerifier();
  return liveTurnstile;
}

export function getEmailSender(): EmailSender {
  if (emailOverride) return emailOverride;
  if (!liveEmail) liveEmail = createLiveEmailSender();
  return liveEmail;
}

export function getStorageAdapter(): StorageAdapter {
  if (storageOverride) return storageOverride;
  if (!liveStorage) liveStorage = createLiveSupabaseStorageAdapter();
  return liveStorage;
}

export function getMonitoringAdapter(): MonitoringAdapter {
  if (monitoringOverride) return monitoringOverride;
  if (!liveMonitoring) liveMonitoring = createLiveSentryAdapter();
  return liveMonitoring;
}

// ---- Test-only overrides (QA scripts only; never called from the
// running Next.js application) ----

export function __setTurnstileForTests(adapter: TurnstileVerifier | undefined): void {
  turnstileOverride = adapter;
}
export function __setEmailForTests(adapter: EmailSender | undefined): void {
  emailOverride = adapter;
}
export function __setStorageForTests(adapter: StorageAdapter | undefined): void {
  storageOverride = adapter;
}
export function __setMonitoringForTests(adapter: MonitoringAdapter | undefined): void {
  monitoringOverride = adapter;
}
export function __resetAdaptersForTests(): void {
  turnstileOverride = undefined;
  emailOverride = undefined;
  storageOverride = undefined;
  monitoringOverride = undefined;
}

/**
 * Wraps getEmailSender().send(...) so that a misconfigured live
 * provider (e.g. missing RESEND_API_KEY, which throws at adapter
 * construction time, before send()'s own try/catch ever runs) can
 * never crash a caller mid-transaction. Every call site that sends
 * an email should go through this, not call getEmailSender()
 * directly, so a failed send is always reported the same way a
 * provider-level failure is: { success: false }.
 */
export async function sendEmailSafely(input: import('./email.adapter').SendEmailInput): Promise<{ success: boolean }> {
  try {
    return await getEmailSender().send(input);
  } catch {
    return { success: false };
  }
}
