# PHX-CERT-002 — Certification Level Implementation Report

**Task ID:** PHX-CERT-002
**Implements:** `PBRS_CERTIFICATION_ARCHITECTURE_PHX_CERT_001.md`, `PBRS_CERTIFICATION_UI_COPY_GUIDE_PHX_CERT_001.md`
**Source:** `PHX-PLATFORM-005-EVIDENCE-TRACEABILITY.tar`
**Scope:** Frontend / data-presentation implementation sprint. No scoring-model, backend, auth, or platform-redesign changes.

---

## 1. Files Changed

### New file
- `apps/platform/src/lib/certification-levels.ts` — pure Certification Level / Internal Tier helper module (Task 1).

### Modified files
- `apps/platform/src/lib/view-models.ts` — additive fields on `PassportListItemViewModel`, `CertificationListItemViewModel`, `ReportListItemViewModel` (optional), `AssessmentDetailViewModel`.
- `apps/platform/src/lib/api-adapters.ts` — imports certification-level helpers; adds `buildCertificationDisplay()`; populates new view-model fields in `buildPassportListItems()`, `buildCertificationListItems()`, `buildAssessmentDetail()`.
- `apps/platform/src/lib/api-client.ts` — re-exports certification-level types/helpers (`PBRSCertificationLevel`, `PBRSInternalTier`, `certificationLevelFromScore`, `certificationLevelShortLabel`, `certificationStatusLabel`, `isCertificationLevelEligible`, `eligibilityLabelFromScore`, `shouldDisplayInternalTier`, `PBRS_CERTIFICATION_SAFE_DISCLAIMER`) so pages/components depend on `api-client.ts`, consistent with existing project convention.
- `apps/platform/src/app/(platform)/certifications/page.tsx` — disclaimer text now uses the exact safe-language string.
- `apps/platform/src/app/(platform)/passports/page.tsx` — adds the safe-language disclaimer; description text no longer says "certification status" (now "certification level").
- `apps/platform/src/app/(platform)/assessments/[assessmentId]/page.tsx` — passes `eligibleCertificationLabel` into `AssessmentHeader`.
- `apps/platform/src/components/PassportCard.tsx` — rewritten to lead with `Certification Level: {label}` / `Pending Certification`, with `Internal Tier: {tier}` as an optional, suppressed-when-contradictory secondary line.
- `apps/platform/src/components/AssessmentTable.tsx` — adds an optional "Certification Level" column, rendered only when every row is a `CertificationListItemViewModel` (i.e., only on `/certifications`'s certified-assets table). `/assessments` and the dashboard render unchanged.
- `apps/platform/src/components/AssessmentHeader.tsx` — adds an optional `eligibilityLabel` prop, rendered as a de-emphasized "Certification Eligibility" row.
- `apps/platform/src/lib/mock-fixtures/activity.ts`, `apps/platform/src/lib/mock-fixtures/audit.ts` — corrected a pre-existing fixture-text bug (see §7).

### Unchanged (verified, not touched)
- `packages/core/src/index.ts` (`PBRS_DIMENSIONS`, `CertificationTier`, `gradeFromScore`, `tierFromGrade`, `formatCertificationId`)
- `packages/pbrs/src/index.ts` (`generateScore`, `calculateOverallScore`)
- `apps/platform/src/lib/sample-data.ts` (`CERTIFICATION_LEVELS`, dimension data, scoring inputs)
- `apps/platform/src/components/CertificationCard.tsx`, `AssessmentCard.tsx`, `ReportCard.tsx`
- `apps/website`, `apps/dashboard` — untouched, per platform-sprint convention.

---

## 2. `certificationLevelFromScore` Helper Summary

`apps/platform/src/lib/certification-levels.ts` is a pure module (no imports of `sample-data.ts`, no side effects) exporting:

- `PBRSCertificationLevel` — `'None' | 'PBRS Foundation' | 'PBRS Practitioner' | 'PBRS Enterprise'`
- `PBRSInternalTier` — presentation alias of `CertificationTier`
- `certificationLevelFromScore(score)` — Enterprise ≥ 92, Practitioner ≥ 83, Foundation ≥ 70, else `'None'`. Matches `CERTIFICATION_LEVELS` in `sample-data.ts` and the Architecture doc §6.1 exactly.
- `certificationLevelShortLabel(level)` — `Foundation` / `Practitioner` / `Enterprise` / `Not Yet Certified`.
- `certificationStatusLabel(level, hasCertification)` — `Pending Certification` when not granted; `"{level} Certified"` otherwise.
- `isCertificationLevelEligible(score)` — `score >= 70`.
- `eligibilityLabelFromScore(score)` — `"Eligible for {level}"` or `"Not eligible — remediation required"`.
- `shouldDisplayInternalTier(score, level, internalTier, context)` — implements the 70–72 gap workaround (§4 below).
- `PBRS_CERTIFICATION_SAFE_DISCLAIMER` — the exact standing disclaimer string.

No dimension score, weight, or `generateScore()`/`tierFromGrade()` logic is read, duplicated, or altered by this module.

---

## 3. View Model Changes

All changes are additive; no existing field was removed or renamed.

| View model | New fields |
|---|---|
| `PassportListItemViewModel` | `certificationLevel`, `certificationLevelLabel`, `internalTier`, `showInternalTier` |
| `CertificationListItemViewModel` | `certificationLevel`, `certificationLevelLabel`, `internalTier`, `showInternalTier` |
| `ReportListItemViewModel` | `certificationLevel?`, `certificationLevelLabel?` (optional — not populated this sprint; no existing report surface shows certification status text, so there was nothing to wire per Task 6's "only update visible UI labels if they exist") |
| `AssessmentDetailViewModel` | `eligibleCertificationLevel?`, `eligibleCertificationLabel?` |

---

## 4. 70–72 Gap Workaround Implementation

Per Architecture doc §6.4 and UI Copy Guide §3/§5: scores 70–72 are Foundation-eligible at the Certification Level but resolve to `Not Certified` at the Internal Tier (Bronze begins at 73).

`shouldDisplayInternalTier()` returns `false` whenever `score` is in `[70, 73)` **and** the derived level is `PBRS Foundation` **and** the internal tier is `Not Certified` — for every context, including internal/admin metadata views, since the value itself is the documented, unresolved gap rather than a display preference. `buildCertificationDisplay()` calls this with `context: 'client'` for all current call sites (`PassportCard`, `/certifications`).

`eligibilityLabelFromScore()` implements the parallel copy-level rule for assessment eligibility: for the 70–72 band it returns `"Eligible for PBRS Foundation"` with no Internal Tier reference at all, matching UI Copy Guide §3.

No sample asset in this build happens to score in the 70–72 band, so the workaround was verified by direct unit-level reasoning over `certification-levels.ts` and confirmed via `pnpm type-check` rather than a live rendered example. The logic is score-driven, not asset-specific, so it applies correctly regardless of which asset lands in that band.

---

## 5. Internal Tier Handling

- Internal Tier (`Bronze | Silver | Gold | Platinum | Not Certified`) remains sourced from the unchanged `CertificationTier` type and `score.summary.tier` / `PBRSCertificationRecord.tier`.
- It is rendered only as secondary metadata:
  - `PassportCard`: a small, muted `Internal Tier: {tier}` line under the primary `Certification Level` status, shown only when a certification has been granted and `showInternalTier` is true.
  - Not shown on `/certifications` cards or the certified-assets table at all (kept out entirely rather than shown de-emphasized, per Architecture doc §8's "may appear... never above or in place of").
- `certification-levels.ts`'s `shouldDisplayInternalTier()` is the single choke point for the 70–72 suppression rule, so no page/component re-implements that condition.

---

## 6. Safe Wording Check

- `PBRS_CERTIFICATION_SAFE_DISCLAIMER` (exact UI Copy Guide §5 primary string) is exported from `certification-levels.ts` and re-exported via `api-client.ts`.
- `/certifications` page's `AlphaNotice` now uses this exact string (previously used a paraphrase).
- `/passports` page now surfaces the same exact string via an inline `AlphaNotice`, since the page renders Certification Level on every card.
- No prohibited wording (`certified by Phoenix` unqualified, `audit approved`, `regulator ready`, `ISO aligned certification`, `legally certified`, `guaranteed compliant`) was introduced.

---

## 7. Terminology Scan (Task 9) — see also the QA report

A pre-existing fixture-text bug was found and corrected: `mock-fixtures/activity.ts` and `mock-fixtures/audit.ts` both described `ast-001`'s (Executive AI Brief) certification grant as **"Granted PBRS Platinum certification"** — a string that conflates the two vocabularies (no valid term is "PBRS Platinum": Platinum is Internal-Tier-only and never takes a "PBRS" prefix; the client-facing label is "PBRS Enterprise" / "PBRS Foundation" / "PBRS Practitioner" only). Independently, `ast-001`'s actual computed values (`overall` ≈ 92.9, `tier` = `Gold` via `tierFromGrade(gradeFromScore(92.9))` = `tierFromGrade('A-')`) don't even match "Platinum" — the fixture string was already factually stale as well as vocabulary-incorrect. Both fixture strings were corrected to **"Granted PBRS Enterprise certification..."**, matching the asset's real Certification Level. This is a copy-text fix inside mock fixtures only; no score, weight, or `generateScore()` change.

---

## 8. Known Limitations

- No sample asset falls in the 70–72 gap band, so the suppression workaround is not visually exercised in this build's screenshots — verified by code-path reasoning instead.
- `ReportListItemViewModel`'s new `certificationLevel(Label)` fields are unpopulated this sprint since no current report surface renders certification status text (see §3). Wiring is additive and ready for a future sprint that builds report content.
- Internal Tier is not exposed anywhere on `/certifications` (cards or table) even as muted metadata — this sprint chose to omit it there entirely rather than add a new de-emphasized UI element, since Architecture doc §8 treats it as optional ("may appear... never as primary").
- The underlying three-way Internal-Tier-vs-Standard-vs-client-facing-level threshold disagreement (Architecture doc §6.4, §14) remains unresolved, as instructed — this sprint implements the interim display workaround only.
