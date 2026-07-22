# PHX-CERT-003 — Boundary Threshold Verification

**Task ID:** PHX-CERT-003
**Purpose:** Mechanically verify the harmonized Certification Level / Internal Tier boundary table required by the acceptance criteria, since no automated test harness exists in this repository (verified — no `*.test.ts`, `*.spec.ts`, `jest.config.*`, or `vitest.config.*` present).

---

## 1. Method

No test runner is configured in this monorepo. Per task instructions ("do not add heavy testing infrastructure if none exists"), verification was performed with:

1. **Type-level / build-level verification**: `pnpm type-check` and `pnpm build` across all three apps pass cleanly after the threshold change (see `BUILD_REPORT_PHX_CERT_003.md`).
2. **Direct mechanical verification**: a standalone script re-implementing the exact logic now present in `packages/core/src/index.ts` (`tierFromScore`) and `apps/platform/src/lib/certification-levels.ts` (`certificationLevelFromScore`) was run against every required boundary score. The script is not part of the shipped codebase — it exists only to confirm the shipped functions produce the required table, mirrored line-for-line from the actual source.

```js
function tierFromScore(score) {
  if (score >= 93) return 'Platinum';
  if (score >= 87) return 'Gold';
  if (score >= 80) return 'Silver';
  if (score >= 70) return 'Bronze';
  return 'Not Certified';
}

function certificationLevelFromScore(score) {
  if (score >= 92) return 'PBRS Enterprise';
  if (score >= 83) return 'PBRS Practitioner';
  if (score >= 70) return 'PBRS Foundation';
  return 'None';
}
```

## 2. Required Boundary Table — Verified Output

| Score | Certification Level | Internal Tier | Matches Required Table? |
|---|---|---|---|
| 69.9 | None | Not Certified | ✅ |
| 70 | PBRS Foundation | Bronze | ✅ |
| 72 | PBRS Foundation | Bronze | ✅ |
| 73 | PBRS Foundation | Bronze | ✅ |
| 79.9 | PBRS Foundation | Bronze | ✅ |
| 80 | PBRS Foundation | Silver | ✅ |
| 82.9 | PBRS Foundation | Silver | ✅ |
| 83 | PBRS Practitioner | Silver | ✅ |
| 86.9 | PBRS Practitioner | Silver | ✅ |
| 87 | PBRS Practitioner | Gold | ✅ |
| 91.9 | PBRS Practitioner | Gold | ✅ |
| 92 | PBRS Enterprise | Gold | ✅ |
| 93 | PBRS Enterprise | Platinum | ✅ |

All thirteen required boundary cases match exactly. Critically, the 70–72 band (previously the contradictory case: "PBRS Foundation" + "Not Certified") now resolves consistently to "PBRS Foundation" + "Bronze" — the gap is closed.

## 3. Sample Fixture Cross-Check

The current `sample-data.ts` fixture set (`ast-001` through `ast-006`) was checked against these functions to confirm no regression in already-certified/eligible assets. Overall scores were computed by the exact weighted formula in `calculateOverallScore()` (Accuracy 20%, Compliance 20%, Brand Alignment 15%, Structure 15%, Consistency 15%, Completeness 15%):

| Asset | Overall Score | Certification Level | Internal Tier (before) | Internal Tier (after) | Changed? |
|---|---|---|---|---|---|
| ast-001 | 92.90 | PBRS Enterprise | Gold | Gold | No |
| ast-002 | 86.80 | PBRS Practitioner | Silver | Silver | No |
| ast-003 | 81.00 | PBRS Foundation | Silver | Silver | No |
| ast-004 | 69.05 | None | Not Certified | Not Certified | No |
| ast-005 | 87.40 | PBRS Practitioner | Gold | Gold | No |
| ast-006 | 79.80 | PBRS Foundation | Bronze | Bronze | No |

No fixture asset falls in the 70–72 band (the closest is `ast-004` at 69.05, just below Foundation on both vocabularies — correctly unaffected). This confirms the threshold change altered **no existing sample asset's derived tier**, and the fix is validated purely through the boundary table in §2, consistent with how PHX-CERT-002's original gap was also only verifiable by boundary reasoning rather than a live example (see `PHX_CERT_002_IMPLEMENTATION_REPORT.md` §4).

## 4. Regression Check — Grade Bands Unchanged

`gradeFromScore()` was not modified. Spot-checked to confirm it still returns the same grade for every score in §2's table (unaffected by this sprint):

| Score | `gradeFromScore()` Output (unchanged) |
|---|---|
| 69.9 | D |
| 70 | C- |
| 83 | B |
| 92 | A |
| 93 | A |

These are read only by the assessment-facing A/B/C/Hold-mapped readiness grade and simplified `SimpleGrade` badge — never by the new `tierFromScore()` — so they are unaffected by the Bronze floor change.

## 5. Conclusion

The harmonized threshold logic in `@phoenix/core.tierFromScore()` produces the exact required boundary table with no regression to existing sample data, the six-dimension scoring model, the aggregate score formula, `gradeFromScore()`, or Certification Level thresholds.
