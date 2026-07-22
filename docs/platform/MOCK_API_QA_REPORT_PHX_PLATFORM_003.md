# Mock API QA Report — PHX-PLATFORM-003

---

## 1. Pages Migrated

| Page | Migrated | Notes |
|---|---|---|
| `/dashboard` | ✅ | Async Server Component; `getDashboardSummary()` + `getCurrentWorkspace()` |
| `/assessments` | ✅ | Async Server Component + new `AssessmentsClient` for filter interactivity; `getAssessments()` + `getCurrentWorkspace()` |
| `/assessments/new` | ✅ | Async Server Component + new `NewAssessmentWizard` for stepper interactivity; `getCurrentWorkspace()` |
| `/passports` | ✅ | Async Server Component; `getPassports()` + `getCurrentWorkspace()` |
| `/certifications` | ✅ | Async Server Component; `getCertifications()` + `getCurrentWorkspace()` |
| `/reports` | ✅ | Async Server Component; `getReports()` + `getCurrentWorkspace()` |
| `/settings` | ✅ | Async Server Component; `getWorkspaceSettings()` |
| `/login` | N/A | Explicitly out of scope per task brief |
| Group layout / `PlatformTopbar` | ✅ | Layout is now async, fetches workspace/user via api-client, passes down as props (was a hidden direct sample-data import not covered by the page-only checklist) |

## 2. Sample Data Direct Import Check

```
$ grep -rln "sample-data" apps/platform/src --include="*.tsx" --include="*.ts"
apps/platform/src/lib/api-adapters.ts
apps/platform/src/lib/api-client.ts
```

**Result: PASS.** Only `api-client.ts` and `api-adapters.ts` import
`sample-data.ts`. No page, layout, or component imports it directly.
(Components that previously imported types from `sample-data.ts` —
`AssessmentCard`, `AssessmentTable`, `Badges`, `PassportCard`, `ReportCard` —
now import those same type names from `api-client.ts`, which re-exports
them.)

## 3. API Client Function Checklist

All functions required by the task brief are implemented in
`apps/platform/src/lib/api-client.ts`:

- Workspace / User: `getCurrentUser`, `getCurrentWorkspace`, `getWorkspaceUsers` ✅
- Dashboard: `getDashboardSummary`, `getReadinessTrend`, `getRecentAssessments` ✅
- Assets: `getAssets`, `getAssetById`, `createAsset`, `updateAsset` ✅
- Assessments: `getAssessments`, `getAssessmentById`, `createAssessment`, `submitAssessment`, `updateAssessmentStep`, `recordAssessmentDecision` ✅
- Evidence: `getEvidenceItems`, `addEvidenceItem`, `updateEvidenceItem`, `deleteEvidenceItem` ✅
- PBRS Score: `getAssessmentScore`, `runAssessmentScore`, `overrideDimensionScore` ✅
- Passports: `getPassports`, `getPassportById`, `issuePassport`, `verifyPassport` ✅
- Certifications: `getCertifications`, `getCertificationById`, `grantCertification`, `revokeCertification` ✅
- Reports: `getReports`, `getReportById`, `requestReport`, `generateReport` ✅
- Activity / Audit: `getActivityLog`, `getAuditRecords` ✅
- Settings: `getWorkspaceSettings`, `updateWorkspaceSettings` ✅

All functions return Promises; no real fetch calls are made anywhere in the
mock layer.

## 4. Contract Alignment Check

| Contract type | Used via |
|---|---|
| `Workspace`, `WorkspaceSettings` | `getCurrentWorkspace`, `updateWorkspaceSettings` |
| `User` | `getCurrentUser`, `getWorkspaceUsers` |
| `Asset` | `getAssets`, `getAssetById`, `createAsset`, `updateAsset`, via `mapSampleAssetToAsset` |
| `Assessment`, `AssessmentStep` | `getAssessmentById`, `createAssessment`, `submitAssessment`, `updateAssessmentStep`, `recordAssessmentDecision`, via `mapSampleAssetToAssessment` |
| `EvidenceItem` | `getEvidenceItems`, `addEvidenceItem`, `updateEvidenceItem` |
| `PBRSScoreRecord`, `PBRSDimensionScore`, `DerivedSignalValue` | `getAssessmentScore`, `runAssessmentScore`, `overrideDimensionScore`, via `mapSampleAssetToPBRSScoreRecord` |
| `PBRSPassport` | `issuePassport`, via `mapSamplePassportToPBRSPassport` |
| `PBRSCertificationRecord` | `getCertificationById`, `grantCertification`, via `mapCertifiedAssetToCertificationRecord` |
| `Report` | `requestReport`, `generateReport`, via `mapSampleReportToReport` |
| `ActivityLog`, `AuditRecord` | `getActivityLog`, `getAuditRecords` (empty — no fixtures modeled yet) |
| `ApiResult<T>`, `PaginatedResult<T>` | Wrapping single-resource and list results across the client, per contract conventions |
| Enums (`UserRole`, `AssetType`, `AssetStatus`, `AssessmentStatus`, `RiskLevel`, `CertificationStatus`, `PassportStatus`, `ReportStatus`, `EvidenceType`, etc.) | Imported from `@phoenix/core`, never redefined locally |

No enum was duplicated locally. The platform's pre-existing `AssetStatus`
and `SimpleGrade` (in `sample-data.ts`) are UI-simplified labels, not
contract enums — `toPlatformStatusLabel()` and `toPlatformRiskLabel()`
adapter helpers exist in `api-adapters.ts` per the task brief's guidance to
use adapters rather than redefine core enums.

**Pragmatic deviation, documented:** page-facing list functions
(`getAssessments`, `getPassports`, `getCertifications`, `getReports`) return
the platform's existing denormalized read-model types (`PhoenixAsset`,
`PhoenixPassport`, `PhoenixReport`) rather than raw `Assessment[]` /
`PBRSPassport[]` / `Report[]`, to avoid a full rewrite of every card/table/
badge component in this pass. The strict, granular contract-shaped
functions are implemented in parallel for forward migration. See the design
note at the top of `api-adapters.ts` and "Known Limitations" in
`RELEASE_NOTES_PHX_PLATFORM_003.md`.

## 5. PBRS Model Integrity Check

- Six scored dimensions confirmed unchanged in `@phoenix/core`: Accuracy (20%), Compliance (20%), Brand Alignment (15%), Structure (15%), Consistency (15%), Completeness (15%).
- Three derived signals confirmed unchanged: Risk Level, Confidence Index, Automation Readiness — never treated as scored dimensions anywhere in the new code.
- No "Business Logic" or "Clarity" dimension was introduced or referenced.
- `/settings` still renders the six dimensions and their weights directly from `PBRS_DIMENSIONS` (`@phoenix/core`), now via `getWorkspaceSettings()`'s `pbrsModelVersion` label alongside the same `PBRS_DIMENSIONS` import — no duplication of the model.
- `PBRSScoreRecord.summary` in `api-adapters.ts` is the exact `PBRSScore` object from `@phoenix/core`'s `generateScore()` — scoring math is never reimplemented in the mock layer.

**Result: PASS.**

## 6. Known Limitations

See "Known Limitations" in `RELEASE_NOTES_PHX_PLATFORM_003.md` and
"Known Limitations" in `BUILD_REPORT_PHX_PLATFORM_003.md` for the full list
(empty evidence/activity/audit data, non-persistent mutations, list-view vs.
entity-view pragmatic split).

## 7. Launch Blockers

**None identified for this Alpha scope.** This task explicitly excludes a
real backend, database, and authentication, so none of the following are
blockers for this release: no persistence, no live scoring, no real user
accounts. All are expected and already labeled as such via the "Platform
Alpha" / "Mock API" / "Sample Data" notices preserved throughout the UI.

If/when this mock layer is migrated to a real backend, the following would
need to be resolved first (tracked as future sprint items, not blockers for
this Alpha release):
- Evidence, Activity, and Audit fixtures are not yet modeled.
- Mutation functions do not persist state across requests.
