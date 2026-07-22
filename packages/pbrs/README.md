# @phoenix/pbrs

Sample data and scoring utilities for the PBRS™ standard. Depends on `@phoenix/core`
for the official dimension list and grade/tier mapping — does not redefine the model.

## Exports

- `SAMPLE_PBRS_SCORE` — a static, clearly-illustrative sample score used for UI previews
  (e.g. on the `/pbrs` and `/platform` marketing pages).
- `calculateOverallScore(dimensions)` — weighted sum across `PBRS_DIMENSIONS`.
- `generateScore(dimensions)` — derives a full `PBRSScore` (grade, tier, risk level,
  confidence index, automation readiness) from raw per-dimension scores.
- `PBRS_MATURITY_LEVELS` — the five-level organizational maturity path shown on the
  `/pbrs` page.

## Guardrail

Any UI displaying scores from this package must keep them labeled as illustrative/
sample — see the "Notes on Claims & Numbers" section in the root README.
