# Phoenix Launch QA Checklist

Task ID: PHX-WEB-003 — Launch Hardening
Scope: `@phoenix/website` (primary public app). Platform/dashboard shells are
pre-launch and excluded from public-facing checks (see notes inline where relevant).

Use this checklist before promoting a build to production. Check items off as they are
verified for the specific build/commit being shipped.

> **PHX-DEPLOY-001 verification pass (2026-07-06):** items checked below were
> verified by actually running the command or check described. This pass covered
> build integrity (`install`/`type-check`/`lint`/`build`), the font-loading fix,
> and a repo-wide hex-value grep. It did **not** include browser-based visual QA,
> live route rendering, accessibility testing, responsive testing, or an actual
> deployment — those items remain unchecked and should be verified separately
> before promoting to production.

---

## 1. Route Checklist

- [ ] `/` — Home renders, all 9 sections present (Hero, Problem, Missing Layer, What is
      PBRS, How Phoenix Works, Products, Solutions, Resources, Final CTA)
- [ ] `/platform` — Platform marketing page renders
- [ ] `/pbrs` — PBRS™ Standard page renders, six dimensions + derived signals + sample
      score + maturity levels all present
- [ ] `/products` — all four products (PBRS™ Engine, Phoenix Readiness™, Phoenix
      Verify™, Phoenix Studio™) render with correct copy
- [ ] `/solutions` — all six solutions render with working `#anchor` deep links from
      the footer (`/solutions#corporate-comms`, etc.)
- [ ] `/resources` — all four resource cards render
- [ ] `/about` — mission/vision, philosophy, principles, and closing CTA all render
- [ ] `/contact` — contact form UI renders, both CTAs (Request Assessment via
      `ContactFormShell`, Book a Demo via mailto) work
- [ ] `/sitemap.xml` — generates and includes all 8 routes
- [ ] 404 page (`/_not-found`) renders reasonably
- [ ] No route returns a 500 or build-time error

## 2. SEO Checklist

- [ ] Every route has a unique `<title>` and `description` (verify via `metadata`
      exports)
- [ ] Open Graph tags present on root layout (`title`, `description`, `url`,
      `siteName`, `type`)
- [ ] Twitter card metadata present
- [ ] `robots.txt` allows crawling and references the sitemap
      (`apps/website/public/robots.txt`)
- [ ] `sitemap.ts` resolves to absolute URLs under `https://phoenixops.ai`
- [ ] `metadataBase` is set correctly in the root layout
- [ ] Platform/dashboard shells: confirm `robots: { index: false, follow: false }` is
      set on their metadata and their `robots.txt` disallows all — these must **not**
      be indexed while they're placeholder shells

## 3. Accessibility Checklist

- [ ] Skip-to-content link present and focus-visible (`#main-content`)
- [ ] All interactive elements have visible `:focus-visible` outlines (uses
      `--phx-cyan` outline globally)
- [ ] Header nav has `aria-label="Main navigation"`, mobile nav has
      `aria-label="Mobile navigation"`
- [ ] Active nav item sets `aria-current="page"`
- [ ] Mobile menu button toggles `aria-expanded` and has a descriptive `aria-label`
      (Open/Close menu)
- [ ] Mobile menu is fully keyboard-operable (tab order, Escape/close behavior if
      applicable)
- [ ] All decorative SVG icons/dividers are `aria-hidden="true"` where appropriate
      (e.g. `TrustLayerDiagram` connector arrows)
- [ ] Form inputs in `ContactFormShell` all have associated `<label htmlFor>`
- [ ] Color contrast spot-checked for body text on both light (`phx-surface`/white) and
      dark (`phx-navy`) backgrounds
- [ ] Heading hierarchy is logical per page (single `h1` in `PageHero`, `h2`s for
      sections, `h3`s for cards)

## 4. Responsive Checklist

- [ ] Mobile (< 640px): mobile nav menu opens/closes correctly, no horizontal scroll,
      hero/CTA buttons stack vertically
- [ ] Tablet (640–1024px): grid layouts (`sm:grid-cols-2`, etc.) reflow correctly
- [ ] Desktop (≥ 1024px): full multi-column grids, desktop nav visible, mobile menu
      button hidden
- [ ] Spot-check `/pbrs` and `/platform` (longest pages) at 375px, 768px, 1280px,
      1920px widths
- [ ] Header remains usable when sticky + backdrop-blur is applied while scrolling

## 5. Content Checklist

- [ ] No lorem ipsum or placeholder copy remains
- [ ] PBRS™ dimension names/weights on every page match `@phoenix/core` exactly (single
      source of truth — no page should hardcode its own copy of the model)
- [ ] All quantitative claims (scores, percentages) are labeled illustrative/sample
      (see `PBRSScorePreview`'s "Illustrative sample score" caption)
- [ ] Contact email is consistent everywhere (`hello@phoenixops.ai`, from
      `siteConfig.email`)
- [ ] No `href="#"` placeholder links remain anywhere in the codebase
- [ ] No unescaped apostrophes/quotes causing lint errors (`react/no-unescaped-entities`)

## 6. Brand Checklist

- [x] No hardcoded brand hex values in any `.tsx`/`.ts`/`.css` file under `apps/` or
      `packages/`, except the documented favicon exception
      (`apps/website/src/app/icon.svg`) — verified 2026-07-06 (PHX-DEPLOY-001) via
      repo-wide grep; the only other hex literals found are the canonical token
      definitions in `packages/design-system/src/index.ts` itself, which is the
      intended single source of truth these tokens are derived from
- [ ] All brand colors resolve through the `phx-*` Tailwind scale or
      `var(--phx-*)` CSS variables
- [ ] Logo (navy/cyan variants) renders correctly in both header (on navy background)
      and any light-background contexts
- [x] Font is Inter everywhere (loaded via Google Fonts `@import` in `globals.css`) —
      verified 2026-07-06 (PHX-DEPLOY-001); `@import` moved to precede the
      `@tailwind` directives in all three apps' `globals.css` to eliminate the
      CSS import-order warning (see BUILD_REPORT.md / RELEASE_NOTES_PHX_WEB_003.md)
- [ ] Tagline "Where AI Becomes Business Ready." is consistent across `siteConfig`,
      page metadata, and visible copy

## 7. Build Checklist

- [x] `pnpm install` completes cleanly from a fresh clone (no manual workarounds
      required) — verified 2026-07-06 (PHX-DEPLOY-001); note: lockfile was
      regenerated due to a pnpm version mismatch in the verification
      environment (pnpm 8.15.9 vs. lockfile format), see BUILD_REPORT.md
- [x] `pnpm type-check` passes with zero errors across all three apps —
      verified 2026-07-06 (PHX-DEPLOY-001)
- [x] `pnpm lint` passes with zero errors/warnings across all three apps —
      verified 2026-07-06 (PHX-DEPLOY-001)
- [x] `pnpm build` completes successfully across all three apps, all routes
      pre-rendered as static content — verified 2026-07-06 (PHX-DEPLOY-001)
- [x] No malformed/brace-expanded directories exist anywhere in the repo
      (`find . -name "{*"` should return nothing) — verified 2026-07-06
      (PHX-DEPLOY-001), returned empty
- [x] `packages/*` compile via `transpilePackages` in each app's `next.config.js`
      without needing a separate build step — verified 2026-07-06
      (PHX-DEPLOY-001); confirmed by successful build with no standalone
      package build step run

## 8. Deployment Checklist

- [ ] `@phoenix/website` deploys to `phoenixops.ai` (or staging equivalent) as the
      primary public app
- [ ] `@phoenix/platform` and `@phoenix/dashboard` are **not** deployed to public,
      indexable domains while they remain "Coming Soon" shells — stage them on
      internal/non-indexed subdomains only, if deployed at all
- [ ] Environment/build settings match each app's `package.json` scripts
      (`dev`/`build`/`start`/`lint`/`type-check`)
- [ ] Confirm `pnpm-workspace.yaml` and lockfile are committed and match the installed
      dependency tree
- [ ] Post-deploy smoke test: load `/`, `/pbrs`, `/contact` on the live URL and confirm
      no console errors, correct fonts/colors, and working navigation
