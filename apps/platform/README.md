# @phoenix/platform

Application shell for the Phoenix Platform product. Next.js 14 (App Router).

**Status: Coming Soon shell.** No feature implementation yet — this is a branded
placeholder that will become the real Phoenix Platform product surface (assessment,
validation, certification, governance).

- Port: `3001`
- Routes: `/` ("Coming Soon" page built with `@phoenix/ui`'s `PageHero`)
- Consumes: `@phoenix/ui`, `@phoenix/design-system`, `@phoenix/config`
- `robots.txt` disallows all crawling; page metadata sets `index: false, follow: false`.
  Do not point public DNS at this app until it has real features.

## Commands

```bash
pnpm --filter @phoenix/platform dev
pnpm --filter @phoenix/platform build
pnpm --filter @phoenix/platform lint
pnpm --filter @phoenix/platform type-check
```

## Next Steps (not part of this launch candidate)

- Wire up `@phoenix/core` and `@phoenix/pbrs` once real assessment/scoring features are
  built here.
- Add authentication and the Governance Dashboard views described on the marketing
  site's `/platform` page.
