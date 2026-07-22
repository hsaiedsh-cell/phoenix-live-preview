# PHX-CERT-003 — Certification Threshold Harmonization: Decision Document

**Task ID:** PHX-CERT-003
**Resolves:** The 70–72 Certification Level / Internal Tier gap identified in `PBRS_CERTIFICATION_ARCHITECTURE_PHX_CERT_001.md` §6.4 and worked around in PHX-CERT-002.
**Scope:** Threshold harmonization only. No PBRS scoring, dimension, weight, or aggregate-formula changes.

---

## 1. Executive Decision

**Option A is adopted.** The PBRS Internal Tier floor for **Bronze** is lowered from **73 to 70** in `@phoenix/core`. Certification Level thresholds (PBRS Foundation ≥ 70, PBRS Practitioner ≥ 83, PBRS Enterprise ≥ 92) are unchanged. Silver (≥ 80), Gold (≥ 87), and Platinum (≥ 93) Internal Tier floors are unchanged.

This closes the gap by making the two vocabularies always agree on their lower boundary: a score of 70 now produces **PBRS Foundation** (Certification Level) and **Bronze** (Internal Tier) simultaneously, with no possible contradictory pairing.

## 2. Current Gap

Prior to this sprint:

| Score band | Certification Level (client-facing) | Internal Tier (system metadata) |
|---|---|---|
| 70–72 | PBRS Foundation | **Not Certified** |
| 73–79 | PBRS Foundation | Bronze |

A score of 70, 71, or 72 was simultaneously "Foundation-eligible" at the Certification Level and "Not Certified" at the Internal Tier — a genuine contradiction between two vocabularies that are meant to describe the same underlying readiness. PHX-CERT-002 addressed this only by suppressing the Internal Tier display for that exact band (`shouldDisplayInternalTier()` in `certification-levels.ts`), which hid the contradiction from the UI without resolving its source, which is that `@phoenix/core`'s `tierFromGrade(gradeFromScore(score))` path assigns grade `C-` (70–72) to `'Not Certified'`, one full letter grade below Bronze's former `C`/`C+` floor of 73.

## 3. Options Evaluated

### Option A — Lower Bronze floor from 73 to 70 (**recommended and adopted**)
Change Internal Tier derivation so Bronze begins at the same score (70) as PBRS Foundation.

- **Pro:** Resolves the contradiction at the source, not just in the UI. Bronze stays internal-only, so no weak certification level becomes client-visible. Foundation/Practitioner/Enterprise are untouched. No PBRS scoring change.
- **Con:** Requires a code change to tier-derivation logic (not to scoring), and a documented deprecation of the `tierFromGrade()` code path used by `generateScore()`.

### Option B — Raise PBRS Foundation floor from 70 to 73
Change the client-facing Certification Level threshold instead of the internal one.

- **Pro:** No `@phoenix/core` tier-derivation change; only `certification-levels.ts`/`sample-data.ts` threshold constants move.
- **Con:** Client-facing regression: assets scoring 70–72 that are currently eligible for PBRS Foundation would lose that eligibility. This is a more visible, more consequential change than an internal-metadata adjustment, and it moves a number (70) that appears in the PBRS Standard's own B-grade band floor (`PBRS_STANDARD_V1_0.md` §7.5, "B: 70–84"), creating a *new* inconsistency between the Certification Level and the Standard's own readiness-grade banding. Rejected.

### Option C — Keep the gap permanently and document it
Leave both thresholds as-is; document the 70–72 band as a known, permanent, intentional gap.

- **Pro:** Zero code change.
- **Con:** Leaves a standing contradiction in the data model indefinitely, relying on UI suppression (`shouldDisplayInternalTier()`) to hide it forever rather than fixing it. This does not "resolve" the gap as this sprint's mandate requires — it only re-ratifies PHX-CERT-002's workaround as permanent. Rejected as the primary decision, though the underlying UI suppression logic remains functionally in place (now inert) as a defensive measure.

### Option D — Remove Bronze from internal tier logic; use "Not Certified" until Silver
Redefine the tier vocabulary itself so the lowest attainable Internal Tier is Silver, and everything below Silver (currently including all of the former Bronze band, 73–79) becomes "Not Certified."

- **Pro:** Eliminates the Bronze/Foundation overlap question entirely.
- **Con:** This is a materially larger change than "harmonize a floor" — it deletes an entire tier from the vocabulary, breaks `formatCertificationId()`'s `BZ` suffix code path, and would require re-auditing every certification ID format reference (`PBRS-[ORG]-[YEAR]-[SEQ]-[LEVEL]`) and every place `CertificationTier` is persisted or displayed. It also removes tier granularity that has value as internal metadata (distinguishing "just cleared the bar" assets from Silver+ assets) for no scoring-model benefit. Disproportionate to the problem. Rejected.

## 4. Rationale for Option A

1. PBRS Foundation already starts at 70 and is client-facing; Bronze at 70 simply mirrors it at the internal-metadata layer.
2. `PBRS_STANDARD_V1_0.md` §7.5 documents the platform's own B-grade readiness band beginning at 70 — Option A aligns Bronze with this existing standard rather than introducing a new number.
3. A score of 70 should not read as client-eligible ("PBRS Foundation") while simultaneously reading as internally uncertified ("Not Certified") — that pairing is confusing even though Internal Tier is secondary metadata; harmonizing removes the confusion without inventing new tier semantics.
4. Bronze remains internal-only (per PHX-CERT-001-R1 §7's Decision, unchanged by this sprint), so lowering its floor does not introduce a new weak public-facing certification level. No client ever sees "Bronze" as a granted certification.
5. Foundation (70) / Practitioner (83) / Enterprise (92) are preserved exactly as PHX-CERT-001-R1 and PHX-CERT-002 established them.
6. The PBRS six-dimension scoring model, dimension weights, and aggregate score formula (`calculateOverallScore()`) are untouched. Only the tier-*derivation* function used to label an already-computed `overall` score is changed.
7. The change is small and mechanically verifiable: a single new pure function (`tierFromScore()`) with a boundary table (§9 below) that can be checked by inspection, not a redesign of the scoring pipeline.

## 5. Impact Analysis

| Area | Impact |
|---|---|
| PBRS scoring (dimensions, weights, `calculateOverallScore()`) | **None.** Not touched. |
| `gradeFromScore()` / `PBRSGrade` (A+ through F) | **None.** Still returns `C-` for 70–72; still used for the assessment-facing readiness grade. Not read by the new tier logic. |
| `tierFromGrade()` | Deprecated (not removed) — no longer called by `generateScore()`. Retained as a documented, unused pure function for backward compatibility; a code comment explains why it must not be reconnected. |
| `@phoenix/core.tierFromScore()` (new) | New system of record for `PBRSScore.tier` / `CertificationTier` derivation. |
| `@phoenix/pbrs.generateScore()` | One-line change: `tier = tierFromScore(overall)` instead of `tier = tierFromGrade(grade)`. |
| `certification-levels.ts` — `shouldDisplayInternalTier()` | Simplified: the contradiction it existed to suppress can no longer occur, so it now always returns `true` (still gated by `context` for interface stability). No behavior change is *possible* for existing callers except that the formerly-hidden 70–72 Internal Tier line now displays (correctly, as "Bronze," not "Not Certified"). |
| `certificationLevelFromScore()` / Foundation / Practitioner / Enterprise thresholds | **None.** Unchanged. |
| `apps/platform` UI (`/certifications`, `/passports`, `/reports`, `/assessments/[id]`) | No redesign. `PassportCard`/`AssessmentTable`/`AssessmentHeader` render the same fields; only the underlying tier *value* for a 70–72 asset changes from "Not Certified" (hidden) to "Bronze" (shown). No sample asset in the current fixture set falls in the 70–72 band (verified — closest is `ast-004` at 69.05, which stays "None"/"Not Certified" on both sides, correctly), so this sprint's visual QA could not observe a live 70–72 example; correctness is established via the boundary table in `PHX_CERT_003_THRESHOLD_VERIFICATION.md`. |
| Certification ID format (`formatCertificationId()`, `PT`/`GD`/`SV`/`BZ` suffixes) | **None.** Unchanged; still derives the suffix from `CertificationTier`, whose possible values are unchanged. |
| `apps/website`, `apps/dashboard` | **None.** Untouched, per platform-sprint convention. |

## 6. Governance Notes

- This decision changes **Internal Tier derivation only** — an internal, system-facing vocabulary. It does not touch the client-facing Certification Level naming or thresholds, and per PHX-CERT-001-R1 §7 those remain separately governed.
- Per `PBRS_STANDARD_V1_0.md` §13.4, a workspace **may** tighten (never loosen below platform floor) grade-band cut points for its own certification-eligibility checks; this sprint changes the **platform-default floor itself** for Internal Tier (not a workspace override), which is the correct governance layer for a defect fix rather than a per-workspace customization.
- `PBRS_STANDARD_V1_0.md` §15.2 documents Internal Tier bands as "typical" minimums that differ from both the pre- and post-PHX-CERT-003 code values (it lists Bronze ≥ 55, Silver ≥ 70, Gold ≥ 83, Platinum ≥ 90). Per `PBRS_STANDARD_ALIGNMENT_NOTES_PHX_STD_PBRS_ALIGN_001.md` §5, reconciling the Standard document's tier table with the platform's actual code-level thresholds is an explicitly open item **not resolved by this sprint** or by PHX-STD-PBRS-ALIGN-001. This sprint changes code only (Bronze 73→70); it does not edit `PBRS_STANDARD_V1_0.md` §15.2's table. That reconciliation remains tracked as a follow-on item (see §10).
- Per PHX-CERT-001-R1 §7, Bronze remains internal-tier-only; this decision does not reopen that disposition.
- Any future change to Silver/Gold/Platinum floors, or any change to Certification Level thresholds, remains subject to Standards Committee review per the Architecture doc §12.

## 7. Final Threshold Table

### Certification Level (client-facing, PRIMARY — unchanged)

| Level | Minimum Score |
|---|---|
| PBRS Enterprise | ≥ 92 |
| PBRS Practitioner | ≥ 83 |
| PBRS Foundation | ≥ 70 |
| None | < 70 |

### Internal Tier (system metadata, SECONDARY — Bronze floor changed)

| Tier | Minimum Score (before PHX-CERT-003) | Minimum Score (after PHX-CERT-003) |
|---|---|---|
| Platinum | ≥ 93 | ≥ 93 *(unchanged)* |
| Gold | ≥ 87 | ≥ 87 *(unchanged)* |
| Silver | ≥ 80 | ≥ 80 *(unchanged)* |
| Bronze | ≥ 73 | **≥ 70** |
| Not Certified | < 73 | **< 70** |

## 8. Implementation Requirements

1. Add `tierFromScore(score: number): CertificationTier` to `@phoenix/core` (`packages/core/src/index.ts`) with the thresholds in §7.
2. Update `@phoenix/pbrs.generateScore()` to compute `tier` via `tierFromScore(overall)` instead of `tierFromGrade(gradeFromScore(overall))`.
3. Deprecate (do not delete) `tierFromGrade()` with a code comment explaining why it must not be reconnected to `generateScore()`.
4. Do not modify `gradeFromScore()`, `PBRSGrade`, `PBRS_DIMENSIONS`, dimension weights, or `calculateOverallScore()`.
5. Simplify `shouldDisplayInternalTier()` in `certification-levels.ts` to remove the now-unreachable 70–72 contradiction-suppression branch; update its docstring to record that the gap is resolved, not merely hidden.
6. Do not change `certificationLevelFromScore()`, `FOUNDATION_MIN_SCORE` (70), `PRACTITIONER_MIN_SCORE` (83), or `ENTERPRISE_MIN_SCORE` (92).
7. No changes required to `api-adapters.ts` view-model composition logic beyond stale-comment updates (verified — see `PHX_CERT_003_IMPLEMENTATION_REPORT.md` §4).
8. Full monorepo build (`pnpm install && pnpm type-check && pnpm lint && pnpm build`) must pass with zero errors across `apps/website`, `apps/platform`, `apps/dashboard`.

## 9. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| A previously-hidden "Bronze" label now appears where "Not Certified" (suppressed) used to be, surprising a viewer who saw the old suppressed state. | This is the intended fix, not a regression — Bronze is the *correct* value once the gap is closed. Documented explicitly in the addendum and release notes so the change is not mistaken for a bug. |
| Reconnecting `tierFromGrade()` in a future sprint would silently reintroduce the 70–72 gap. | `tierFromGrade()` carries an explicit `@deprecated` warning in its JSDoc naming this exact failure mode and pointing to this decision document. |
| `PBRS_STANDARD_V1_0.md` §15.2's "typical" tier table now disagrees with the code in two different ways (pre- and post-sprint) simultaneously, which could confuse a future reader. | Flagged explicitly in §6 above and in the new addendum as a tracked, unresolved reconciliation item — not silently left ambiguous. |
| Hidden coupling: some other file duplicates the old `73` Bronze floor as a magic number. | Repo-wide grep for the literal `73` in `apps/platform/src`, `packages/core/src`, `packages/pbrs/src` confirmed the only non-comment occurrence was `gradeFromScore()`'s `C` grade boundary (intentionally unchanged) — no duplicated Bronze-floor constant existed elsewhere. |
| Build regression in `apps/website` or `apps/dashboard`. | Both apps do not import `certification-levels.ts` or reference `CertificationTier` display logic; full `pnpm build` verified clean across all three apps (see `BUILD_REPORT_PHX_CERT_003.md`). |
