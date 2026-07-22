# @phoenix/core

Domain types, constants, and the canonical PBRS model. This is the **single source of
truth** for PBRS dimensions, scoring/tier types, product and solution data, and
normative references. No other package or app should redefine or hardcode this data.

## Exports

- `PBRS_DIMENSIONS` / `PBRSDimension` / `PBRSDimensionKey` — the official six-dimension
  PBRS model (Accuracy 20%, Compliance 20%, Brand Alignment 15%, Structure 15%,
  Consistency 15%, Completeness 15%).
- `DERIVED_SIGNALS` — Risk Level, Confidence Index, Automation Readiness.
- `PBRSScore`, `PBRSGrade`, `CertificationTier`, `PBRSCertification` — scoring/
  certification types.
- `gradeFromScore`, `tierFromGrade`, `formatCertificationId` — scoring/formatting
  utilities.
- `PHOENIX_PRODUCTS`, `PHOENIX_SOLUTIONS`, `PHOENIX_PRINCIPLES`,
  `NORMATIVE_REFERENCES` — content data consumed by the website.

## Consumers

`@phoenix/pbrs`, `@phoenix/website`.

## Guardrail

Do not reintroduce the retired seven-dimension PBRS model (which included separate
Business Logic, Clarity, and Risk dimensions). The six-dimension model above is
official as of v1.0.
