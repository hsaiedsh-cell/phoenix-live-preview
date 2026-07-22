# @phoenix/analytics

Placeholder analytics package for the Phoenix monorepo.

## Status

This is a **clean placeholder shell**. It exists so that other packages and
apps in the monorepo (`@phoenix/website`, `@phoenix/platform`,
`@phoenix/dashboard`) can depend on a stable analytics contract today,
without coupling to a specific vendor before one has been selected.

No analytics vendor (Segment, PostHog, GA4, Amplitude, etc.) is integrated
yet. All exported functions are safe no-ops:

- Outside production (`NODE_ENV !== 'production'`), calls are logged to the
  console so integration points are visible during development.
- In production, calls are silent no-ops until a real provider is wired in.

## Exports

```ts
import { trackEvent, identifyUser } from '@phoenix/analytics';
import type { AnalyticsEvent, AnalyticsUser } from '@phoenix/analytics';

trackEvent({ name: 'pbrs_assessment_started', properties: { orgId: 'acme' } });

identifyUser({ userId: 'user_123', traits: { plan: 'enterprise' } });
```

- `trackEvent(event: AnalyticsEvent): void` — track a product or marketing
  event.
- `identifyUser(user: AnalyticsUser): void` — identify the current user or
  organization for downstream analytics.
- `AnalyticsEvent` — shape of a trackable event (`name`, optional
  `properties`, optional `timestamp`).
- `AnalyticsUser` — shape of an identifiable user (`userId`, optional
  `traits`).

## Next steps

When a vendor is selected, implement the vendor SDK call inside
`trackEvent` / `identifyUser` in `src/index.ts` — the exported function
signatures are the stable contract and should not need to change for
call sites.
