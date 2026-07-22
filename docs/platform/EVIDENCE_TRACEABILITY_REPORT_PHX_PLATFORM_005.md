# Evidence Traceability Report — PHX-PLATFORM-005

**Task ID:** PHX-PLATFORM-005
**Scope:** Cross-link EvidenceItems into PBRSDimensionScore.evidenceIds; add
an assessment detail route; surface Activity/Audit fixtures in the UI.

---

## Evidence Cross-Linking Summary

| Before (PHX-PLATFORM-004) | After (PHX-PLATFORM-005) |
|---|---|
| 12 `EvidenceItem` fixtures | 37 `EvidenceItem` fixtures |
| Some assessments had 2 dimensions covered, none had all 6 | All 6 sample assessments have all 6 dimensions covered |
| `PBRSDimensionScore.evidenceIds` always `[]` | `evidenceIds` populated by matching `assessmentId` + `relatedDimension` |

**Coverage matrix** (evidence items per assessment × dimension):

| Assessment | Accuracy | Compliance | Brand Alignment | Structure | Consistency | Completeness |
|---|---|---|---|---|---|---|
| ast-001 — Executive AI Brief | 1 | 1 | 1 | 1 | 1 | 1 |
| ast-002 — HR Policy Summary | 1 | 1 | 1 | 1 | 1 | 1 |
| ast-003 — Board Report Draft | 1 | 1 | 1 | 1 | 1 | 1 |
| ast-004 — Sustainability Claims Review | 1 | 2 | 1 | 1 | 1 | 1 |
| ast-005 — Marketing Campaign Copy | 1 | 1 | 1 | 1 | 1 | 1 |
| ast-006 — Legal Risk Memo | 1 | 1 | 1 | 1 | 1 | 1 |

Every cell is ≥1, satisfying the acceptance criterion "each dimension has
evidence traceability where practical." ast-004 (Sustainability Claims
Review) has 2 Compliance items because both were already present in
PHX-PLATFORM-004's fixtures and both are genuinely distinct (a legal source
reference and a reviewer's compliance-gap comment) — they were kept rather
than merged or deleted.

**Mechanism:** `mapSampleAssetToPBRSScoreRecord()` in `api-adapters.ts`
computes `evidenceForAssessment = getEvidenceItemsForAssessment(assessmentId)`
once per asset, then for each of the six dimensions filters that list by
`item.relatedDimension === dimension` and maps to `item.id`. This is a pure
filter over existing fixture data — no new scoring model, no dimension
value changes, no recalculation of PBRS. Verified by re-running
`pnpm type-check` after the change (zero errors) and by inspecting rendered
output on `/assessments/ast-001-assessment` (each of the six dimension
cards shows a "1 evidence item" badge and the correct linked card).

---

## Assessment Detail Route Summary

- **Route:** `/assessments/[assessmentId]` (dynamic, server-rendered —
  confirmed in the Next.js build output as `ƒ /assessments/[assessmentId]`).
- **View model:** `AssessmentDetailViewModel` (`lib/view-models.ts`) — asset,
  assessment, score, evidenceItems, ownerName, statusLabel, simpleGrade,
  riskLabel, activityItems, auditRecords.
- **API function:** `getAssessmentDetail(assessmentId): Promise<ApiResult<AssessmentDetailViewModel> | null>`
  in `api-client.ts`. Returns `null` for an unknown id; the page calls
  Next's `notFound()` in that case (verified: `curl` to
  `/assessments/nonexistent-assessment` returns HTTP 404).
- **Adapter function:** `buildAssessmentDetail(assessmentId)` in
  `api-adapters.ts` composes the relationship — it never runs in a
  page/component.
- **Page composition:** the page (`page.tsx`) calls only
  `getAssessmentDetail()` and `getCurrentWorkspace()` from `api-client.ts`,
  then passes plain props into the new presentational components. No
  relationship logic, filtering, or sample-data access happens in the page.

---

## Components Added

`apps/platform/src/components/`:

- `AssessmentHeader.tsx`
- `AssessmentScoreSummary.tsx` (wraps the existing `PBRSScorePanel` — no
  duplicated PBRS rendering/scoring logic)
- `DimensionEvidencePanel.tsx`
- `EvidenceCard.tsx`
- `EvidenceLibrary.tsx` (client component — group-by toggle only, no
  browser storage used)
- `AuditTrailPreview.tsx`
- `ActivityTimeline.tsx`
- `TraceabilityBadge.tsx`

Plus four new icons in the existing `Icons.tsx`: `IconEvidence`,
`IconHistory`, `IconLink` (unused directly in the final render but kept for
consistency with the icon set; reserved for a future "open source" link
affordance), `IconArrowLeft`.

## API Functions Added

`lib/api-adapters.ts`:
- `buildAssessmentDetail(assessmentId)`
- `getActivityForEntity(entityId, limit)`
- `getAuditRecordsForEntity(entityId, limit)`
- (private) `relatedEntityIdsForAssessment(assessmentId)`,
  `assessmentIdToAssetIdLocal(assessmentId)`, `dedupeById(records)`

`lib/api-client.ts`:
- `getAssessmentDetail(assessmentId)`
- `getActivityForEntity(entityId, limit)` (async wrapper)
- `getAuditRecordsForEntity(entityId, limit)` (async wrapper)

`lib/mock-fixtures/evidence.ts`: no new exported functions —
`getEvidenceItemsForAssessment()` is unchanged; only the underlying
`EVIDENCE_ITEMS` array grew from 12 to 37 records.

## Activity / Audit UI Summary

| Location | Function called | Rendering |
|---|---|---|
| `/dashboard` | `getActivityLog(5)` | `ActivityTimeline` below the Actions panel |
| `/settings` | `getAuditRecords(5)` | `AuditTrailPreview` inside a new "Audit Preview" `SettingsPanel`, with an inline note that full export isn't available in Alpha |
| `/assessments/[assessmentId]` | `getAssessmentDetail()` → `activityItems` / `auditRecords` | `ActivityTimeline` / `AuditTrailPreview` side-by-side in a two-column grid |

`getActivityLog()` and `getAuditRecords()` were already wired to non-empty
fixture data as of PHX-PLATFORM-004; this sprint only added UI consumers.
Both were re-verified as still non-empty after this sprint's fixture edits
(`getActivityLog()` → 10 items; `getAuditRecords()` → 10 items, up from 8).

**Per-assessment relatedness fix (Task 9):** before this sprint, `ast-005`
and `ast-006` had activity entries but no audit entries. Two records were
added — `adt-009` (`assessment.decided` on `ast-005-assessment`) and
`adt-010` (`assessment.status_changed.system` on `ast-006-assessment`) — so
every one of the six sample assessments now resolves at least one audit
record through `relatedEntityIdsForAssessment()`. Verified by curling
`/assessments/ast-005-assessment` and `/assessments/ast-006-assessment` in
production mode and confirming the Audit Trail Preview section renders a
real row rather than the "No audit records yet" empty state.

---

## PBRS Model Integrity Check

- `packages/core/src/index.ts`'s `PBRS_DIMENSIONS` still defines exactly six
  keys — `accuracy`, `compliance`, `brandAlignment`, `structure`,
  `consistency`, `completeness` — unchanged by this task (confirmed by
  extracting all `key: '...'` matches from the file: six dimension keys
  plus the three derived-signal keys, nothing else).
- `packages/pbrs/src/index.ts`'s `generateScore()` was not modified.
- Repo-wide check for the deprecated seven-dimension model:
  ```
  grep -rniI "business.logic\|clarity" apps/platform/src packages/core/src packages/pbrs/src
  ```
  Two matches, both benign English usage of the word "clarity" in comments
  ("for call-site clarity") — no reintroduction of `businessLogic` or
  `clarity` as scored dimensions.
- `evidenceIds` changes are additive/presentational only; `dimensionScores[].value`,
  `summary.overall`, `summary.grade`, `summary.tier`,
  `summary.confidenceIndex`, `summary.riskLevel`, and
  `summary.automationReadiness` are all still produced exclusively by
  `@phoenix/pbrs`'s `generateScore()`, called from `sample-data.ts` exactly
  as before.

---

## Direct `sample-data.ts` Import Check

Command run:

```
grep -rln "sample-data" apps/platform/src --include="*.tsx" --include="*.ts"
```

Result:

```
apps/platform/src/lib/mock-ids.ts          (comment reference only, no import)
apps/platform/src/lib/view-models.ts       (comment reference only, no import)
apps/platform/src/lib/mock-fixtures/evidence.ts  (comment reference only, no import)
apps/platform/src/lib/api-client.ts        (actual import)
apps/platform/src/lib/api-adapters.ts      (actual import)
```

Narrower check for actual `import ... from './sample-data'` statements:

```
grep -rln "from './sample-data'" apps/platform/src --include="*.tsx" --include="*.ts"
```

Result:

```
apps/platform/src/lib/api-client.ts
apps/platform/src/lib/api-adapters.ts
```

**Only `api-client.ts` and `api-adapters.ts` import `sample-data.ts`.** No
`page.tsx`, layout, or React UI component imports it, including every new
file added in this sprint.

**Note on `lib/mock-ids.ts`:** two new components (`EvidenceCard.tsx`,
`AuditTrailPreview.tsx`) import `ownerNameForUserId` from `lib/mock-ids.ts`
to resolve a UUID to a display name. This is intentional and does not
violate the direct-import rule: `mock-ids.ts` is a small, standalone
id→name lookup table (six entries), not the denormalized `sample-data.ts`
dataset the rule is aimed at. This mirrors how `Badges.tsx` already
imports contract types directly from `@phoenix/core` without going through
`api-client.ts` — presentation-only lookups/types are fine at the
component layer; the denormalized sample rows are not.

---

## Known Limitations

- Evidence, Activity, and Audit fixtures remain hand-authored and
  illustrative — see `RELEASE_NOTES_PHX_PLATFORM_005.md` for the full list.
- No pagination exists yet for activity/audit history beyond the 10-row cap
  used on the detail page and the 5-row cap used on Dashboard/Settings.
- `EvidenceItem.fileUrl` / `externalUrl` values are rendered as plain text,
  not live links, since no file storage or external redirect backend exists
  in this Alpha build.

---

## Next Recommended Sprint

See `RELEASE_NOTES_PHX_PLATFORM_005.md` § Next Recommended Sprint — same
list applies here (evidence-detail modal for attachments, `AssessmentStep`
data on the detail view, the PBRS Standard Alignment Sprint, `/contact`
backend wiring, and a paginated activity/audit view).
