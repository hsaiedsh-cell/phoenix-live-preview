# @phoenix/dashboard

Application shell for the Phoenix governance dashboard. Next.js 14 (App Router).

**Status: Coming Soon shell.** No feature implementation yet — this is a branded
placeholder that will become the live readiness/certification dashboard.

- Port: `3002`
- Routes: `/` ("Coming Soon" page built with `@phoenix/ui`'s `PageHero`)
- Consumes: `@phoenix/ui`, `@phoenix/design-system`, `@phoenix/config`
- `robots.txt` disallows all crawling; page metadata sets `index: false, follow: false`.
  Do not point public DNS at this app until it has real features.

## Commands

```bash
pnpm --filter @phoenix/dashboard dev
pnpm --filter @phoenix/dashboard build
pnpm --filter @phoenix/dashboard lint
pnpm --filter @phoenix/dashboard type-check
```

## Next Steps (not part of this launch candidate)

- Wire up `@phoenix/core` and `@phoenix/pbrs` for live readiness scores, certification
  status, and risk signals per the Governance Dashboard concept described on the
  marketing site's `/platform` page.
