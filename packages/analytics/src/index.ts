// ============================================================
// @phoenix/analytics — Placeholder Shell
// Phoenix Business Readiness Platform
// ============================================================
//
// This package is a clean placeholder. It defines the shape of
// Phoenix's analytics contract (event tracking + user identity)
// without wiring up a real analytics vendor (e.g. Segment,
// PostHog, GA4). All functions are safe no-ops that log to the
// console in development so call sites can be wired up now and
// connected to a real provider later without changing call
// signatures across the codebase.

export interface AnalyticsEvent {
  /** Event name, e.g. "pbrs_assessment_started" */
  name: string;
  /** Arbitrary event properties */
  properties?: Record<string, unknown>;
  /** ISO 8601 timestamp; defaults to time of call if omitted */
  timestamp?: string;
}

export interface AnalyticsUser {
  /** Stable identifier for the user or organization */
  userId: string;
  /** Arbitrary user/organization traits */
  traits?: Record<string, unknown>;
}

/**
 * Track a product or marketing event.
 *
 * Placeholder implementation — no vendor is wired up yet. Logs to
 * the console outside production so integration points are visible
 * during development, and is a silent no-op in production builds.
 */
export function trackEvent(event: AnalyticsEvent): void {
  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.log('[@phoenix/analytics] trackEvent (placeholder):', {
      ...event,
      timestamp: event.timestamp ?? new Date().toISOString(),
    });
  }
}

/**
 * Identify the current user or organization for downstream analytics.
 *
 * Placeholder implementation — no vendor is wired up yet. Logs to
 * the console outside production so integration points are visible
 * during development, and is a silent no-op in production builds.
 */
export function identifyUser(user: AnalyticsUser): void {
  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.log('[@phoenix/analytics] identifyUser (placeholder):', user);
  }
}
