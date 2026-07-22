# Entity View Migration Report — PHX-PLATFORM-004

**Task ID:** PHX-PLATFORM-004
**Scope:** Migrate key Platform UI pages from denormalized list-view mock
data toward contract-shaped entity views; add Evidence, Activity, and
Audit fixtures.

---

## Pages Migrated

| Page | Before | After |
|---|---|---|
| `/assessments` | `PhoenixAsset[]` via `getAssessments()` | `AssessmentListItemViewModel[]` (Asset + Assessment + PBRSScoreRecord) |
| `/certifications` | `CERTIFIED_ASSETS` / `ELIGIBLE_ASSETS` / `EXPIRING_SOON` (`PhoenixAsset[]` / `PhoenixPassport[]`) | `CertificationListItemViewModel[]` / `AssessmentListItemViewModel[]` / `PassportListItemViewModel[]` via `buildCertificationsOverview()` |
| `/passports` | `PhoenixPassport[]` via `getPassports()` | `PassportListItemViewModel[]` |
| `/reports` | `PhoenixReport[]` via `getReports()` | `ReportListItemViewModel[]` |
| `/dashboard` | `recentAssessments: PhoenixAsset[]` | `recentAssessments: AssessmentListItemViewModel[]` (via `DashboardSummaryViewModel`) |
| `/settings` | Unchanged — already contract-shaped (`PlatformWorkspaceSettingsView`, `PBRS_DIMENSIONS`) | Unchanged |

## Components Migrated

| Component | Change |
|---|---|
| `AssessmentCard.tsx` | Prop renamed `asset` → `item: AssessmentListItemViewModel`; reads `item.asset`, `item.score.summary`, `item.simpleGrade`, `item.statusLabel`. |
| `AssessmentTable.tsx` | Prop renamed `assets` → `items: AssessmentListItemViewModel[]` (also accepts the structurally-compatible `CertificationListItemViewModel[]` used by `/certifications`). |
| `AssessmentsClient.tsx` | Prop renamed `assessments` → `items`; filter logic reads `item.statusLabel` / `item.asset.department` / `item.score.summary.riskLevel` / `item.simpleGrade`. |
| `PassportCard.tsx` | Prop renamed `passport` → `item: PassportListItemViewModel`; certification status label now derives from `item.certification` presence rather than a stored `certificationStatus` string. |
| `ReportCard.tsx` | Prop renamed `report` → `item: ReportListItemViewModel`; description now sourced from the synthesized `ReportTemplate`. |
| `Badges.tsx` | `StatusBadge` now accepts a presentation `string` (with a neutral fallback style) instead of the closed 5-value `AssetStatus` union. `GradeBadge` / `RiskBadge` now type against `@phoenix/core`'s `ReadinessGrade` / `RiskLevel` directly. |
| `CertificationCard.tsx` | No change — props were already primitive (`name`, `description`, `minScore`, `assetCount`). |

## New View Models (`lib/view-models.ts`)

- `SimpleGrade` (alias of `ReadinessGrade`)
- `AssessmentListItemViewModel`
- `PassportListItemViewModel`
- `CertificationListItemViewModel`
- `ReportListItemViewModel`
- `DashboardActionItemViewModel`
- `DashboardSummaryViewModel`

## New Adapter Functions (`lib/api-adapters.ts`)

- `toAssessmentStatusLabel(asset, assessment)` — presentation-label helper
- `buildAssessmentListItems()`
- `buildPassportListItems()`
- `buildCertificationListItems()`
- `buildEligibleAssessmentListItems()`
- `buildExpiringSoonPassportListItems()`
- `buildCertificationsOverview()`
- `buildReportListItems()`
- `buildEvidenceItems(assessmentId)`
- `buildActivityLogs(limit)`
- `buildAuditRecords(limit)`

`mapSampleAssetToAsset()` and `mapSampleAssetToAssessment()` were updated to
assign a distinct `ownerUserId` per sample asset (via the new
`ownerUserIdForName()` helper in `lib/mock-ids.ts`) instead of collapsing
every asset onto the single mock owner.

`buildDashboardSummary()` / `DashboardSummary` are kept as deprecated type
aliases of `buildDashboardSummary()` / `DashboardSummaryViewModel` so any
external reference to the old name still resolves.

## New API Client Functions (`lib/api-client.ts`)

- `getAssessmentListItems()` (alias of `getAssessments()`)
- `getPassportListItems()` (alias of `getPassports()`)
- `getCertificationListItems()` (returns `certifiedItems` from `getCertifications()`)
- `getReportListItems()` (alias of `getReports()`)

`getEvidenceItems()`, `getActivityLog()`, and `getAuditRecords()` now read
from the new fixture modules instead of returning empty results.

## Old Denormalized Shapes Still Remaining

- `sample-data.ts`'s `PhoenixAsset`, `PhoenixPassport`, and `PhoenixReport`
  types and the `SAMPLE_ASSETS` / `SAMPLE_PASSPORTS` / `SAMPLE_REPORTS`
  arrays are **not removed** — per task constraints ("do not remove sample
  data yet"). They remain the underlying source rows that
  `api-adapters.ts`'s `map*` functions decompose into contract entities.
- A handful of mutation functions in `api-client.ts` that don't have a
  full sample-data row to decompose (`createAsset`, `createAssessment`,
  `requestReport`, etc.) still synthesize a bare contract entity directly,
  as they did in PHX-PLATFORM-003. This is unchanged from the prior sprint
  and out of this task's scope (Tasks 1–9 only covered list-view read
  paths).
- `getAssetById()`, `getAssessmentById()`, and `getAssessmentScore()` still
  return single contract entities directly (not view models) — this
  matches their PHX-PLATFORM-003 behavior and wasn't in scope for this
  sprint's view-model migration (Tasks 4–6 named `/assessments`,
  `/certifications`, and `/passports` specifically).

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
`page.tsx`, UI component, or layout component imports it — confirmed by
grep and by the fact that every page/component now imports exclusively
from `@/lib/api-client`.

## Evidence / Activity / Audit Fixture Checklist

| Requirement | Status |
|---|---|
| `EvidenceItem` fixtures exist | ✅ `lib/mock-fixtures/evidence.ts` — 12 records across all 6 sample assessments |
| `ActivityLog` fixtures exist | ✅ `lib/mock-fixtures/activity.ts` — 10 records |
| `AuditRecord` fixtures exist | ✅ `lib/mock-fixtures/audit.ts` — 8 records |
| `getEvidenceItems(assessmentId)` returns non-empty, filtered data | ✅ Filters `EVIDENCE_ITEMS` by `assessmentId`; every sample assessment has ≥1 item |
| `getActivityLog()` returns non-empty data | ✅ Returns all 10 entries, newest-first, paginated shape (`PaginatedResult<ActivityLog>`) |
| `getAuditRecords()` returns non-empty data | ✅ Returns all 8 entries, newest-first, paginated shape (`PaginatedResult<AuditRecord>`) |
| `AuditRecord` treated as immutable (no update/delete mock functions) | ✅ `mock-fixtures/audit.ts` exposes only a read function (`getAuditRecordsPage`) |

## PBRS Model Integrity Check

- `packages/core/src/index.ts`'s `PBRS_DIMENSIONS` still defines exactly six
  dimensions (Accuracy 20%, Compliance 20%, Brand Alignment 15%, Structure
  15%, Consistency 15%, Completeness 15%) — unchanged by this task.
- `packages/pbrs/src/index.ts`'s `generateScore()` was not modified; every
  `PBRSScore` embedded in the new view models is produced by that function,
  called from `sample-data.ts` exactly as it was in PHX-PLATFORM-003.
- No component, adapter, or fixture in this sprint reintroduces
  `businessLogic` or `clarity` as scored dimensions. A repo-wide check —
  `grep -rniI "business.logic\|clarity" apps/platform/src packages/core/src
  packages/pbrs/src` — returns no matches outside of this report and the
  unrelated `Structure` dimension description text.
- Derived signals (`riskLevel`, `confidenceIndex`, `automationReadiness`)
  remain derived-only; no new code path scores them directly.

## Known Limitations

See the "Known Limitations" section of
`RELEASE_NOTES_PHX_PLATFORM_004.md` for the full list. In summary:
`ReportTemplate` records are synthesized rather than seeded from a
dedicated catalog; `PBRSDimensionScore.evidenceIds` are not yet cross-linked
to the new evidence fixtures; and the optional dashboard/settings
activity-audit UI panels (Task 10) were not added this sprint.
