// ============================================================
// Phoenix Platform — Report Polling Controller
// PHX-REPORTS-004 — Report Generation Lifecycle & Secure Artifact
// Delivery Foundation
// ------------------------------------------------------------
// Pure, framework-free bounded polling logic, extracted specifically so
// it can be tested deterministically with fake timers (see
// qa-report-polling-controller.ts) without needing a real browser or a
// React test renderer.
//
// ---- Why this exists (bug fix) -----------------------------------------
// The original inline implementation in ReportDetailPoller.tsx scheduled
// exactly ONE `setTimeout` inside a `useEffect` keyed on
// `[report.status, report.id]`. When that single poll resolved and the
// status was STILL 'Generating', `report.status` did not change value,
// so React's dependency-comparison bailed out and the effect never
// re-ran — no second poll was ever scheduled. This controller fixes
// that by scheduling the next poll itself, from inside its own tick
// function, for as long as the latest result is non-terminal — not by
// relying on a React effect re-running.
//
// ---- Contract -----------------------------------------------------------
// - start(): begins polling. Resets the attempt counter.
// - stop(): cancels any pending timer and marks the controller stopped.
//   Idempotent — safe to call multiple times, safe to call before any
//   poll has fired.
// - Schedules another poll only while the latest fetched result is
//   NON-terminal (isTerminal() returns false) AND the attempt budget
//   remains.
// - Stops (without scheduling another poll) on: a terminal result,
//   reaching maxAttempts, a fetch error, or stop() being called
//   (including from a React effect's cleanup on unmount).
// - Never overlaps requests: a new poll is only scheduled AFTER the
//   previous one's promise has resolved/rejected — there is no
//   possibility of two in-flight fetches for the same controller
//   instance.
// ============================================================

export interface PollingController {
  start(): void;
  stop(): void;
  /** True if a poll cycle is currently scheduled or in flight. Exposed for tests. */
  isActive(): boolean;
}

export interface PollingControllerOptions<T> {
  intervalMs: number;
  maxAttempts: number;
  /** True if `result` means polling should stop (i.e. NOT 'Generating'). */
  isTerminal: (result: T) => boolean;
  fetchLatest: () => Promise<T>;
  onUpdate: (result: T) => void;
  onError?: (err: unknown) => void;
  onMaxAttemptsReached?: () => void;
  /** Injectable for deterministic fake-timer tests — defaults to the real globals. Handle type is generic (`unknown`) so a test's fake clock can return a plain number instead of Node's real Timeout object. */
  setTimeoutFn?: (handler: () => void, ms: number) => unknown;
  clearTimeoutFn?: (handle: unknown) => void;
}

export function createPollingController<T>(options: PollingControllerOptions<T>): PollingController {
  const scheduleTimeout = options.setTimeoutFn ?? ((handler, ms) => setTimeout(handler, ms));
  const cancelTimeout = options.clearTimeoutFn ?? ((handle) => clearTimeout(handle as Parameters<typeof clearTimeout>[0]));

  let attempts = 0;
  let stopped = true;
  let inFlight = false;
  let timerHandle: unknown = null;

  function clearPendingTimer(): void {
    if (timerHandle !== null) {
      cancelTimeout(timerHandle);
      timerHandle = null;
    }
  }

  function scheduleNextTick(): void {
    if (stopped) return;
    clearPendingTimer();
    timerHandle = scheduleTimeout(() => {
      timerHandle = null;
      void tick();
    }, options.intervalMs);
  }

  async function tick(): Promise<void> {
    if (stopped || inFlight) return; // Never overlap requests.
    inFlight = true;
    attempts += 1;

    let result: T;
    try {
      result = await options.fetchLatest();
    } catch (err) {
      inFlight = false;
      if (stopped) return; // stop()/unmount happened while the fetch was in flight.
      stopped = true;
      options.onError?.(err);
      return;
    }

    inFlight = false;
    if (stopped) return; // stop()/unmount happened while the fetch was in flight.

    options.onUpdate(result);

    if (options.isTerminal(result)) {
      stopped = true;
      return;
    }

    if (attempts >= options.maxAttempts) {
      stopped = true;
      options.onMaxAttemptsReached?.();
      return;
    }

    scheduleNextTick();
  }

  return {
    start() {
      // Resets correctly after Start/Retry/Regenerate: calling start()
      // again always begins a fresh attempt budget and a fresh
      // schedule, regardless of the controller's previous state.
      clearPendingTimer();
      attempts = 0;
      stopped = false;
      scheduleNextTick();
    },
    stop() {
      stopped = true;
      clearPendingTimer();
    },
    isActive() {
      return !stopped && (timerHandle !== null || inFlight);
    },
  };
}
