# PHX-CERT-003 — Certification Threshold Harmonization: Implementation Report

**Task ID:** PHX-CERT-003
**Implements:** `PHX_CERT_003_THRESHOLD_DECISION.md` (Option A)
**Source:** `PHX-CERT-002-CERTIFICATION-LEVEL-IMPLEMENTATION.tar`
**Reference docs:** `PHX-CERT-001-R1-CERTIFICATION-TIER-ARCHITECTURE.tar`, `PHX-STD-PBRS-ALIGN-001.tar`
**Scope:** Threshold harmonization only. No scoring-model, backend, auth, or platform-redesign changes.

---

## 1. Files Changed

### Modified files

| File | Change |
|---|---|
| `packages/core/src/index.ts` | Added `tierFromScore(score: number): CertificationTier` (new system of record for Internal Tier derivation). Marked `tierFromGrade()` `@deprecated` with an explanatory comment; function body unchanged. |
| `packages/pbrs/src/index.ts` | `generateScore()` now computes `tier` via `tierFromScore(overall)` instead of `tierFromGrade(gradeFromScore(overall))`. Import changed from `tierFromGrade` to `tierFromScore`. No other change to `generateScore()`, `calculateOverallScore()`, or `PBRS_MATURITY_LEVELS`. |
| `apps/platform/src/lib/certification-levels.ts` | `shouldDisplayInternalTier()` simplified — the 70–72 contradiction-suppression branch removed (now unreachable, since the source contradiction is resolved); docstring rewritten to document resolution rather than workaround. Function signature unchanged (all four parameters retained for call-site stability). `certificationLevelFromScore()`, `FOUNDATION_MIN_SCORE`/`PRACTITIONER_MIN_SCORE`/`ENTERPRISE_MIN_SCORE`, `certificationLevelShortLabel()`, `certificationStatusLabel()`, `isCertificationLevelEligible()`, `eligibilityLabelFromScore()`, `PBRS_CERTIFICATION_SAFE_DISCLAIMER` — all unchanged. |
| `apps/platform/src/lib/view-models.ts` | Doc-comment only: updated `PassportListItemViewModel`'s field comment to reflect the resolved gap. No type or field change. |
| `apps/platform/src/lib/api-adapters.ts` | Doc-comment only: updated the comment above `eligibleCertificationLevel` in `buildAssessmentDetail()` to reflect the resolved gap. No logic change. |
| `apps/platform/src/components/PassportCard.tsx` | Doc-comment only: updated the comment above `primaryStatusLabel` to reflect the resolved gap. No rendering/logic change. |

### Unchanged (verified, not touched)

- `packages/core/src/index.ts` — `PBRS_DIMENSIONS`, dimension weights, `gradeFromScore()`, `PBRSGrade`, `CertificationTier` type, `formatCertificationId()`, all contract re-exports.
- `packages/pbrs/src/index.ts` — `calculateOverallScore()`, `SAMPLE_PBRS_SCORE`, `PBRS_MATURITY_LEVELS`.
- `apps/platform/src/lib/sample-data.ts` — `CERTIFICATION_LEVELS`, dimension data, all scoring inputs. (`score.tier` values for individual assets change only insofar as they're re-derived through the now-updated `generateScore()` — see §6 for the two affected assets, and note neither actually crosses a boundary.)
- `apps/platform/src/lib/api-client.ts` — no changes; already re-exports `certification-levels.ts` helpers unchanged.
- `apps/platform/src/components/CertificationCard.tsx`, `AssessmentCard.tsx`, `ReportCard.tsx`, `AssessmentTable.tsx`, `AssessmentHeader.tsx` — no changes needed; all consume already-composed view-model fields, not raw thresholds.
- `apps/website`, `apps/dashboard` — untouched, per platform-sprint convention.

---

## 2. Decision Taken

**Option A** — lower the Internal Tier Bronze floor from 73 to 70 in `@phoenix/core`. Full rationale in `PHX_CERT_003_THRESHOLD_DECISION.md`.

## 3. Exact Threshold Changes

| Tier | Before | After |
|---|---|---|
| Platinum | ≥ 93 | ≥ 93 *(unchanged)* |
| Gold | ≥ 87 | ≥ 87 *(unchanged)* |
| Silver | ≥ 80 | ≥ 80 *(unchanged)* |
| Bronze | ≥ 73 | **≥ 70** |
| Not Certified | < 73 | **< 70** |

Certification Level thresholds (Foundation ≥ 70, Practitioner ≥ 83, Enterprise ≥ 92) are unchanged.

## 4. Code Changes

### `packages/core/src/index.ts`

```ts
/**
 * @deprecated Since PHX-CERT-003, PBRSScore.tier is derived directly from
 * the overall score via tierFromScore(), not from this function. ...
 * Do not wire this back into generateScore(): it reintroduces the resolved
 * 70–72 Certification Level / Internal Tier gap ...
 */
export function tierFromGrade(grade: PBRSGrade): CertificationTier {
  if (grade === 'A+' || grade === 'A') return 'Platinum';
  if (grade === 'A-' || grade === 'B+') return 'Gold';
  if (grade === 'B' || grade === 'B-') return 'Silver';
  if (grade === 'C+' || grade === 'C') return 'Bronze';
  return 'Not Certified';
}

/**
 * Derives the PBRS Internal Tier directly from the overall score (0–100).
 * This is the system of record for PBRSScore.tier as of PHX-CERT-003.
 */
export function tierFromScore(score: number): CertificationTier {
  if (score >= 93) return 'Platinum';
  if (score >= 87) return 'Gold';
  if (score >= 80) return 'Silver';
  if (score >= 70) return 'Bronze';
  return 'Not Certified';
}
```

`tierFromGrade()`'s body is byte-for-byte unchanged — it is deprecated, not deleted, and remains available for any external/future caller that genuinely wants the grade-based mapping, with an explicit warning against reconnecting it to scoring.

### `packages/pbrs/src/index.ts`

```ts
// before
const grade = gradeFromScore(overall);
const tier = tierFromGrade(grade);

// after
const grade = gradeFromScore(overall);
const tier = tierFromScore(overall);
```

`grade` is still computed and still returned on `PBRSScore.grade` — only `tier`'s derivation path changed, from grade-mediated to score-direct.

## 5. Helper Changes

`shouldDisplayInternalTier()` in `certification-levels.ts` no longer contains a `isGapBand`/`isContradictory` check. It now unconditionally returns `true` (all four parameters retained in the signature — `score`, `level`, `internalTier`, `context` — for call-site stability and to leave room for a future context-based rule without a breaking signature change). This is a safe simplification: the case it existed to suppress (Foundation-eligible + Internal-Tier-Not-Certified) can no longer be produced by `tierFromScore()`, since Bronze and Foundation now share the same floor (70).

No other helper in `certification-levels.ts` changed.

## 6. Boundary Verification

See `PHX_CERT_003_THRESHOLD_VERIFICATION.md` for the full table. Summary: all 13 required boundary cases (69.9 through 93) produce the exact required Certification Level / Internal Tier pairing, with the 70–72 band now correctly resolving to PBRS Foundation + Bronze instead of the prior contradictory PBRS Foundation + Not Certified.

Of the six existing sample assets, none crosses a tier boundary as a result of this change (closest is `ast-004` at 69.05, unaffected on both sides of 70). `ast-001` (92.90) and `ast-005` (87.40) are worth noting only because their exact overall scores were recalculated precisely during verification and confirmed against the shipped weighted formula — no rounding or dimension-weight discrepancy was found.

## 7. Impact on `/certifications`

No redesign. The page renders `CERTIFICATION_LEVELS` (Foundation/Practitioner/Enterprise cards) and `CertificationListItemViewModel` rows unchanged in structure. The only possible behavioral difference is that a hypothetical future asset scoring 70–72 would now show Internal Tier "Bronze" (if an internal-context surface ever renders it) instead of having that field suppressed — no current fixture triggers this.

## 8. Impact on `/passports`

`PassportCard` renders `internalTier`/`showInternalTier` exactly as before structurally. `showInternalTier` now always evaluates to `true` rather than being conditionally suppressed, but since `certification` must also be truthy for the Internal Tier line to render (`{certification && showInternalTier && (...)}`), and no sample asset falls in the affected band, there is no visible change in the current build. Verified via screenshot (see `platform-cert003-desktop-contact-sheet.jpg`).

## 9. Impact on Assessment Detail Eligibility (`/assessments/[assessmentId]`)

`eligibleCertificationLevel` / `eligibleCertificationLabel` (via `certificationLevelFromScore()` and `eligibilityLabelFromScore()`) are entirely unaffected — those functions never read Internal Tier and were not changed. Verified via screenshot at `/assessments/ast-001`.

## 10. Impact on Reports

`/reports` does not render Certification Level or Internal Tier text in the current build (per PHX-CERT-002 §3, `ReportListItemViewModel`'s certification fields are optional and unpopulated this sprint). No change. Verified via screenshot.

## 11. Known Limitations

- No sample fixture currently scores in the 70–72 band, so the fix could not be observed live in a rendered screenshot — only verified via the boundary table and type/build checks. This mirrors the same limitation noted in PHX-CERT-002.
- `PBRS_STANDARD_V1_0.md` §15.2's "typical" tier-band table (Bronze ≥ 55, Silver ≥ 70, Gold ≥ 83, Platinum ≥ 90) still does not match the platform's actual code-level thresholds (before or after this sprint). Reconciling the Standard document's tier table remains an open item tracked in `PBRS_STANDARD_ALIGNMENT_NOTES_PHX_STD_PBRS_ALIGN_001.md` §5 and is explicitly out of scope for PHX-CERT-003 (see `PHX_CERT_003_THRESHOLD_DECISION.md` §6).
- `tierFromGrade()` remains in the codebase, unused, as a deprecated function. A future cleanup sprint could consider removing it once confirmed there are no external consumers, but removal was judged out of scope and unnecessary risk for a threshold-harmonization sprint.
