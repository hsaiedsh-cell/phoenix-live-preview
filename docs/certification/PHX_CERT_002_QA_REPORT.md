# PHX-CERT-002 — QA Report

**Task ID:** PHX-CERT-002
**Build environment:** pnpm 8.15.9 (corepack), Node 22.22.2, Next.js 14.2.35

---

## 1. Build Status

| Check | Command | Result |
|---|---|---|
| Install | `pnpm install` | ✅ Pass — 378 packages, lockfile unchanged |
| Type-check | `pnpm --filter=./apps/* type-check` | ✅ Pass — `apps/platform`, `apps/website`, `apps/dashboard` all clean |
| Lint | `pnpm --filter=./apps/* lint` | ✅ Pass — no ESLint warnings or errors on any of the three apps |
| Build | `pnpm --filter=./apps/* build` | ✅ Pass — all three apps compile and generate static pages successfully |

Re-run in full after the mock-fixture text correction (§7 of the implementation report) — all four checks passed again with no new errors.

---

## 2. PBRS Scoring Model Integrity Check

- `packages/core/src/index.ts` — `PBRS_DIMENSIONS`, `gradeFromScore()`, `tierFromGrade()`, `formatCertificationId()`: **byte-for-byte unchanged** (verified via `diff` against the original `PHX-PLATFORM-005-EVIDENCE-TRACEABILITY.tar` source).
- `packages/pbrs/src/index.ts` — `generateScore()`, `calculateOverallScore()`: **unchanged**.
- `apps/platform/src/lib/sample-data.ts` — dimension inputs, `CERTIFICATION_LEVELS`, `toSimpleGrade()`: **unchanged**.

## 3. Six-Dimension Integrity Check

`PBRS_DIMENSIONS` (Accuracy 20%, Compliance 20%, Brand Alignment 15%, Structure 15%, Consistency 15%, Completeness 15%) is untouched. No new or removed dimension. No weight changed. Confirmed via `diff` (no changes to `packages/core/src/index.ts`).

## 4. Derived Signals Unchanged

`DERIVED_SIGNALS` (`riskLevel`, `confidenceIndex`, `automationReadiness`) in `packages/core/src/index.ts`: unchanged. Not touched or reinterpreted by any certification-level helper.

## 5. Certification Level / Internal Tier Separation Check

- `PBRSCertificationLevel` (`None | PBRS Foundation | PBRS Practitioner | PBRS Enterprise`) and `PBRSInternalTier`/`CertificationTier` (`Not Certified | Bronze | Silver | Gold | Platinum`) are two distinct exported types in `certification-levels.ts` — never merged into one union, never assumed to move in lockstep (per Architecture doc §6.3–§6.4).
- `certificationLevelFromScore()` derives Certification Level purely from `score.summary.overall` / `scoreSnapshot`; it never reads or infers from `CertificationTier`.
- Internal Tier is always passed through unchanged from `score.summary.tier` / `PBRSCertificationRecord.tier` — never derived or recomputed from the Certification Level.

## 6. Bronze Handling Check

- `grep` confirms `Bronze` appears only in: internal `PBRSInternalTier`/`CertificationTier` type definitions, the internal certification-ID suffix logic in `sample-data.ts`/`api-client.ts` (`BZ` suffix), and code comments — never as a client-facing headline, card, or primary label anywhere in `apps/platform/src/app` or `apps/platform/src/components`.
- No "PBRS Candidate" or "PBRS Baseline" string exists anywhere in the codebase (`grep` returned zero matches for both).

## 7. UI Label Check

- `grep -rn "PBRS Foundation|PBRS Practitioner|PBRS Enterprise"` across `apps/platform/src` shows consistent usage: card names (`CertificationCard`), `certificationLevelFromScore()`'s literal returns, and rendered labels (`PassportCard`, `AssessmentTable`, `AssessmentHeader` eligibility line). No page uses "Foundation"/"Practitioner"/"Enterprise" without the "PBRS" prefix in a primary headline (short-form-only tables use `certificationLevelShortLabel()`, which is an intentional, documented exception per UI Copy Guide §2's "List/table view short labels").
- `grep -rn "\bBronze\b|\bSilver\b|\bGold\b|\bPlatinum\b"` across `apps/platform/src`: all matches are (a) internal type definitions in `certification-levels.ts`, (b) the internal certification-ID suffix logic in `sample-data.ts`/`api-client.ts`, (c) one hardcoded internal `tier: 'Gold'` value inside the mock `grantCertification()` mutation stub in `api-client.ts` (never rendered — it's a mock API response object, not UI text), and (d) the now-corrected `PassportCard`'s optional, de-emphasized `Internal Tier: {tier}` secondary line. **Zero matches** in any primary/headline UI position.
- `grep -rn "Not Certified"` across `apps/platform/src`: all matches are internal type definitions/comments in `certification-levels.ts`, and the `PhoenixPassport.certificationStatus` type in `sample-data.ts` (whose `'Not Certified'` value is declared but never actually assigned — data only ever sets `'Certified'` or `'Pending Certification'` — and the field itself is never rendered directly to any page; it's consumed only internally to derive `passport.status`). **No client-facing "Not Certified" text is rendered.**
- **Fixture-text finding:** `mock-fixtures/activity.ts` and `mock-fixtures/audit.ts` previously read "Granted PBRS Platinum certification" — a vocabulary-conflating, factually-stale string (the asset's real values are Certification Level "PBRS Enterprise" / Internal Tier "Gold", not "Platinum"). **Corrected** to "Granted PBRS Enterprise certification..." in both files.

## 8. Report / Passport / Certification Page Check

| Page | Leads with | Internal Tier | Safe disclaimer |
|---|---|---|---|
| `/certifications` | `PBRS Foundation` / `PBRS Practitioner` / `PBRS Enterprise` cards; `Certification Level` column in the certified-assets table | Not shown | ✅ exact string |
| `/passports` | `Certification Level: {level}` or `Pending Certification` | Optional secondary line, suppressed for the 70–72 gap | ✅ exact string (new) |
| `/reports` | Unchanged — no certification-level text currently rendered on this page (see Implementation Report §3, §8 limitations) | N/A | N/A (nothing certification-related shown) |
| `/assessments/[id]` | `Certification Eligibility: Eligible for {level}` / `Not eligible — remediation required` | N/A (eligibility only, no granted certification concept here) | Not applicable (this page shows eligibility, not a granted certification) |

## 9. No Third-Party / Regulatory Implication Check

`grep` for `ISO-certified`, `government-approved`, `independently audited`, `regulator ready`, `guaranteed compliant`, `legally certified` across `apps/platform/src`: zero matches. The only disclaimer language present is the approved safe string.

## 10. Direct Sample-Data Import Check (Task 10)

```
grep -rln "sample-data" apps/platform/src --include="*.tsx" --include="*.ts"
```
Matches: `mock-ids.ts`, `view-models.ts`, `mock-fixtures/evidence.ts`, `api-client.ts`, `certification-levels.ts`, `api-adapters.ts` — but a follow-up check of actual `import ... from './sample-data'` statements shows **only `api-client.ts` and `api-adapters.ts` contain real import statements**; every other match is a comment/docstring mentioning `sample-data.ts` by name. Confirmed via:

```
grep -rn "^import.*sample-data\|from './sample-data'" apps/platform/src --include="*.tsx" --include="*.ts"
→ api-client.ts:63, api-client.ts:120, api-adapters.ts:64
```

A further check confirms **zero** matches under `apps/platform/src/app` or `apps/platform/src/components`. **Pass.**

---

## 11. Known Limitations

- 70–72 gap band not exercised by any live sample asset (see Implementation Report §4, §8).
- `ReportListItemViewModel`'s new optional fields are unpopulated — no current report UI shows certification text to update.
- Visual regression screenshots (Task 13) cover `/certifications`, `/passports`, `/reports`, and one assessment detail route (`ast-001-assessment`, a `PBRS Enterprise`-level certified asset) at desktop/tablet/mobile widths; they do not include a 70–72-band example since none exists in sample data.
