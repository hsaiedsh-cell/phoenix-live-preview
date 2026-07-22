# Phoenix Platform — PBRS Scoring Contract

**Task ID:** PHX-PLATFORM-002
**Status:** Draft contract, aligned to the existing PBRS Score™ v1.0 model.
**Important:** This document does not introduce a new scoring model. It defines
how the backend will produce, store, and audit scores using the six-dimension
model already canonical in `@phoenix/core` (`PBRS_DIMENSIONS`, `PBRSScore`,
`gradeFromScore`, `tierFromGrade`) and `@phoenix/pbrs` (`generateScore`,
`calculateOverallScore`). The old seven-dimension model (Business Logic,
Clarity, Risk as scored dimensions) remains fully deprecated and must not
reappear here.

---

## 1. The Six Scored Dimensions (unchanged)

| Dimension | Weight | Source of truth |
|---|---|---|
| Accuracy | 20% | `@phoenix/core` `PBRS_DIMENSIONS` |
| Compliance | 20% | `@phoenix/core` `PBRS_DIMENSIONS` |
| Brand Alignment | 15% | `@phoenix/core` `PBRS_DIMENSIONS` |
| Structure | 15% | `@phoenix/core` `PBRS_DIMENSIONS` |
| Consistency | 15% | `@phoenix/core` `PBRS_DIMENSIONS` |
| Completeness | 15% | `@phoenix/core` `PBRS_DIMENSIONS` |

Weights sum to 100%. The backend must compute `overall` using the exact same
weighting logic as `calculateOverallScore` in `@phoenix/pbrs` — this contract
requires the backend to call that shared function (or a server-side port with
identical weights) rather than re-deriving weights independently, so the
scoring model has exactly one implementation across UI preview data and any
future live scoring engine.

## 2. Derived Signals (unchanged — not scored dimensions)

- **Risk Level** (`Low` / `Medium` / `High` / `Critical`) — derived from the
  minimum dimension score, per the existing `generateScore` heuristic
  (≥80 Low, ≥60 Medium, ≥40 High, else Critical). The scoring contract
  preserves this heuristic as the v1.0 default; workspace-level overrides of
  the *thresholds* (not the dimensions) may be introduced in a later phase.
- **Confidence Index** (0–1) — derived from `overall`, expressing statistical
  confidence in the composite score, not a compliance measure.
- **Automation Readiness** (0–1) — derived from `overall`, expressing how much
  of the review could be auto-approved without human sign-off.

These three signals are always **computed outputs**, never independently
scored or weighted inputs. No API endpoint accepts a raw value for a derived
signal — only for the six dimensions (and then only via the explicit override
path in §5).

## 3. Scoring Input Requirements

A scoring run (`POST /api/assessments/:assessmentId/score/run`) requires:

1. The assessment to be in `Scoring Pending` status (see `DATA_LIFECYCLE_PHX_PLATFORM_002.md`).
2. At least one `EvidenceItem` attached to the assessment. Draft-stage assessments with zero evidence cannot be scored — this is enforced at the `Evidence Pending → Scoring Pending` transition, not at score time, so a scoring attempt against an assessment with no evidence should not be reachable in a correctly implemented client, but the backend must still validate defensively and return `409`.
3. A resolvable `AssetVersion` (the `assetVersionId` on the assessment) — content or contentUrl must be present.

## 4. Scoring Output

A completed scoring run produces exactly one `PBRSScoreRecord`:

```ts
{
  id: UUID,
  assessmentId: UUID,
  summary: PBRSScore,              // from @phoenix/core — overall, grade, tier,
                                    // dimensions, confidenceIndex, riskLevel,
                                    // automationReadiness
  dimensionScores: PBRSDimensionScore[],   // 6 rows, one per dimension
  derivedSignals: DerivedSignalValue[],    // 3 rows: riskLevel, confidenceIndex,
                                            // automationReadiness
  hasOverrides: boolean,
  scoredByUserId: UUID | null,      // null for fully automated runs
  scoringMethod: 'Automated' | 'Manual',
}
```

`summary.dimensions` must contain **exactly** the six keys `accuracy`,
`compliance`, `brandAlignment`, `structure`, `consistency`, `completeness` —
no more, no fewer. Any scoring engine implementation that adds a seventh key
or reintroduces `businessLogic` / `clarity` / a standalone scored `risk` is a
contract violation.

## 5. Readiness Grade & Tier Thresholds (draft)

Simplified platform-facing grade bands (distinct from the granular
`PBRSGrade` A+…F already in `@phoenix/core`, used for the platform UI's
4-tier badge — see `toSimpleGrade` in `apps/platform/src/lib/sample-data.ts`):

| Grade | Overall score range |
|---|---|
| A | 85–100 |
| B | 70–84 |
| C | 55–69 |
| Hold | below 55 |

**Risk Level:**

| Risk | Condition |
|---|---|
| Low | minimum dimension score ≥ 80 |
| Medium | minimum dimension score 60–79 |
| High | minimum dimension score 40–59 |
| Critical | minimum dimension score below 40 |

**Confidence Index:** 0–100 (or 0–1 fractional, matching `@phoenix/core`'s
existing `confidenceIndex` field) — higher values indicate greater
statistical confidence in `overall`.

These thresholds are proposed as the v1.0 backend default and are
**explicitly marked draft** pending sign-off. `Workspace.settings.scoreThresholdOverride`
allows a workspace to tighten (not loosen below platform minimums) the A/B/C
cut points for its own certification eligibility checks — this does not
change the underlying dimension scoring, only the grade-band mapping used for
that workspace's certification-eligibility logic.

## 6. Certification Eligibility

A passport becomes eligible for a given `CertificationTier` when its
`scoreSnapshot` clears the tier's minimum, using the existing
`CERTIFICATION_LEVELS` reference points already used in the platform Alpha UI
(`apps/platform/src/lib/sample-data.ts`):

| Level | Minimum score |
|---|---|
| PBRS Foundation | 70 |
| PBRS Practitioner | 83 |
| PBRS Enterprise | 92 |

The backend must treat these as the default eligibility floor; a workspace
may not certify below its own configured (or platform-default) threshold.

## 7. Override Rules

- Only `Reviewer` role and above may submit a dimension override
  (`PATCH /api/assessments/:assessmentId/score/override`).
- Every override **must** include a non-empty `overrideReason` and at least
  one `evidenceId` — enforced both at the API layer (`400` otherwise) and at
  the database layer (`pbrs_dimension_scores` check constraint, see
  `DATABASE_SCHEMA_PHX_PLATFORM_002.md`).
- Overriding a single dimension triggers a full recomputation of `overall`,
  `grade`, `tier`, and all three derived signals — partial/manual edits to
  the derived signals themselves are never accepted directly.
- Each override writes one `AuditRecord` with the before/after dimension
  value, the reviewer, and the reason.

## 8. Human Reviewer Role

- The `Reviewer` workspace role (see `PERMISSIONS_MODEL_PHX_PLATFORM_002.md`)
  is the minimum role that can: assign itself/be assigned to an assessment,
  progress `AssessmentStep`s, override a dimension score, and record the
  final `Approved` / `Needs Improvement` / `Rejected` decision.
- Automated scoring (`scoringMethod: "Automated"`) never bypasses human
  review — an `Approved` decision always requires an explicit
  `POST /assessments/:id/decision` call by a `Reviewer` or above, even when
  every dimension clears its threshold automatically.

## 9. Auditability Requirements

- Every `PBRSScoreRecord` creation, and every `PBRSDimensionScore` override,
  writes an `AuditRecord` (see `DATA_LIFECYCLE_PHX_PLATFORM_002.md` and
  `audit_records` schema).
- `PBRSDimensionScore.evidenceIds` provides a traceable link from a numeric
  score back to the specific evidence that justified it, satisfying the
  "evidence before opinion" principle already established for Phoenix.
- Historical `PBRSScoreRecord` rows are retained (never hard-deleted) even
  after a re-score, so a passport's `scoreSnapshot` can always be reconciled
  against the exact scoring run that produced it.
