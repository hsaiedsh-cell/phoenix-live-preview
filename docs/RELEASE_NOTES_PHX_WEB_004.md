# Release Notes — PHX-WEB-004

**Date:** 2026-07-06
**Task:** Phoenix Preview Polish Sync
**Base codebase:** `phoenix-staging-ready` (canonical)
**QA evidence source:** `phoenix-preview-ready` (screenshots, reports only — not merged as code)

---

## What Changed

1. **Package manager pin** — Added `"packageManager": "pnpm@8.15.9"` to the root `package.json`. Existing `scripts` and `engines` were left untouched.

2. **Content polish — "business logic" removed from public copy:**
   - `apps/website/src/app/page.tsx` — homepage "Validate" step description changed from *"Verify accuracy, compliance, and business logic."* to *"Verify accuracy, compliance, and operational fit."*
   - `packages/core/src/index.ts` — the **Completeness** dimension's description (rendered publicly via `DimensionGrid` on both `/` and `/pbrs`) changed from *"...and business logic."* to *"...and operational fit."*
   - No PBRS dimension is labeled "Business Logic." The six official dimensions (Accuracy, Compliance, Brand Alignment, Structure, Consistency, Completeness) were already correctly implemented in the staging-ready base and were left unchanged.

3. **Contact page CTA completeness** — The "Request Assessment" card on `/contact` had descriptive copy but no actual call-to-action link. Added a `mailto:hello@phoenixops.ai?subject=Phoenix%20Assessment%20Request` button, matching the existing "Book a Demo" mailto pattern (`mailto:hello@phoenixops.ai?subject=Phoenix%20Demo%20Request`, already present and unchanged). The contact form's "This form is a UI preview. Submissions are not yet connected to a backend." disclaimer was already present in the staging base and required no change.

4. **QA evidence archived** — Copied from `phoenix-preview-ready` into the canonical repo under `/docs/preview/`:
   - `VISUAL_QA_REPORT_PHX_PREVIEW_001.md`
   - `BROWSER_QA_REPORT_PHX_PREVIEW_001.md`
   - `/docs/preview/screenshots/desktop/`, `/tablet/`, `/mobile/` (8 pages × 3 breakpoints, 24 screenshots total)

## What Was Preserved (No Changes Made)

- All six apps/packages workspace structure: `apps/website`, `apps/platform`, `apps/dashboard`, `packages/core`, `packages/ui`, `packages/pbrs`, `packages/design-system`, `packages/config`, `packages/analytics`.
- `packages/analytics` — already present in staging-ready with `trackEvent()`, `identifyUser()`, `AnalyticsEvent` type, and README. No placeholder restoration was needed.
- The six-dimension PBRS model and its 20/20/15/15/15/15 weighting in `packages/core/src/index.ts` — already correct in the staging base.
- Brand tokens, navy/cyan palette, Inter typeface, and all design-system styling.
- All existing routes, page content, and layout structure — no redesign performed.
- `pnpm-workspace.yaml`, existing lockfile, and dependency versions.

## QA Evidence Added

Source: `phoenix-preview-ready` package, used strictly as evidence (not merged as code).
Archived at `/docs/preview/` in this release:
- 2 QA reports (visual + browser)
- 24 screenshots across desktop/tablet/mobile for all 8 public routes

The preview package's malformed `preview-screenshots/{desktop,tablet,mobile}/` artifact folder (a literal brace-expansion directory name, empty of files) was identified during evidence handling and was not copied into the canonical repo — only the correctly named `desktop/`, `tablet/`, `mobile/` folders and their contents were brought over.

## Build Status

All three commands run against the updated staging-ready base, from a clean `pnpm install`:

| Command | Result |
|---|---|
| `pnpm install` | ✅ Pass (378 packages, workspace resolved) |
| `pnpm type-check` | ✅ Pass — `website`, `platform`, `dashboard` |
| `pnpm lint` | ✅ Pass — no ESLint warnings or errors in any app |
| `pnpm build` | ✅ Pass — all 3 apps compiled and generated static pages successfully |

See `BUILD_REPORT_PHX_WEB_004.md` for full command output.

## Known Limitations

- The contact form remains a UI-only preview (`onSubmit={(e) => e.preventDefault()}`); no backend, email service, or CRM integration was added, per task scope.
- `packages/pbrs/src/index.ts` sample score object (`SAMPLE_PBRS_SCORE`) reflects the six-dimension model already; no further sample-data changes were needed.
- **Standard-document conflict remains open:** `PHX-STD-PBRS-001` (the finalized ISO-style PBRS Standard document) still describes the deprecated seven-dimension model (including Business Logic and Clarity as scored dimensions). Per instruction, this was treated as a documentation-only conflict out of scope for this task and was not edited here.

## Next Step Recommendation

Schedule the **PBRS Standard Alignment Sprint** referenced in this task's clarification to update `PHX-STD-PBRS-001` (and any dependent research artifacts — Standards Mapping Matrix, Controls Matrix, executive deck) so the formal standard document matches the six-dimension model now live in code and on the public site. Until that sprint runs, the standard document and the shipped product are out of sync, which is a governance risk for a platform whose core value proposition is standards conformance.
