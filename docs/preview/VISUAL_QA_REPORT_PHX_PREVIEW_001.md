# Visual QA Report — PHX-PREVIEW-001

**Project:** Phoenix Website (phoenix-website-launch-candidate)
**Scope:** apps/website — 8 public routes
**Reviewed by:** QA Preview Engineer (Claude)
**Date:** 2026-07-06
**Method:** Full-page Playwright screenshots at 1440px (desktop), 768px (tablet), 390px (mobile) for every route; manual visual inspection of rendered output.

---

## Severity Legend
- **Critical** — blocks launch (broken layout, missing content, brand violation, incorrect PBRS data)
- **Major** — visibly wrong but not launch-blocking (spacing, alignment, minor overflow)
- **Minor** — cosmetic polish item
- **Enhancement** — nice-to-have, not a defect

---

## Homepage (`/`)
- Hero, "The Problem" (4-card grid), "The Missing Layer" flow, "What is PBRS™" six-dimension summary, "How Phoenix Works" 5-step flow, product suite, "Built for every function," and research hub sections all render top-to-bottom with no gaps or overlaps at any breakpoint.
- CTA buttons ("Request Assessment," "Explore PBRS™") are present, styled consistently, and link correctly.
- No issues found. **Status: Pass.**

## Platform Page (`/platform`)
- Loads cleanly across breakpoints; no console/runtime errors.
- **Status: Pass.**

## PBRS Page (`/pbrs`)
- Correctly displays the **six**-weighted-dimension model (Accuracy 20%, Compliance 20%, Brand Alignment 15%, Structure 15%, Consistency 15%, Completeness 15%), matching `@phoenix/core`'s `PBRS_DIMENSIONS`.
- Derived signals (Risk Level, Confidence Index, Automation Readiness) are correctly presented as separate, derived outputs rather than additional weighted dimensions — this matches the codebase logic and avoids reintroducing the old seven-dimension framing.
- Maturity model (5 levels, Initial → Optimized) renders correctly.
- Scanned full page text on all 8 routes for legacy seven-dimension terminology ("Business Logic," "Clarity," standalone "Risk (15%)," "Automation Readiness (10%)," or literal "seven-dimension" wording) — **no matches found anywhere in the site.**
- **Status: Pass.**

## Products Page (`/products`)
- All four product cards (PBRS™ Engine, Phoenix Readiness™, Phoenix Verify™, Phoenix Studio™) render with consistent card height, icon treatment, and copy structure.
- **Status: Pass.**

## Solutions Page (`/solutions`)
- Anchor targets referenced elsewhere in the site (`#corporate-comms`, `#marketing`, `#legal`, `#risk-compliance`) are all confirmed present in the page's rendered HTML.
- **Status: Pass.**

## Resources Page (`/resources`)
- Loads cleanly; card grid consistent with rest of site.
- **Status: Pass.**

## About Page (`/about`)
- Mission/Vision, Philosophy, and "What we build by" (6-principle grid) sections render correctly and match brand copy from the company deck.
- **Status: Pass.**

## Contact Page (`/contact`)
- Form fields (First/Last name, Work email, Company, Role, message) render correctly with visible disclosure: *"This form is a UI preview. Submissions are not yet connected to a backend."* This is accurate and appropriately transparent — flagging as a pre-launch note rather than a defect.
- **Status: Pass. Enhancement:** confirm backend wiring is tracked as a follow-up task before public launch, since the disclosure implies the form does not currently submit anywhere.

## Navigation
- Header nav (Platform, PBRS™, Products, Solutions, Resources, About, Contact, Request Assessment CTA) is identical across all 8 pages.
- Internal link set extracted from rendered HTML is byte-identical across every route — no page has a missing or extra nav item.
- **Status: Pass.**

## Footer
- Footer link groups (Platform / Solutions / Resources / Company) are identical across all 8 pages, with correct hrefs to `/platform`, `/pbrs`, `/products`, `/solutions` sub-anchors, `/resources`, `/about`, `/contact`.
- Copyright line and `phoenixops.ai` label present and correctly styled.
- **Status: Pass.**

## Mobile Responsiveness
- All 8 pages reflow correctly at 390px: cards stack single-column, hero copy remains legible, no horizontal scroll or clipped text observed in any full-page capture.
- Full-page heights scale proportionally with viewport width (e.g., homepage: 7473px desktop → 12685px mobile), consistent with expected reflow of a content-heavy long-form page rather than a layout defect.
- **Status: Pass.**

## Typography
- Consistent use of the brand typeface across headings/body copy; heading hierarchy (H1 hero → H2 section → H3 card title) is visually consistent site-wide.
- **Status: Pass.**

## Spacing
- Section padding and card gutters are visually consistent across all pages and breakpoints inspected.
- **Status: Pass.**

## Brand Consistency
- Navy (`#0C1929`)/cyan (`#03A7C7`) palette applied consistently across hero sections, CTAs, badges, and icons.
- Logo mark (P-glyph + cyan square) renders correctly in header (light variant on dark nav, dark variant on light backgrounds) and footer.
- **Status: Pass.**

## CTA Clarity
- Primary CTA ("Request Assessment") is present and visually consistent on every page's final section and header.
- Secondary CTAs ("Explore PBRS™," "View Platform," "Book a Demo") are clearly differentiated (outline/ghost style vs. filled primary).
- **Status: Pass.**

---

## Summary Table

| Area | Critical | Major | Minor | Enhancement |
|---|---|---|---|---|
| Homepage | 0 | 0 | 0 | 0 |
| Platform | 0 | 0 | 0 | 0 |
| PBRS | 0 | 0 | 0 | 0 |
| Products | 0 | 0 | 0 | 0 |
| Solutions | 0 | 0 | 0 | 0 |
| Resources | 0 | 0 | 0 | 0 |
| About | 0 | 0 | 0 | 0 |
| Contact | 0 | 0 | 0 | 1 (backend wiring follow-up) |
| Navigation | 0 | 0 | 0 | 0 |
| Footer | 0 | 0 | 0 | 0 |
| Mobile | 0 | 0 | 0 | 0 |
| Typography | 0 | 0 | 0 | 0 |
| Spacing | 0 | 0 | 0 | 0 |
| Brand | 0 | 0 | 0 | 0 |
| CTAs | 0 | 0 | 0 | 0 |

**Total: 0 Critical, 0 Major, 0 Minor, 1 Enhancement.**

No launch-blocking issues identified in this visual pass.
