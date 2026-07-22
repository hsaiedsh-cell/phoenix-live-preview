# Release Notes — PHX-PLATFORM-003

**Release label:** Phoenix Platform Alpha — Mock API Layer
**Task ID:** PHX-PLATFORM-003
**Type:** Frontend architecture refactor (no backend, database, or auth added)

---

## What Changed

Phoenix Platform's UI no longer reads sample data directly. Every page now
calls a mock API client (`apps/platform/src/lib/api-client.ts`) shaped like
the future Phoenix Platform backend defined in
`API_CONTRACT_PHX_PLATFORM_002.md`:

- `getDashboardSummary()`, `getReadinessTrend()`, `getRecentAssessments()`
- `getAssets()`, `getAssetById()`, `createAsset()`, `updateAsset()`
- `getAssessments()`, `getAssessmentById()`, `createAssessment()`, `submitAssessment()`, `updateAssessmentStep()`, `recordAssessmentDecision()`
- `getEvidenceItems()`, `addEvidenceItem()`, `updateEvidenceItem()`, `deleteEvidenceItem()`
- `getAssessmentScore()`, `runAssessmentScore()`, `overrideDimensionScore()`
- `getPassports()`, `getPassportById()`, `issuePassport()`, `verifyPassport()`
- `getCertifications()`, `getCertificationById()`, `grantCertification()`, `revokeCertification()`
- `getReports()`, `getReportById()`, `requestReport()`, `generateReport()`
- `getActivityLog()`, `getAuditRecords()`
- `getWorkspaceSettings()`, `updateWorkspaceSettings()`
- `getCurrentUser()`, `getCurrentWorkspace()`, `getWorkspaceUsers()`

Every function returns a `Promise` and, where appropriate, wraps its result
in the contract's `ApiResult<T>` or `PaginatedResult<T>` envelopes.

New supporting files:
- `api-adapters.ts` — converts sample fixtures into contract-shaped records (`Asset`, `Assessment`, `PBRSScoreRecord`, `PBRSPassport`, `PBRSCertificationRecord`, `Report`) and builds the dashboard summary / workspace settings read-models.
- `api-inputs.ts` — typed request bodies for every mutation, aligned to the contract.
- `mock-latency.ts` — a `mockDelay<T>()` helper so functions already look like real network calls; defaulted to 0ms.

All seven platform routes (`/dashboard`, `/assessments`, `/assessments/new`,
`/passports`, `/certifications`, `/reports`, `/settings`) and the persistent
shell (`PlatformTopbar`, via the group layout) were migrated to consume data
through this layer instead of importing `sample-data.ts` directly.

`sample-data.ts` itself is unchanged in content — it now carries a header
comment clarifying its role as mock source data only, consumed exclusively
by `api-client.ts` and `api-adapters.ts`.

## What Was Preserved

- Visual design — confirmed via Playwright screenshots at 1440px, 834px, and 390px across all seven routes; layout, copy, and data values are unchanged from the pre-refactor build.
- All "Platform Alpha" / "Mock API" / "Sample Data" notices, including the `AlphaNotice` banners on `/assessments/new`, `/certifications`, and `/settings`.
- The PBRS six-dimension model (Accuracy 20%, Compliance 20%, Brand Alignment 15%, Structure 15%, Consistency 15%, Completeness 15%) and its three derived signals (Risk Level, Confidence Index, Automation Readiness) — untouched. No Business Logic or Clarity dimension was reintroduced.
- `apps/website` and `apps/dashboard` — both still build cleanly and were not touched by this task.

## Architecture Notes

- **Two-layer data model.** `sample-data.ts` remains the single fixture source. `api-adapters.ts` is the only place that reshapes those fixtures into contract-aligned entities. `api-client.ts` is the only place pages talk to.
- **List-view vs. entity-view functions.** Page-facing functions (`getAssessments()`, `getPassports()`, `getCertifications()`, `getReports()`) return the platform's existing denormalized "list view" objects — deliberately, to avoid rewriting every card/table/badge component's prop shape in one pass. Granular, strictly contract-shaped functions (`getAssetById()`, `getAssessmentById()`, `getAssessmentScore()`) are also implemented, built via the same adapters, so a future migration to per-entity backend calls does not require redesigning `api-client.ts`'s surface — only swapping which functions the pages call.
- **Server/Client split for interactive pages.** `/assessments` and `/assessments/new` were client components (`useState`/`useMemo`) and therefore cannot themselves be `async`. Both were split into a thin async Server Component (route `page.tsx`, fetches via api-client) and a new client component (`AssessmentsClient`, `NewAssessmentWizard`) that receives fetched data as props.
- **Import path note.** `@phoenix/core`'s `package.json` exports map only declares `"."`; there is no `"./contracts"` subpath. Since `packages/core/src/index.ts` re-exports `export * from './contracts'`, all contract types were imported via `@phoenix/core` throughout this task rather than the literal (non-resolving) `@phoenix/core/contracts` path.

## Known Limitations

- `getEvidenceItems()`, `getActivityLog()`, and `getAuditRecords()` return empty lists — no evidence, activity, or audit data has been modeled in sample data yet (flagged previously in `SAMPLE_DATA_MIGRATION_PLAN_PHX_PLATFORM_002.md`).
- Mutation functions (`createAsset`, `createAssessment`, `submitAssessment`, `recordAssessmentDecision`, `grantCertification`, `revokeCertification`, `requestReport`, `generateReport`, etc.) synthesize a plausible response but do not persist — a page refresh reverts to the original sample fixtures. This is intentional for an Alpha mock layer with "no real backend" as an explicit constraint.
- The list-view vs. entity-view split (above) means full 1:1 contract-type usage in every page is not yet complete; this is documented as a deliberate, practical tradeoff rather than an oversight.
- `login/page.tsx` was left untouched per the task brief ("Login page does not need real API").

## Next Recommended Sprint

1. **PHX-PLATFORM-004 candidate:** Migrate `/assessments` and `/certifications` pages from the denormalized list-view functions to the granular entity-view functions (`getAssets()` + `getAssessmentScore()` per row), updating `AssessmentCard`, `AssessmentTable`, and `Badges` to accept the split `Asset` / `PBRSScoreRecord` shapes. This is the natural follow-up once the team is ready to invest in the component-level rewrite flagged as a known limitation above.
2. Model `EvidenceItem`, `ActivityLog`, and `AuditRecord` sample fixtures so `getEvidenceItems()`, `getActivityLog()`, and `getAuditRecords()` return non-empty, representative data.
3. Continue the PBRS Standard Alignment Sprint (updating `PHX-STD-PBRS-001`) and the `/contact` form backend wiring, both still outstanding from prior sprints.
