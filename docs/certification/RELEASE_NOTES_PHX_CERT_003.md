# Release Notes — PHX-CERT-003

**Release Label:** PHX-CERT-003 — Certification Threshold Harmonization
**Depends on:** PHX-CERT-002 (Certification Level Implementation), PHX-CERT-001-R1 (Certification Tier Architecture)

## What Changed

- The PBRS Internal Tier **Bronze** floor is lowered from **73 to 70**, resolving the previously-documented 70–72 gap between the client-facing Certification Level (PBRS Foundation, starting at 70) and the system-facing Internal Tier (previously starting Bronze at 73).
- A new `tierFromScore()` function in `@phoenix/core` is now the system of record for deriving `PBRSScore.tier` directly from the overall score.
- `@phoenix/pbrs`'s `generateScore()` now calls `tierFromScore(overall)` instead of the previous `tierFromGrade(gradeFromScore(overall))` path.
- The PHX-CERT-002 UI workaround that suppressed the Internal Tier display for scores of 70–72 (`shouldDisplayInternalTier()`) is simplified, since the contradiction it existed to hide can no longer occur.

## What Was Preserved

- The six scored PBRS dimensions and their weights (Accuracy 20%, Compliance 20%, Brand Alignment 15%, Structure 15%, Consistency 15%, Completeness 15%) — **unchanged**.
- The aggregate score formula (`calculateOverallScore()`) — **unchanged**.
- `gradeFromScore()` and the PBRSGrade scale (A+ through F) — **unchanged**.
- Derived signals (Risk Level, Confidence Index, Automation Readiness) — **unchanged**.
- Certification Level thresholds — PBRS Foundation ≥ 70, PBRS Practitioner ≥ 83, PBRS Enterprise ≥ 92 — **unchanged**.
- Internal Tier thresholds for Silver (≥ 80), Gold (≥ 87), and Platinum (≥ 93) — **unchanged**.
- Bronze remains internal-only metadata; it is never presented as a standalone client-facing certification name.
- No backend, database, or authentication was added.
- No UI redesign — all changes to `apps/platform` are documentation-comment-only.

## Architecture Notes

- `tierFromGrade()` is deprecated but not removed, and is no longer called by `generateScore()`. It carries an explicit warning against being reconnected, since doing so would silently reintroduce the resolved gap.
- This is a governance-layer platform-default change to Internal Tier derivation (per `PBRS_STANDARD_V1_0.md` §13.4's distinction between platform floor and workspace override), not a per-workspace customization.
- Full decision rationale, options considered, and impact analysis are in `PHX_CERT_003_THRESHOLD_DECISION.md`.

## Known Limitations

- No sample fixture asset scores in the 70–72 band, so the fix was verified via a boundary-value table (`PHX_CERT_003_THRESHOLD_VERIFICATION.md`) and full type-check/build/lint pass rather than a live rendered example.
- `PBRS_STANDARD_V1_0.md` §15.2's documented "typical" Internal Tier bands (Bronze ≥ 55, Silver ≥ 70, Gold ≥ 83, Platinum ≥ 90) still do not match the platform's code-level thresholds. This pre-existing discrepancy is unresolved by this sprint and remains tracked in `PBRS_STANDARD_ALIGNMENT_NOTES_PHX_STD_PBRS_ALIGN_001.md` §5.

## Next Recommended Sprint

- Reconcile `PBRS_STANDARD_V1_0.md` §15.2's Internal Tier band table with the actual code-level thresholds (post-PHX-CERT-003: Bronze ≥ 70, Silver ≥ 80, Gold ≥ 87, Platinum ≥ 93), as a follow-on to the PHX-STD-PBRS-ALIGN-001 alignment work.
- Continue PHX-PLATFORM-006+ backend/auth integration work, independent of this certification-threshold fix.
