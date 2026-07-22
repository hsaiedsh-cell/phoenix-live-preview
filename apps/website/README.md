# @phoenix/website

The Phoenix public marketing website. Next.js 14 (App Router). This is the **primary
public-facing app** in the monorepo.

- Port: `3000`
- Routes: `/`, `/platform`, `/pbrs`, `/products`, `/solutions`, `/resources`, `/about`,
  `/contact`
- Consumes: `@phoenix/core`, `@phoenix/ui`, `@phoenix/pbrs`, `@phoenix/design-system`,
  `@phoenix/config`

## Commands

```bash
pnpm --filter @phoenix/website dev
pnpm --filter @phoenix/website build
pnpm --filter @phoenix/website lint
pnpm --filter @phoenix/website type-check
```

## Notes

- SEO: full `metadata` per route, `sitemap.ts`, `robots.txt` (allow-all).
- Brand colors are consumed exclusively via the `phx-*` Tailwind color scale (see
  `tailwind.config.ts`) — never hardcoded hex in components.
- Internal navigation uses Next.js `<Link>`; external links (`mailto:`, `https://`) use
  plain anchors.
- The `/platform` route here is the **marketing page** for the Phoenix Platform
  product — distinct from the separate `apps/platform` application shell.
