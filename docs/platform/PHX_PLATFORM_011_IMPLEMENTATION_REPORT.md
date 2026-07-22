# PHX-PLATFORM-011 — Implementation Report

**Task:** Live Read Migration for Production Auth
**Builds on:** PHX-PLATFORM-010-R1 (production-auth mode, Clerk gating,
mock-data transparency banner), PHX-LIVE-001-R1 (real-dev reads),
PHX-AUTH-001/002-R1 (production auth strategy, oidc-jwt resolver),
PHX-BACKEND-006/007-R1/008-R1 (auth boundary, ownership + audit
logging, activity/audit read endpoints).
**Scope:** Read-data migration only. No public deployment, no PBRS/
scoring/certification-threshold changes, no backend auth logic changes,
no customer onboarding, no passport/certification write wiring.

## Sources read before implementation

Per standing project discipline, every listed source was read in full
before any code was written, plus the actual backend route/repository
source (not just its release notes) for the endpoints this sprint
consumes:

- `apps/platform/src/lib/api-config.ts`, `real-api-client.ts`,
  `api-client.ts`, `auth/platform-auth.{ts,client.ts,server.ts}`,
  `components/ProductionAuthGate.tsx`,
  `components/MockDataTransparencyBanner.tsx`, `AuthGate.tsx` — the
  exact mode boundary, header-attachment rules, and gating this sprint
  had to preserve exactly (PHX-PLATFORM-009/010/010-R1).
- `apps/platform/src/lib/view-models.ts`, `api-adapters.ts`,
  `mock-api-client.ts` (full export list) — confirmed which mock view
  models (`AssessmentListItemViewModel`, `DashboardSummaryViewModel`,
  `AssessmentDetailViewModel`) exist and what fields they carry, to
  know precisely which fields a live read genuinely cannot supply.
- `apps/backend/src/routes/assessments.ts`, `workspaces.ts`,
  `activity.ts`, `audit.ts`, `contracts/api-response.ts`,
  `repositories/assessments.repository.ts`,
  `repositories/evidence.repository.ts` (from the PHX-BACKEND-008-R1
  tar) — confirmed the actual live route surface, response envelope,
  and exact field names/shapes for assessment detail, evidence, and
  score, rather than trusting the task brief's endpoint list at face
  value.
- `packages/core/src/contracts/{asset,assessment,activity,audit,
  pbrs-score}.ts` and `packages/core/src/index.ts` (`PBRS_DIMENSIONS`,
  `PBRSScore`) — confirmed the six-dimension model fields and that no
  scoring math needed to be reproduced client-side (the backend's
  `score.summary` is the exact `PBRSScore` JSON already computed
  server-side).

### A pre-existing bug found during this read

`real-api-client.ts`'s `realFetch<T>()` (from PHX-PLATFORM-010) parsed
a non-2xx response body for an error message but, on a 2xx response,
returned `response.json()` directly — as if the JSON body **were** the
payload. Every actual backend response (confirmed against
`contracts/api-response.ts` and every route handler) is wrapped in
`{ ok, data, error, requestId }`. This was a latent bug in every prior
real-read sprint's client, never exercised because no page had been
migrated onto it yet. Fixed as part of Task 3 (see below) rather than
carried forward silently.

### A genuine gap found during this read

No sprint before this one gave `production-auth` mode a workspace id to
scope workspace-level reads to (`real-dev` has
`NEXT_PUBLIC_PHOENIX_DEV_WORKSPACE_ID`; production-auth had nothing).
Backend-driven "workspace membership resolution from authenticated
identity" is explicitly future PHX-AUTH-001 work, not this sprint's.
Rather than invent a mock/guessed workspace id, this sprint adds an
explicitly interim, documented bridge var
(`NEXT_PUBLIC_PHOENIX_PRODUCTION_WORKSPACE_ID`) and treats its absence
as a `config-missing`-shaped state on every migrated section — see
Task 2 and Limitations.

## Task 1 — Live Read Scope

**Migrated (real-dev + production-auth):**

| Page/section | What's live |
|---|---|
| `/dashboard` | Total assessment count, status breakdown, recent assessments (raw id/title/status/timestamp) |
| `/assessments` | Full assessment list (raw fields; no department/risk/grade — see Task 5) |
| `/assessments/[assessmentId]` | Assessment title/status, PBRS score (all six dimensions + derived signals, passthrough of backend's exact score JSON), evidence list |
| `/settings` | Activity + audit record preview (Task 7) |

**Explicitly NOT migrated — mock-backed/preview-only in every mode:**

| Page | Why |
|---|---|
| `/passports` | No live passport endpoint exists (backend `passports.ts` router's read side was not in this sprint's endpoint list). |
| `/certifications` | Same — no live certification endpoint. |
| `/reports` | Same — no live report endpoint. |
| `/assessments/new` | Write flow, out of scope (governance actions remain `mode === 'mock'`-only, unchanged from PHX-PLATFORM-009/010). |

Each of the three preview-only pages now renders a `PreviewOnlyNotice`
(new, `components/DataStatePanel.tsx`) directly under its
`WorkspaceHeader` whenever `apiConfig.mode !== 'mock'`, stating plainly
that the page's live endpoint doesn't exist yet and the data shown is
mock, not real workspace data. `/assessments/new` was left as-is
(mock-only form; no notice added) since it is a write flow, not a read
surface this sprint's scope covers.

**Dashboard fields deliberately omitted, not fabricated:** the
backend's assessment LIST endpoint (`GET
/api/workspaces/:workspaceId/assessments`) returns
id/title/status/owner/timestamps only — no score. The mock dashboard's
"Overall Readiness", "Avg. Confidence", "Certified Assets" stat cards
and the PBRS dimension grid have no live equivalent this sprint. Rather
than compute a fake average or show zero, the live dashboard shows only
what the list endpoint actually returns (assessment count, status
breakdown, recent list) with an explicit inline note explaining the
omission and pointing to `/assessments/[id]` for a real scored
assessment.

## Task 2 — Data Source Boundary

New `apps/platform/src/lib/platform-data-source.ts`. Exports:

```ts
type PlatformDataMode = 'mock' | 'real-dev' | 'production-auth' | 'real-disabled';
type DataSourceStatus =
  | 'mock' | 'live' | 'auth-required' | 'config-missing'
  | 'backend-unavailable' | 'permission-denied' | 'not-found' | 'not-wired';
interface LiveResult<T> { status: DataSourceStatus; mode: PlatformDataMode; data?: T; message?: string }
```

**Deliberate deviation from the task brief's suggested six-value
`DataSourceStatus`:** added `'permission-denied'` and `'not-found'`.
Task 6 (assessment detail) explicitly requires a distinct 404 state;
Task 7 (Settings audit) explicitly requires distinguishing "signed in
but not authorized" (a backend 403 on `audit.read`) from every other
failure. None of the original six values honestly describe either
case — labeling a 403 as `backend-unavailable`, for instance, would
tell a Viewer/Contributor the backend was down when it was actually
working correctly and enforcing permissions. This is called out
explicitly rather than silently added.

One function per migrated surface: `loadDashboardData()`,
`loadAssessmentsListData()`, `loadAssessmentDetailData(assessmentId)`,
`loadSettingsActivityAuditData()`. Each:

1. Returns `{ status: 'mock', mode }` immediately in `mock` mode —
   never imports/calls `real-api-client.ts` in that branch.
2. Returns `{ status: 'not-wired', mode }` immediately in
   `real-disabled` mode.
3. In `real-dev`/`production-auth`, resolves a workspace id via
   `resolveLiveWorkspaceId()` (devWorkspaceId / productionWorkspaceId —
   see Task 2 gap above); returns `config-missing` if unset.
4. Calls the matching `real-api-client.ts` function(s) and maps any
   thrown error to the matching `DataSourceStatus` via
   `errorToLiveResult()` — auth-required, permission-denied, not-found,
   config-missing, or backend-unavailable. Never falls through to mock
   data on any error path.

Pages import one loader function each; no page re-implements the
mock/real-dev/production-auth branch itself beyond the one
`apiConfig.mode === 'mock'` check needed to pick which JSX tree to
render (kept for readability/preserving byte-identical mock rendering,
not duplicated mode-resolution logic).

## Task 3 — Real API Client Read Coverage

`real-api-client.ts` changes:

- **Fixed `realFetch<T>()`** (see "pre-existing bug" above): now parses
  the backend's `{ ok, data, error, requestId }` envelope on every
  response (any HTTP status), returns `envelope.data` on success, and
  maps `envelope.error.code` (`ApiErrorCodes` from
  `contracts/api-response.ts`) to the correct typed `RealApiError` via
  a new `backendErrorToRealApiError()` helper — `FORBIDDEN` →
  `PERMISSION_DENIED`, `NOT_FOUND` → `NOT_FOUND`, `DATABASE_UNAVAILABLE`
  → `DB_UNAVAILABLE`, etc. A `200` response with `ok: false` in the
  body (a backend edge case) is now also treated as an error, not a
  silent empty success.
- Added `cache: 'no-store'` to the `fetch()` call (see Task 10 —
  without this, Next.js's static-generation could bake a build-time
  snapshot into the page).
- Added three new exported functions the backend has supported since
  PHX-BACKEND-003 but no prior sprint wired: `realGetAssessmentDetail`,
  `realGetAssessmentEvidence`, `realGetAssessmentScore`. Added matching
  `BackendAssessmentDetail`, `BackendEvidenceItem`, `BackendScore`,
  `BackendDimensionScore`, `BackendDerivedSignal`, `BackendScoreSummary`
  types, mirrored field-for-field from the actual repository/route
  source (not guessed from the API contract doc).
- `realGetWorkspace`, `realGetAssessments`, `realGetWorkspaceActivity`,
  `realGetWorkspaceAuditRecords` (all pre-existing from
  PHX-LIVE-001/PHX-PLATFORM-010) are unchanged in signature; they now
  benefit from the `realFetch()` fix automatically.
- Governance actions remain untouched — still only `mode === 'mock'`
  special-cased in `api-client.ts`; every other mode still returns the
  documented "not enabled" result. No write endpoint was connected.

## Task 4 — Dashboard Migration

`apps/platform/src/app/(platform)/dashboard/page.tsx` restructured into
two branches on `apiConfig.mode === 'mock'`:

- **mock branch:** byte-for-byte the PHX-PLATFORM-009/010 JSX and data
  calls (`getDashboardSummary()`, `getCurrentWorkspace()`,
  `getActivityLog(5)`), unchanged.
- **live branch** (`real-dev`/`production-auth`/`real-disabled`): calls
  `loadDashboardData()`. On `'live'`, shows a `LiveDataBadge`, two stat
  cards derivable from the list endpoint (total assessments, distinct
  statuses represented), an explicit note about which mock stat cards
  are omitted and why, and the five most recent assessments via the new
  `LiveAssessmentsTable`. On any other status, renders the matching
  `DataStatePanel` variant via `renderDataStatePanel()` — no mock
  fallback.

`getCurrentWorkspace()` (for the header's workspace-name eyebrow) is
still called unconditionally — this is shell chrome, not one of the
four migrated data surfaces, and remains mock-derived display text in
every mode (unchanged scope from PHX-PLATFORM-010).

## Task 5 — Assessments List Migration

`apps/platform/src/app/(platform)/assessments/page.tsx`: same
mock/live branch pattern. Live branch calls
`loadAssessmentsListData()` and renders the new `LiveAssessmentsTable`
component (title, status, created date — the exact fields the backend
list endpoint returns) instead of `AssessmentsClient`/`AssessmentTable`
(which require the mock view model's score/grade/risk/department
fields). No filter UI is shown on the live branch this sprint: the only
field genuinely available to filter by is `status`, and building a
single-field filter control for parity with the four-field mock filter
panel was judged not worth the added surface for this sprint's scope —
documented here as an explicit choice, not an oversight. Empty backend
list renders `LiveAssessmentsTable`'s built-in empty state; backend
unavailable/auth-required/etc. render `DataStatePanel`.

## Task 6 — Assessment Detail Migration

`apps/platform/src/app/(platform)/assessments/[assessmentId]/page.tsx`:
same mock/live split. Live branch calls `loadAssessmentDetailData()`,
which fetches detail + evidence + score in parallel. On `'live'`:

- Assessment title/status (from `detail.assessment`).
- PBRS score via new `LiveScorePanel` — passthrough display of the
  backend's exact `PBRSScore` JSON (all six dimensions via
  `PBRS_DIMENSIONS` labels, overall/grade/tier, the three derived
  signals). Shows "No PBRS score available yet." when `score` is
  `null` (assessment exists but hasn't been scored — a 200 with
  `data: null` per the backend's own documented behavior, not an
  error).
- Evidence via new `LiveEvidenceList` (type, title, note, related
  dimension, source link) when non-empty; explicit empty state
  otherwise.
- Audit trail / activity timeline are **omitted with an explicit
  label** rather than shown: the backend only exposes
  workspace-scoped activity/audit (PHX-BACKEND-008-R1), not
  assessment-scoped — those are deferred to PHX-BACKEND-009B. The page
  says so and points to `/settings` for the workspace-level preview.

`result.status === 'not-found'` calls Next's `notFound()`, matching the
mock branch's `notFound()` behavior on a missing mock assessment.
`403`/`401`/`503` map to `permission-denied`/`auth-required`/
`backend-unavailable` panels via `renderDataStatePanel()`.

## Task 7 — Settings Runtime / Activity / Audit

`apps/platform/src/app/(platform)/settings/page.tsx`:

- Runtime indicator block gained one line: "Data source
  (activity/audit): mock / live / auth-required / config-missing /
  permission-denied / not-wired" (the exact resolved
  `DataSourceStatus`), alongside the existing API mode / backend URL /
  Clerk config / auth-state lines from PHX-PLATFORM-010/010-R1.
- The "Audit Preview" panel now branches: **mock mode** is unchanged
  (`RoleGate` + mock `getAuditRecords()`, byte-for-byte from
  PHX-PLATFORM-006/010-R1). **real-dev/production-auth** calls
  `loadSettingsActivityAuditData()` and, on `'live'`, renders two new
  components — `LiveActivityList` and `LiveAuditList` — showing the
  backend's actual activity and audit-record rows. A `403` from the
  backend's own `audit.read` permission check (e.g. a Viewer or
  Contributor identity) surfaces as the `PermissionDeniedPanel`, not as
  empty or fake data — this is the backend's real enforcement being
  reflected, not the mock session's `RoleGate`/`canViewAuditTrail`
  (which is UI-only and irrelevant to a live identity's actual backend
  permissions).
- The Workspace/Scoring Profile/Notification Preferences/Brand
  Profile/Data Retention panels remain mock-backed in every mode
  (Task 1's scope explicitly does not include them) — the page's
  "still mock-backed" note was reworded to name exactly which panels
  that applies to, now that Activity/Audit is live.

## Task 8 — Mock Data Transparency Banner Update

`MockDataTransparencyBanner.tsx` copy replaced. The 010-R1 version said
"some platform data is still mock-backed" while literally every page
was mock-backed — now that Dashboard/Assessments/Assessment
Detail/Settings-activity-audit are live in production-auth, that
blanket claim would be actively wrong (telling a signed-in user their
live dashboard "is still mock-backed" when it isn't). New copy names
which pages are live and which three remain preview-only. The banner
is not removed — Passports/Certifications/Reports still have no live
endpoint, so it remains accurate that "not every visible section is
live." Rendering location/logic (`ProductionAuthGate`'s signed-in
branch only) is unchanged.

## Task 9 — Error/State Components

New `apps/platform/src/components/DataStatePanel.tsx`: a shared
`DataStatePanel` base plus `BackendUnavailablePanel`,
`AuthRequiredPanel`, `PermissionDeniedPanel`, `ConfigMissingPanel`,
`NotFoundPanel`, `PreviewOnlyNotice`, `LiveDataBadge`, and a
`renderDataStatePanel(status, message)` dispatcher every migrated page
calls instead of re-implementing the status→panel switch itself.
Navy/cyan, minimal, no loud alert styling — amber accent only for the
two states that genuinely warrant a warning tone
(backend-unavailable/config-missing).

Also new, purely for live-data rendering (not "error" components, but
part of "shared components if useful"): `LiveAssessmentsTable`,
`LiveScorePanel`, `LiveEvidenceList`, `LiveActivityAuditLists`
(`LiveActivityList` + `LiveAuditList`). These exist because the
existing mock-shaped components (`AssessmentTable`, `AssessmentScoreSummary`,
`EvidenceLibrary`, `ActivityTimeline`, `AuditTrailPreview`) require
fields (department, risk level, grade, `ActivityLog.type`, etc.) the
live endpoints do not return — reusing them would require fabricating
those fields, which the task explicitly prohibits ("do not fabricate
departments/risk labels unless clearly marked as placeholder").
Building small, honest, live-shaped components was judged better than
either fabricating fields or omitting sections entirely.

## Task 10 — QA Matrix

See `PHX_PLATFORM_011_QA_REPORT.md` for full commands/output.
Summary: `pnpm install`, `type-check`, `lint` all clean; four `next
build` runs (mock, real-dev, production-auth-with-fake-config,
production-auth-missing-config) all exit 0.

**A correctness issue found and fixed during this task:** the first
build attempt revealed `/dashboard`, `/assessments`, and `/settings`
were being statically generated (`○`) even though they now call
`fetch()` at request time — Next.js's App Router defaults `fetch()` to
static/build-time caching unless a route is forced dynamic. Left as-is,
this would have baked a single build-time snapshot (or a build-time
"backend unavailable" state, since no backend runs during `next
build`) into the page forever, defeating the entire point of a live
read. Fixed by adding `export const dynamic = 'force-dynamic'` to
`dashboard/page.tsx`, `assessments/page.tsx`, and `settings/page.tsx`
(the assessment detail page was already dynamic, forced by its
`[assessmentId]` param), and `cache: 'no-store'` on the underlying
`fetch()` call in `real-api-client.ts`. Re-verified via a fresh mock
build showing all four migrated routes as `ƒ` (dynamic) afterward.

## Task 11 — Documentation

This file, plus `PHX_PLATFORM_011_QA_REPORT.md`,
`RELEASE_NOTES_PHX_PLATFORM_011.md`, `BUILD_REPORT_PHX_PLATFORM_011.md`.

## Task 12 — No Regression / No Launch Claims

- No public deployment; no production/customer launch claimed anywhere
  in this deliverable.
- `mock` mode is unchanged byte-for-byte in every migrated page's mock
  branch — verified by isolating each mock branch to the exact prior
  JSX/data calls.
- `real-dev` still sends only `X-Phoenix-User-Id`, never `Authorization`
  — confirmed unchanged in `resolveAuthHeaders()` and by grep (see QA
  report).
- `production-auth` still sends only `Authorization: Bearer`, never
  `X-Phoenix-User-Id` — same confirmation.
- No token is ever written to `localStorage`/`sessionStorage` anywhere
  in the platform app (grep confirms the only `localStorage` usage in
  the codebase is `mock-session.ts`'s pre-existing, unrelated mock-role
  switcher).
- No migrated page falls back to mock data on any live-read failure —
  every non-`mock`, non-`live` status renders an explicit
  `DataStatePanel` variant.
- Passports/Certifications/Reports clearly labeled preview-only via
  `PreviewOnlyNotice` in every non-mock mode.
- No PBRS scoring logic was written; `LiveScorePanel` only displays the
  backend's already-computed `PBRSScore` JSON using `PBRS_DIMENSIONS`
  labels. No certification threshold or dimension weight was touched.
- No backend source file was modified — this tar contains platform
  (frontend) changes only.

## Limitations

- **Production-auth workspace resolution is an interim bridge, not a
  real solution.** `NEXT_PUBLIC_PHOENIX_PRODUCTION_WORKSPACE_ID` is a
  single, statically-configured workspace id for the whole deployment —
  it does not vary per signed-in user and does not reflect real
  workspace membership. A future sprint (per PHX-AUTH-001's roadmap)
  must add a real "workspaces for this identity" backend endpoint and
  replace this bridge.
- Dashboard live stats are limited to what the assessment list endpoint
  returns (count, status breakdown, recent list) — no live overall
  score, confidence, or certified-asset count this sprint.
- Assessments list has no live filter UI (see Task 5).
- Assessment detail's audit/activity is omitted with a label, not
  shown scoped-down — assessment-scoped activity/audit endpoints are
  PHX-BACKEND-009B, not yet implemented.
- No real Clerk account or real running backend was used for QA — all
  four builds are static/type/lint verification plus code-review-level
  confirmation of the header/fallback boundaries, consistent with
  PHX-PLATFORM-010/010-R1's own stated QA approach. A live local run
  against a seeded backend (Task 10's "Live local verification")
  requires a running PostgreSQL + backend process, which is out of
  scope for this document-and-build-verification pass — see QA report
  "What was not run" for the exact commands a future session should
  run to complete that verification.
- Public launch remains a firm No-Go; nothing in this deliverable
  claims otherwise.
