# Phoenix Monorepo — Launch Candidate (PHX-WEB-003)

Production-ready monorepo for the Phoenix AI Business Readiness platform, hardened for
launch. Public marketing website plus placeholder shells for the Platform and Dashboard
apps that will be built out next.

## Status

**Launch Candidate.** The public website (`@phoenix/website`) is feature-complete for
MVP launch. `@phoenix/platform` and `@phoenix/dashboard` are scaffolded, branded
"Coming Soon" shells — not yet feature-built. See `/docs/LAUNCH_QA_CHECKLIST.md` before
shipping.

## Monorepo Structure

```
phoenix-website-mvp/
├── apps/
│   ├── website/          # Next.js 14 App Router — public marketing site (primary app, port 3000)
│   ├── platform/         # Next.js 14 App Router — Phoenix Platform shell (port 3001, "Coming Soon")
│   └── dashboard/        # Next.js 14 App Router — Phoenix Dashboard shell (port 3002, "Coming Soon")
├── packages/
│   ├── core/              # Domain types, PBRS model, product/solution data
│   ├── ui/                  # Shared UI components (@phoenix/ui)
│   ├── pbrs/                  # PBRS sample data & scoring utilities
│   ├── design-system/           # Brand tokens (colors, type, spacing, motion) + CSS variables
│   └── config/                    # Site config, navigation, footer structure
├── docs/
│   └── LAUNCH_QA_CHECKLIST.md
├── pnpm-workspace.yaml
└── package.json
```

Each app and package has its own README with more detail — see the links in the table
below.

| Path                     | README |
|--------------------------|--------|
| `apps/website`           | [apps/website/README.md](apps/website/README.md) |
| `apps/platform`          | [apps/platform/README.md](apps/platform/README.md) |
| `apps/dashboard`         | [apps/dashboard/README.md](apps/dashboard/README.md) |
| `packages/core`          | [packages/core/README.md](packages/core/README.md) |
| `packages/ui`            | [packages/ui/README.md](packages/ui/README.md) |
| `packages/pbrs`          | [packages/pbrs/README.md](packages/pbrs/README.md) |
| `packages/design-system` | [packages/design-system/README.md](packages/design-system/README.md) |

## Apps & Routes

**`@phoenix/website`** (primary public app, port 3000):

| Route         | Page                              |
|---------------|------------------------------------|
| `/`           | Home                               |
| `/platform`   | Phoenix Platform (marketing page)  |
| `/pbrs`       | PBRS™ Standard and Score            |
| `/products`   | Phoenix Products                   |
| `/solutions`  | Solutions by Function              |
| `/resources`  | Research and Knowledge Hub         |
| `/about`      | About Phoenix                      |
| `/contact`    | Contact / Request Assessment       |

Note: `apps/website/src/app/platform` is the **marketing page** describing the Phoenix
Platform product. `apps/platform` is the **separate application shell** for the actual
Platform product itself (currently a "Coming Soon" placeholder). The two are intentionally
distinct — the website remains the single primary public-facing app.

**`@phoenix/platform`** (port 3001): single "Coming Soon" route, branded shell.
**`@phoenix/dashboard`** (port 3002): single "Coming Soon" route, branded shell.

## PBRS Model (v1.0 — Official Six-Dimension Model)

The official PBRS model, sourced exclusively from `@phoenix/core`, has **not** been
changed as part of this hardening pass:

1. Accuracy (20%)
2. Compliance (20%)
3. Brand Alignment (15%)
4. Structure (15%)
5. Consistency (15%)
6. Completeness (15%)

Derived signals: Risk Level, Confidence Index, Automation Readiness.

The prior seven-dimension model (Accuracy, Compliance, Brand Alignment, Business Logic,
Clarity, Risk, Automation Readiness) remains retired and does not appear anywhere in
this build.

## Design System & Brand Tokens

- Primary Navy: `#0C1929`
- Accent Cyan: `#03A7C7`
- Font: Inter
- Aesthetic: Apple × Stripe × Linear × Vercel — minimal, premium, enterprise-grade

All brand colors are centralized in `@phoenix/design-system`:

- Canonical hex values live in `packages/design-system/src/index.ts` (`colors` object).
- The same values are exposed as global CSS custom properties in
  `packages/design-system/src/tokens.css`, imported once per app via `globals.css`.
- Each app's Tailwind config maps a `phx-*` color scale (`bg-phx-navy`, `text-phx-cyan`,
  `border-phx-navy-mid`, `bg-phx-surface`, etc.) onto those CSS variables using the
  `rgb(var(...) / <alpha-value>)` pattern, so Tailwind opacity modifiers (e.g.
  `bg-phx-cyan/10`) work correctly.
- No component should hardcode a brand hex value. The one intentional exception is
  `apps/website/src/app/icon.svg` (the favicon), which is rendered by the browser
  outside the page's CSS scope and therefore cannot reference CSS variables — it is
  commented in-file as an intentional exception.

## Development

```bash
pnpm install
pnpm dev          # runs @phoenix/website on http://localhost:3000
```

To run the platform or dashboard shells individually:

```bash
pnpm --filter @phoenix/platform dev   # http://localhost:3001
pnpm --filter @phoenix/dashboard dev  # http://localhost:3002
```

## Build & Verification

```bash
pnpm install
pnpm type-check   # tsc --noEmit across all apps
pnpm lint         # next lint across all apps
pnpm build        # production build across all apps
```

All three commands are verified to pass as of this launch candidate.

## Deployment Notes

- `@phoenix/website` is the only app intended for public deployment behind
  `phoenixops.ai` at this stage. It has a `sitemap.ts`, `robots.txt` (allow-all), and
  full SEO metadata.
- `@phoenix/platform` and `@phoenix/dashboard` are pre-launch shells: their
  `robots.txt` disallows all crawling and their page metadata sets
  `robots: { index: false, follow: false }`. They should be deployed to
  non-public/staging subdomains (or left undeployed) until they have real features.
- All three apps consume `@phoenix/design-system` and (where relevant) `@phoenix/ui`
  and `@phoenix/config` via `workspace:*` references — no forking or duplication of
  brand tokens or shared components across apps.

## Package Boundaries

- Website consumes `@phoenix/core`, `@phoenix/ui`, `@phoenix/pbrs`,
  `@phoenix/design-system`, `@phoenix/config` via `workspace:*` references.
- Platform and dashboard shells consume `@phoenix/ui`, `@phoenix/design-system`,
  `@phoenix/config` (no `@phoenix/core`/`@phoenix/pbrs` yet — they don't implement PBRS
  scoring features).
- PBRS scoring logic and domain types live exclusively in `@phoenix/core` and
  `@phoenix/pbrs` — never redefined or hardcoded in app pages.
- Reusable UI (PageHero, SectionHeader, CTAButton, ProductCard, SolutionCard,
  ResourceCard, PBRSScorePreview, DimensionGrid, WorkflowTimeline, TrustLayerDiagram,
  ContactFormShell) lives in `@phoenix/ui`. Page-specific composition and icons remain
  in each app.
- `CTAButton` and `PageHero`'s CTA links use Next.js `<Link>` for internal routes and a
  plain `<a>` for external protocols (`mailto:`, `tel:`, `http(s)://`).

## Notes on Claims & Numbers

All quantitative claims (e.g., score percentages, efficiency figures) that appear on
the site are explicitly labeled as illustrative, sample, or projected — not asserted as
measured performance results.
