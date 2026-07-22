# Platform QA Report — PHX-PLATFORM-001

**Release:** Phoenix Platform Alpha
**Date:** 2026-07-07

---

## 1. Route Checklist

| Route | Status | Notes |
|---|---|---|
| `/` | ✅ Pass | Public landing screen with CTAs to `/login` and `/dashboard`. No auth redirect logic (by design — Alpha, UI-only). |
| `/login` | ✅ Pass | UI-only login card, SSO placeholder, Alpha notice present. |
| `/dashboard` | ✅ Pass | Executive summary cards, PBRS dimension overview, static trend, recent assessments table, action panel. |
| `/assessments` | ✅ Pass | Filterable list (status, department, risk, grade), card grid, empty state, New Assessment CTA. |
| `/assessments/new` | ✅ Pass | 5-step stepper (Asset Details → Business Context → Evidence & Sources → PBRS Review → Output Decision), right-rail PBRS preview panel, Alpha notice. |
| `/passports` | ✅ Pass | Passport cards with ID, score, grade, certification status, validity, hash placeholder, "Verification portal coming soon." |
| `/certifications` | ✅ Pass | Three certification levels (Foundation/Practitioner/Enterprise), eligible/certified/expiring counts, certified-assets table, Alpha notice re: no third-party authority claim. |
| `/reports` | ✅ Pass | Five report cards (2 Available, 3 Coming Soon), no real downloads wired. |
| `/settings` | ✅ Pass | Workspace, scoring profile (six PBRS dimensions + weights), notification prefs, brand profile placeholder, data retention placeholder — all read-only/non-functional. |

**Result: 8/8 required routes present and functional as UI-only screens.**

---

## 2. Component Checklist

| Component | Status |
|---|---|
| PlatformShell | ✅ Implemented |
| PlatformSidebar (+ MobileSidebar drawer) | ✅ Implemented |
| PlatformTopbar | ✅ Implemented |
| WorkspaceHeader | ✅ Implemented |
| StatCard | ✅ Implemented |
| AssessmentTable | ✅ Implemented |
| AssessmentCard | ✅ Implemented |
| PBRSScorePanel | ✅ Implemented (wraps shared `@phoenix/ui` `PBRSScorePreview` + local `DimensionScoreGrid`) |
| DimensionScoreGrid | ✅ Implemented |
| RiskBadge / GradeBadge / StatusBadge | ✅ Implemented (`Badges.tsx`) |
| PassportCard | ✅ Implemented |
| CertificationCard | ✅ Implemented |
| ReportCard | ✅ Implemented |
| EmptyState | ✅ Implemented |
| AlphaNotice | ✅ Implemented (default + inline variants) |
| Stepper | ✅ Implemented |
| FormField | ✅ Implemented (text / textarea / select) |
| SettingsPanel | ✅ Implemented |

All components are TypeScript, use semantic markup (`nav`, `main`, `header`, `table`, `label`/`for` pairing on form fields, `aria-current` on active nav items, `aria-label` on icon-only buttons).

---

## 3. PBRS Model Integrity Check

- ✅ Six-dimension model confirmed unchanged in `packages/core/src/index.ts`: Accuracy (20%), Compliance (20%), Brand Alignment (15%), Structure (15%), Consistency (15%), Completeness (15%).
- ✅ Derived signals (Risk Level, Confidence Index, Automation Readiness) sourced from `@phoenix/pbrs`'s `generateScore()` — not re-derived or hardcoded in the platform app.
- ✅ No occurrence of "Business Logic" or "Clarity" as scored dimensions anywhere in `apps/platform`.
- ✅ Settings page pulls dimension labels/weights live from `PBRS_DIMENSIONS` (`@phoenix/core`) rather than a hardcoded copy — the six-dimension model shown to the user cannot drift from the source of truth.
- ✅ Sample asset scores are hand-authored per dimension for narrative variety, but overall score, grade, tier, confidence index, and risk level are all computed via `generateScore()` — no duplicated scoring math.

---

## 4. Responsive Check

Screenshots captured via Playwright 1.56.0 against a production `next start` build at three viewports: 1440px (desktop), 834px (tablet), 390px (mobile), across all 8 platform routes (24 total screenshots).

- ✅ Desktop: full sidebar + topbar layout, multi-column grids collapse appropriately.
- ✅ Tablet (834px): sidebar collapses to mobile hamburger nav (breakpoint is `lg` / 1024px) — this is expected behavior, not a defect; 834px is treated as a compact/mobile-nav breakpoint per the design's `lg:flex` sidebar rule.
- ✅ Mobile (390px): hamburger nav opens a slide-in drawer with overlay; stat cards, tables, and forms stack to single/double column; no horizontal overflow observed.
- ✅ `/assessments` table view uses `overflow-x-auto` on mobile for the data table where card layout isn't already substituted.

Contact sheets generated: `platform-desktop-contact-sheet.jpg`, `platform-tablet-contact-sheet.jpg`, `platform-mobile-contact-sheet.jpg`. Interactive review: `Phoenix_Platform_Interactive_Review.html`.

---

## 5. Known Limitations

- No real authentication — `/login` always proceeds to `/dashboard` regardless of input, per the Alpha brief.
- No backend — all data in `SAMPLE_ASSETS`/`SAMPLE_PASSPORTS`/`SAMPLE_REPORTS` is static, defined in `src/lib/sample-data.ts`.
- `/assessments/new` does not persist or score submitted input; the PBRS Review step shows an illustrative sample score (`SAMPLE_PBRS_SCORE` from `@phoenix/pbrs`), not a calculation of user input.
- Report and passport "download"/"export" actions are non-functional and labeled accordingly (`Coming Soon`, "Verification portal coming soon.").
- Settings page toggles and fields are display-only; no state persists across reload.
- Account/client switcher in the topbar is a static placeholder (opens no menu yet).

---

## 6. Launch Blockers

None for an Alpha/UI-preview release. The following would need to be resolved before any beta or production positioning:

- Real authentication and session handling.
- A backend/API layer to replace `src/lib/sample-data.ts`.
- Real PBRS scoring wired to `/assessments/new` submissions.
- Persisted settings and notification preferences.
- Report generation and file export.
- Passport verification portal (publicly referenced but not built).

---

## 7. Next Recommended Sprint

1. **PHX-PLATFORM-002 — Backend Contract Definition:** define the API/data contract for assets, passports, and certifications so `sample-data.ts` can be swapped for a real data source without UI changes.
2. **PBRS Standard Alignment Sprint** (already flagged in prior sprints): update `PHX-STD-PBRS-001` to reflect the six-dimension model — this platform build reinforces the model is correctly implemented in code, but the standards document itself is still pending reconciliation.
3. Wire `/contact` form backend (carried over from PHX-WEB-005) and `siteConfig` env var integration — both remain outstanding from the website sprint and are unrelated to this platform build but still open.
