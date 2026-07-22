# Phoenix — Deployment Guide (Vercel)

Task ID: PHX-DEPLOY-001

This guide covers deploying the Phoenix monorepo's public website
(`@phoenix/website`) to Vercel. It does not cover `@phoenix/platform` or
`@phoenix/dashboard` — those remain internal, `noindex` shells and should
not be deployed to a public, indexable domain (see "Non-public apps" below).

---

## 1. Project Structure

```
phoenix-website-launch-candidate/
├── apps/
│   ├── website/       ← DEPLOY TARGET (public, phoenixops.ai)
│   ├── platform/       (internal shell — noindex, not publicly deployed)
│   └── dashboard/       (internal shell — noindex, not publicly deployed)
├── packages/
│   ├── core/            Domain types & PBRS constants (single source of truth)
│   ├── ui/               Shared UI components
│   ├── design-system/     Design tokens (colors, typography, tokens.css)
│   ├── pbrs/               PBRS scoring/grading logic
│   ├── config/             Shared site config, nav, footer content
│   └── analytics/           Placeholder analytics package (no vendor wired yet)
├── docs/
│   ├── DEPLOYMENT_GUIDE.md         (this file)
│   ├── RELEASE_NOTES_PHX_WEB_003.md
│   └── LAUNCH_QA_CHECKLIST.md
├── .env.example
├── package.json
├── pnpm-workspace.yaml
└── pnpm-lock.yaml
```

This is a pnpm workspace monorepo. Vercel needs to be told which app to build
and how to reach it from the repo root.

---

## 2. App to Deploy

**`apps/website`** is the only app that should be deployed to a public,
indexable domain (`phoenixops.ai`).

`apps/platform` and `apps/dashboard` are pre-launch "coming soon" shells.
Their root layouts already set `robots: { index: false, follow: false }`.
If they need to be reachable at all during this phase, deploy them as
**separate Vercel projects on non-indexed, internal-only subdomains**
(e.g. an internal preview URL) — never on `phoenixops.ai` or a public
subdomain of it.

---

## 3. Vercel Project Settings

Create a Vercel project pointed at this repository, then configure:

| Setting | Value |
|---|---|
| **Framework Preset** | Next.js |
| **Root Directory** | `apps/website` |
| **Install Command** | `pnpm install` (run from repo root — Vercel handles this automatically when "Root Directory" is set and a `pnpm-lock.yaml` is detected at the repo root) |
| **Build Command** | `pnpm build` (equivalent to `next build` inside `apps/website`; the monorepo's `packages/*` are consumed via `transpilePackages` in `apps/website/next.config.js`, so no separate package build step is needed) |
| **Output Directory** | `.next` (default for Next.js — do not override) |
| **Node.js Version** | 18.x or later (see `engines.node` in root `package.json`) |

> Vercel auto-detects pnpm workspaces from `pnpm-workspace.yaml` at the repo
> root and will install the full workspace dependency graph even though the
> Root Directory is scoped to `apps/website`. No monorepo-specific build
> plugin is required for this project shape.

---

## 4. Environment Variables

Set these in the Vercel project's **Settings → Environment Variables** for
both Preview and Production environments. See `.env.example` at the repo
root for the canonical list:

```
NEXT_PUBLIC_SITE_URL=https://phoenixops.ai
NEXT_PUBLIC_CONTACT_EMAIL=hello@phoenixops.ai
```

Use the staging URL (see below) for `NEXT_PUBLIC_SITE_URL` in
Preview/staging environments, and `https://phoenixops.ai` only in
Production.

**Known limitation:** as of this release, `apps/website` does not yet read
`NEXT_PUBLIC_SITE_URL` or `NEXT_PUBLIC_CONTACT_EMAIL` at runtime —
`siteConfig` in `@phoenix/config` (`packages/config/src/index.ts`) currently
hardcodes `url: 'https://phoenixops.ai'` and `email: 'hello@phoenixops.ai'`
directly. These environment variables are provided now so the deployment
pipeline and staging/production separation are in place; wiring
`@phoenix/config` to actually read them is recommended as follow-up work
(see `RELEASE_NOTES_PHX_WEB_003.md` → Next Recommended Sprint) and was out
of scope for this build-verification task.

No secrets or private keys are required for `apps/website` at this time.

---

## 5. Output Expectations

A successful `pnpm build` for `apps/website` produces:

- All routes (`/`, `/about`, `/contact`, `/pbrs`, `/platform`, `/products`,
  `/resources`, `/solutions`, `/sitemap.xml`, `/icon.svg`) pre-rendered as
  **static content** (Next.js `○ (Static)` markers).
- No server-only routes/API routes are currently defined in `apps/website`.
- First Load JS shared by all routes: ~87.3 kB; per-route payload is small
  (~1.8 kB) since most content is static.

If a build instead shows dynamic (`ƒ`) rendering for routes that were
previously static, or introduces API routes, treat that as a signal to
review before promoting to production — it's outside this release's scope.

---

## 6. Staging URL

`[STAGING_URL_PLACEHOLDER — fill in once the Vercel preview/staging domain
is provisioned, e.g. https://phoenix-website-staging.vercel.app]`

---

## 7. Production Domain

**`phoenixops.ai`**

DNS and domain attachment in Vercel are out of scope for this task; this
guide assumes the domain is already owned and will be pointed at the
`apps/website` Vercel project separately.

---

## 8. Post-Deployment Smoke Test

After deploying to staging or production, manually verify:

1. **Home (`/`)** loads with no console errors, correct Phoenix navy/cyan
   branding, and the Inter font rendering correctly (not a fallback
   system font).
2. **`/pbrs`** loads and displays the six PBRS™ dimensions with their
   weights (Accuracy 20%, Compliance 20%, Brand Alignment 15%, Structure
   15%, Consistency 15%, Completeness 15%) — confirm this matches
   `packages/core/src/index.ts` exactly; do **not** compare against any
   older seven-dimension version of the model.
3. **`/contact`** loads, the "Book a Demo" mailto link opens with
   `hello@phoenixops.ai` (or the configured contact email) pre-filled.
4. **`/sitemap.xml`** resolves and lists all public routes with absolute
   URLs under the deployed domain.
5. **`robots.txt`** is reachable and correctly allows crawling for
   `apps/website` (and, separately, confirm any deployed `platform`/
   `dashboard` preview disallows all crawling).
6. Navigate all primary nav links (Platform, PBRS™, Products, Solutions,
   Resources, About) and confirm each route returns 200, not 404/500.
7. Resize to mobile width and confirm the mobile nav menu opens/closes
   without layout breakage.
8. Check browser devtools Network tab for any failed font, image, or
   script requests.

If any smoke test step fails, do not promote the deployment further;
file it against `LAUNCH_QA_CHECKLIST.md`.
