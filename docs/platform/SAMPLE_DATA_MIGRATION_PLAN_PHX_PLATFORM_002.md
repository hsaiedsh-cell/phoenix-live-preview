# Phoenix Platform — Sample Data Migration Plan

**Task ID:** PHX-PLATFORM-002
**Status:** Draft plan. No migration has been executed — `apps/platform/src/lib/sample-data.ts` is unchanged by this task.

---

## 1. Current Sample Data Mapping

`apps/platform/src/lib/sample-data.ts` exports the following, each mapped to
its target backend entity:

| Sample export | Shape today | Target backend entity | Notes |
|---|---|---|---|
| `PhoenixAsset` / `SAMPLE_ASSETS` | Local `AssetStatus` union (`Draft`/`In Review`/`Business Ready`/`Certified`/`Needs Improvement`) + inline `PBRSScore` | `Asset` + `PBRSScoreRecord` | Local `AssetStatus` is a subset of the contract's `AssetStatus` enum (missing `Submitted`, `Assessed`, `Expired`, `Archived`) — needs alignment, see §4. |
| `toSimpleGrade()` | Local function | Stays as a UI-layer presentation helper | Reads `PBRSScore.grade` (unchanged) and maps to the same `ReadinessGrade` union (`A`/`B`/`C`/`Hold`) now formalized in `enums.ts`. |
| `PhoenixPassport` / `SAMPLE_PASSPORTS` | Flattened fields (`score`, `grade` as numbers/strings) | `PBRSPassport` | Target contract separates `scoreSnapshot`/`gradeSnapshot` (immutable at issuance) from the live `Asset`/`Assessment` score — sample data currently derives passport fields live from `SAMPLE_ASSETS`, which the contract's snapshot model intentionally diverges from (by design — passports must not silently change after issuance). |
| `CERTIFICATION_LEVELS` | Static const array | `PBRSCertificationRecord.tier` thresholds | Values already match §6 of `PBRS_SCORING_CONTRACT_PHX_PLATFORM_002.md` — no changes needed, just move from a UI constant to a backend-owned configuration once real. |
| `CERTIFIED_ASSETS` / `ELIGIBLE_ASSETS` / `EXPIRING_SOON` | Derived via `.filter()` on `SAMPLE_ASSETS` | Query results from `GET /certifications?status=` / `GET /passports?status=` | Becomes a server-side filtered query instead of a client-side array filter. |
| `PhoenixReport` / `SAMPLE_REPORTS` | Local `status: 'Available' | 'Coming Soon'` | `Report` | Contract's `ReportStatus` is richer (`Requested`/`Generating`/`Available`/`Expired`/`Failed`); `'Coming Soon'` templates map to `ReportTemplate` rows with no `Report` instances yet, not to a report status. |
| `WORKSPACE_NAME` | Hardcoded string | `Workspace.name` | Becomes `GET /api/workspaces/:id`. |
| `averageOverallScore()`, `averageConfidenceIndex()`, `openRiskCount()`, `certifiedCount()`, `averageDimensionScores()` | Client-computed aggregates over `SAMPLE_ASSETS` | Dashboard aggregate endpoint(s) | These become either a dedicated `GET /api/workspaces/:id/dashboard-summary` read-model (recommended, not yet in the API contract — flagged as a follow-up) or client-side aggregation over paginated `GET /assets` results. |
| `READINESS_TREND` | Hardcoded array + live average appended | Time-series from `activity_logs`/`pbrs_scores` history | Needs a proper time-series query once historical score data exists; not addressed by this contract's endpoint list — flagged as a follow-up. |

---

## 2. Which UI Pages Consume Which Endpoints

| Page | Sample data used today | Target endpoint(s) |
|---|---|---|
| `dashboard/page.tsx` | `SAMPLE_ASSETS`, `averageOverallScore`, `averageConfidenceIndex`, `openRiskCount`, `certifiedCount`, `averageDimensionScores`, `READINESS_TREND` | `GET /api/workspaces/:id/assets`, `GET /api/workspaces/:id/activity`, (proposed) `GET /api/workspaces/:id/dashboard-summary` |
| `assessments/page.tsx` | `SAMPLE_ASSETS` (as a stand-in for assessments) | `GET /api/workspaces/:id/assessments` |
| `assessments/new/page.tsx` | `SAMPLE_ASSETS`, `CERTIFICATION_LEVELS` | `POST /api/workspaces/:id/assessments`, `GET /api/workspaces/:id/assets` |
| `passports/page.tsx` | `SAMPLE_PASSPORTS` | `GET /api/workspaces/:id/passports` |
| `certifications/page.tsx` | `CERTIFICATION_LEVELS`, `CERTIFIED_ASSETS`, `ELIGIBLE_ASSETS`, `EXPIRING_SOON` | `GET /api/workspaces/:id/certifications` |
| `reports/page.tsx` | `SAMPLE_REPORTS` | `GET /api/workspaces/:id/reports` |
| `settings/page.tsx` | `WORKSPACE_NAME` | `GET /api/workspaces/:id`, `PATCH /api/workspaces/:id` |
| `AssessmentTable.tsx`, `AssessmentCard.tsx` | `SAMPLE_ASSETS` fields (name, status, score) | `Assessment` + `Asset` joined read-model |
| `PassportCard.tsx` | `PhoenixPassport` fields | `PBRSPassport` |
| `ReportCard.tsx` | `PhoenixReport` fields | `Report` |
| `Badges.tsx` | `SimpleGrade`, `AssetStatus` (local types) | `ReadinessGrade`, `AssetStatus` (contract enums) |
| `PlatformTopbar.tsx` | `WORKSPACE_NAME` | `GET /api/users/me` (for `UserWorkspaceSummary`) |

---

## 3. Migration Phases

### Phase 1 — Align types, keep sample data
Replace the platform app's locally-declared `AssetStatus` and `SimpleGrade`
unions in `sample-data.ts` with imports from `@phoenix/core`'s new
`AssetStatus` and `ReadinessGrade` contract enums. Update `SAMPLE_ASSETS`
records to use the full `AssetStatus` value set where narratively
appropriate (e.g. add a `Submitted` example). No behavior change — purely a
type-alignment pass so components don't need to change when real data
arrives later.

### Phase 2 — Introduce a mock API layer
Add a thin `apps/platform/src/lib/api-client.ts` whose function signatures
exactly match the endpoints in `API_CONTRACT_PHX_PLATFORM_002.md` (e.g.
`getAssets(workspaceId): Promise<PaginatedResult<Asset>>`) but whose
implementation still reads from `sample-data.ts` under the hood, wrapped in
`Promise.resolve(...)`. Pages are updated to call this client instead of
importing `SAMPLE_*` constants directly. This isolates every future
call-site change to one file.

### Phase 3 — Replace mock API with backend endpoints
Swap the mock implementation in `api-client.ts` for real `fetch()` calls
against the endpoints in `API_CONTRACT_PHX_PLATFORM_002.md`, once a backend
exists. Page components require no changes if Phase 2's function signatures
were held stable.

### Phase 4 — Add authentication and workspace scoping
Introduce session handling and resolve `workspaceId` from the authenticated
user's `UserWorkspaceSummary` rather than a hardcoded value. Enforce the
`PERMISSIONS_MODEL_PHX_PLATFORM_002.md` matrix at both the API layer and,
defensively, in the UI (hide/disable actions the current role cannot
perform).

### Phase 5 — Enable real scoring, passports, and reports
Connect `POST /score/run`, passport issuance, certification granting, and
report generation to their real implementations (scoring engine, PDF/CSV
generation, etc.). Remove all remaining sample-data fallbacks.

---

## 4. Risks

- **Status enum drift:** the platform's current local `AssetStatus` (5
  values) is a strict subset of the contract's `AssetStatus` (8 values).
  Components that exhaustively switch on the local union (e.g. `Badges.tsx`)
  will need a default/fallback case added in Phase 1 before the additional
  states can safely appear in data.
- **Denormalized dashboard aggregates:** `averageOverallScore` and friends
  currently recompute from the full in-memory `SAMPLE_ASSETS` array on every
  render. At real scale this must become either a backend-computed
  read-model or a paginated client aggregation strategy — not addressed by
  the current `API_CONTRACT_PHX_PLATFORM_002.md` endpoint list and flagged
  here as a follow-up task for a future sprint.
- **Passport/score snapshot divergence:** sample data derives passport
  `score`/`grade` live from the asset's current score, whereas the contract
  model snapshots them at issuance. Phase 1 should intentionally introduce
  this divergence in sample data (freeze a `scoreSnapshot` at "issuance"
  time in the sample records) so the UI is exercised against the eventual
  real behavior rather than silently relying on live derivation.
- **No dashboard-summary endpoint yet:** flagged in §1/§2 — should be scoped
  explicitly before Phase 3 begins, or Phase 3 will require ad-hoc client
  aggregation over full asset lists, which does not scale.

## 5. Recommended Sequence

1. Phase 1 (type alignment) — low risk, no UI behavior change, can start immediately.
2. Scope the missing dashboard-summary endpoint (small follow-up to `API_CONTRACT_PHX_PLATFORM_002.md`) before Phase 2 begins.
3. Phase 2 (mock API layer) — enables parallel backend development against a stable contract.
4. Phase 3 (real backend) — swap implementation only.
5. Phase 4 (auth) — gate access; can be developed in parallel with Phase 3 once the contract is stable.
6. Phase 5 (real scoring/passports/reports) — last, since it depends on the scoring engine and document-generation pipeline both being production-ready.
