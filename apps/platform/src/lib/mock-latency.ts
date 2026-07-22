// ============================================================
// Phoenix Platform — Mock Latency Helper
// PHX-PLATFORM-003 — Mock API Layer
// ------------------------------------------------------------
// Wraps a resolved value in a Promise, optionally after a short
// delay. This exists so every mock API function already has the
// shape of a real network call (a Promise), which means adding
// loading states later is a matter of tuning `delayMs` — not a
// call-site rewrite.
//
// Kept at 0ms by default so local review, static rendering, and
// builds stay fast. Do not raise the default; pass an explicit
// delayMs at the call site if a specific UI needs to rehearse a
// loading state.
// ============================================================

export function mockDelay<T>(value: T, delayMs: number = 0): Promise<T> {
  if (delayMs <= 0) {
    return Promise.resolve(value);
  }
  return new Promise((resolve) => {
    setTimeout(() => resolve(value), delayMs);
  });
}
