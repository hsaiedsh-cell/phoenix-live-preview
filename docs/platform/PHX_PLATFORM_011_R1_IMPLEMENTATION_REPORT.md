# PHX-PLATFORM-011-R1 — Implementation Report

**Task:** Server-Side Production Auth Token & Live Backend Verification Fix
**Base:** PHX-PLATFORM-011-LIVE-READ-MIGRATION
**Type:** Targeted correctness fix + QA completion. No new product features,
no public deployment, no PBRS/scoring/certification-threshold changes,
no backend auth logic changes (backend was only used as a fixed,
unmodified test target for live verification — no backend file in this
tar was edited).

## Issue 1 — Server-side production-auth token retrieval

### Problem confirmed

PHX-PLATFORM-011 migrated `/dashboard`, `/assessments`,
`/assessments/[id]`, and `/settings` into Server Component data-loading
paths (via `platform-data-source.ts`), but `real-api-client.ts`'s
`resolveAuthHeaders()` called `getBackendAuthHeaders()` from
`auth/platform-auth.client.ts` **unconditionally** for `production-auth`
mode. That function's own (correct, by-design) guard —
`if (typeof window === 'undefined') return { ok: false, ... }` — means
it always returns `{ ok: false }` when called from a Server Component,
since `window` does not exist server-side. The practical consequence:
**every production-auth live read from a Server Component always failed
with `auth-required`, even with a valid, signed-in Clerk session.**
PHX-PLATFORM-011's own QA never caught this because it only ran
type-check/lint/build (which all pass regardless — the bug is a runtime
logic error, not a type error) and never exercised a real request path.

### Fix — Option A (preferred), file split

`real-api-client.ts` is now three files:

- **`real-api-client.ts`** (shared) — every `Backend*` type, the error
  classes (`RealApiError`, `RealApiConfigError`,
  `RealApiAuthRequiredError`, `RealDevUnsupportedError`), the
  disabled/misconfigured/auth-required envelope helpers, and
  `realFetch<T>(path, authHeaders)`. This function now takes
  **already-resolved** headers as a parameter instead of resolving them
  itself — it has no import of `@clerk/nextjs`, no import of either
  `auth/platform-auth.{server,client}.ts`, and no reference to `window`.
  Safe to import from anywhere.
- **`real-api-client.server.ts`** (new) — Server Component / server-only
  reads. `resolveServerAuthHeaders()` uses
  `auth/platform-auth.server.ts`'s `getServerBackendToken()`, which
  calls `@clerk/nextjs/server`'s real `auth()` to read the request's
  actual Clerk session server-side. This is what `platform-data-source.ts`
  now imports its `realGet*` functions from.
- **`real-api-client.client.ts`** (new) — Client Component reads, for
  future use. `resolveClientAuthHeaders()` uses
  `auth/platform-auth.client.ts`'s `getBackendAuthHeaders()` (the
  original, browser-only function) — correct here, since this file is
  only ever meant to run in the browser. **Not called by any page this
  sprint** — every migrated page is a Server Component — but the seam
  exists so a future client-side fetch (e.g. a refresh button) has an
  obviously-correct place to import from instead of either reaching for
  the server file (a real Next.js server/client bundling violation,
  since it transitively imports `@clerk/nextjs/server`) or reinventing
  header resolution inline.

`platform-data-source.ts` now imports `realGetAssessments`,
`realGetAssessmentDetail`, `realGetAssessmentEvidence`,
`realGetAssessmentScore`, `realGetWorkspaceActivity`,
`realGetWorkspaceAuditRecords` from `real-api-client.server.ts` — the
error classes and `Backend*` types still come from the shared
`real-api-client.ts`. This is the one-line-per-import change that
actually fixes the bug: every migrated page now resolves a real,
server-side Clerk token in production-auth instead of always failing
closed.

### Config-vs-auth-required distinction preserved

`resolveServerAuthHeaders()`'s production-auth branch checks
`getServerAuthConfigStatus().fullyConfigured` **before** calling
`getServerBackendToken()` — mirroring the config-then-token-getter
order the original (buggy) client-side resolver used, and matching
`platform-auth.server.ts`'s own `resolveProductionAuthState()` pattern.
This means a missing Clerk config still throws `RealApiConfigError`
(→ `config-missing`), and only once config is confirmed present does a
missing/expired session throw `RealApiAuthRequiredError`
(→ `auth-required`) — the same two-state distinction PHX-PLATFORM-011
already required, just now reachable via the correct (server) code path.

### Verified boundaries

- `grep` confirms `platform-auth.server.ts` is imported only by Server
  Components (`ProductionAuthGate.tsx`, `settings/page.tsx`) and
  server-only modules (`real-api-client.server.ts`) — never by a
  `'use client'` file.
- `grep` confirms `platform-auth.client.ts` is imported only by
  `real-api-client.client.ts` (client-only, unused by any page) — never
  by `platform-data-source.ts` or any Server Component page.
- `platform-auth.ts` (the isomorphic re-export file) imports both via
  `export type { ... }` only — type-only imports are erased at compile
  time, so this introduces no runtime cross-boundary import regardless
  of which context re-exports it from.
- `X-Phoenix-User-Id` is set only in each file's own `real-dev` branch;
  `Authorization: Bearer` only in each file's own `production-auth`
  branch. Neither file's real-dev branch can reach the other's
  production-auth branch or vice versa (confirmed by grep — see QA
  report).
- No token is ever written to `localStorage`/`sessionStorage` anywhere
  in either new file or the modified shared file.
- Token values are never logged in either new file — `resolveServerAuthHeaders()` /
  `resolveClientAuthHeaders()` only ever branch on `result.ok`, never
  print or return `result.token` except directly into the `Authorization`
  header string.

## Issue 2 — Live local verification

### What was done (real, not simulated)

Unlike PHX-PLATFORM-011, this session actually stood up the full stack:

1. **Installed PostgreSQL 16** via `apt-get install postgresql
   postgresql-contrib` (this sandbox had no database engine available
   before this task).
2. **Created the `phoenix`/`phoenix_dev` role and database**, matching
   `apps/backend/docker-compose.yml`'s dev credentials exactly.
3. **Copied the approved backend source** from the PHX-AUTH-002-R1
   deliverable (`apps/backend` — the most recent, complete backend
   tree, including `dev-header` auth mode and every route this sprint
   needed) into a runnable working directory. No file inside it was
   edited.
4. **Ran migrations** (`tsx src/db/migrate.ts`) — applied
   `0001_initial_schema.sql` and `0002_auth_identities.sql` cleanly.
5. **Ran the seed script** (`tsx src/db/seed.ts`) — loaded 1 workspace,
   6 users (one per role: Owner, Admin, Reviewer, Contributor, Viewer,
   Auditor), 3 assets, 4 assessments (2 scored, 2 unscored), 6 evidence
   items, 2 PBRS scores, 1 audit record, 3 activity log entries.
6. **Started the backend** with `PHOENIX_AUTH_MODE=dev-header`,
   `PHOENIX_ENABLE_DATABASE=true`, and a real `DATABASE_URL` pointing at
   the local Postgres instance. Confirmed via `curl
   http://localhost:4000/api/readiness` → `database.status: "connected"`,
   `auth.mode: "dev-header"`.
7. **Built and started the platform** (`next build` + `next start -p
   3001`) with `NEXT_PUBLIC_PHOENIX_API_MODE=real-dev`,
   `NEXT_PUBLIC_PHOENIX_BACKEND_URL=http://localhost:4000`,
   `NEXT_PUBLIC_PHOENIX_DEV_USER_ID`/`_DEV_WORKSPACE_ID` set to the
   seeded Owner user and workspace.
8. **Curled the running platform's HTML** for each migrated page and
   grepped for seeded backend content vs. known mock-only content (per
   the task's explicit fallback instruction, since no browser automation
   tool was available in this environment).

### A second, more serious bug found by this verification

Curling the real backend directly (`curl -H "x-phoenix-user-id: ..."
http://localhost:4000/api/workspaces/:id/assessments`) revealed that
**every `Backend*` type in `real-api-client.ts` except
`BackendEvidenceItem`/`BackendScore`/`BackendDimensionScore`/
`BackendDerivedSignal` was wrong.** PHX-PLATFORM-011 had written these
types by reading the raw SQL `SELECT ... AS snake_case` column aliases
inside each repository query and assuming that was the JSON shape
returned to the client. It is not: every repository function maps its
SQL row to a **camelCase** record type before the route handler passes
it to `success()`. Concretely:

| Type | PHX-PLATFORM-011 assumed | Actual (verified via curl) |
|---|---|---|
| `BackendWorkspace` | `{id, name, owner_id, created_at, updated_at}` | `{id, organizationId, name, slug, settings, status, createdAt, updatedAt}` |
| `BackendAssessment` (list row) | `{id, workspace_id, title, status, created_by, created_at, updated_at}` — assumed **no score data** | `{assessmentId, assetId, assetName, assetType, status, overallScore, grade, riskLevel, createdAt, updatedAt}` — **does** include score data per row |
| `BackendAssessmentDetail.assessment` | snake_case, includes a nonexistent `title` field | camelCase `AssessmentDetail` shape — no `title`; asset's `name` is the closest display name |
| `BackendAssessmentDetail.workspace` | full `BackendWorkspace` shape | a smaller summary: `{id, name, slug}` only |
| `BackendActivityItem` | `{id, workspace_id, actor_id, actor_display_name, action, entity_type, entity_id, created_at}` | `{id, workspaceId, type, actorUserId, actorDisplayName, summary, relatedEntityType, relatedEntityId, createdAt}` — no `action`/`entity_type`; a pre-composed `summary` sentence instead |
| `BackendAuditRecord` | snake_case, assumed an `actor_display_name` field | camelCase; **no display-name field at all** — only `actorUserId` (raw id or null for a system action) |

This means PHX-PLATFORM-011's implementation report's claim that "the
dashboard/assessments-list endpoint returns no score data" was **also
wrong** — it does, and this R1 now surfaces it (see below). Every
dependent file was corrected:

- `real-api-client.ts` — all six `Backend*` interfaces rewritten to the
  verified camelCase shapes (`BackendAssessmentDetail` also gained two
  new named sub-types, `BackendAssessmentDetailRecord` and
  `BackendAssessmentAssetSummary`/`BackendAssessmentWorkspaceSummary`,
  to represent the two different workspace-shaped objects — a full
  `BackendWorkspace` from `GET /api/workspaces/:id` vs. the smaller
  summary embedded in assessment detail).
- `platform-data-source.ts` — `LiveDashboardData` gained a
  `scoredInPage` field (count of loaded rows with a non-null
  `overallScore`), explicitly labeled as page-scoped, not a
  workspace-wide aggregate (computing a true aggregate would mean
  paging through every assessment, which this file does not do).
- `components/LiveAssessmentsTable.tsx` — rewritten to use
  `assessmentId`/`assetName`/`assetType`/`createdAt`, and now shows the
  score/grade/risk columns that ARE available.
- `components/LiveActivityAuditLists.tsx` — rewritten to use
  `summary`/`actorDisplayName`/`createdAt` for activity, and
  `entityType`/`actorUserId` (shown as a truncated id, or "System" when
  null — there is no display name to show) for audit records.
- `app/(platform)/dashboard/page.tsx` — corrected the "no score data"
  claim in both the code comment and the rendered copy; added a
  "Scored (this page)" stat card using `scoredInPage`.
- `app/(platform)/assessments/[assessmentId]/page.tsx` — fixed
  `result.data.detail.assessment.title` (a field that never existed) to
  `result.data.detail.asset.name`.

None of this touches PBRS scoring, dimension weights, or certification
thresholds — every corrected type is a read-only display shape mirrored
from the backend's own repository interfaces, not a computation.

### Live verification results

All commands and full output are in
`docs/platform/PHX_PLATFORM_011_R1_QA_REPORT.md`. Summary:

- ✅ `/assessments` renders the three seeded asset names ("Q3 Investor
  Update Draft", "Customer Data Handling Policy", "Product Launch Social
  Campaign") and zero mock-only names ("Executive AI Brief", "HR Policy
  Summary", etc.).
- ✅ `/assessments/[assessmentId]` for the seeded, scored "Q3 Investor
  Update Draft" assessment renders its real score (87.15, grade B+) and
  a "Live backend data" badge.
- ✅ `/dashboard` renders live-derived assessment count/statuses and the
  same seeded names, with a "Live backend data" badge.
- ✅ `/settings`, signed in as the seeded **Owner**, renders real
  activity (`Priya Nair`, seeded activity summaries) and audit records
  (`assessment.decision.approved`).
- ✅ `/settings`, restarted as the seeded **Viewer** (no `audit.read`
  permission), renders the `PermissionDeniedPanel` ("Permission
  required" / "does not have permission") — confirmed via `curl` and
  `grep`, with the live audit data confirmed **absent** from that
  response.
- ✅ With the backend process killed, `/assessments` and `/dashboard`
  both render `BackendUnavailablePanel` ("Backend unavailable") — no
  mock or stale data was shown.

### What was NOT completed — real Clerk / production-auth E2E

**No real Clerk account was used or is claimed.** Production-auth's
server-side token path (`real-api-client.server.ts` →
`getServerBackendToken()` → `@clerk/nextjs/server`'s `auth()`) is
verified by:

- Type-check (clean).
- Code inspection (confirmed the correct import boundaries, confirmed
  the header-setting logic, confirmed the config-before-token-getter
  ordering).
- Four `next build` runs across all four required configurations
  (mock, real-dev, production-auth-with-fake-config,
  production-auth-missing-config), all exit 0.

A genuine end-to-end round trip — a real signed-in Clerk browser
session, a real JWT reaching this backend, and the backend's
`oidc-jwt` resolver verifying it — was **not** exercised. This remains
the same limitation PHX-PLATFORM-010/010-R1/011 all documented; it
requires a real (even free-tier) Clerk application, which is out of
scope ("no paid/provider account should be required").

## Files changed vs. PHX-PLATFORM-011 (confirmed via full-tree diff)

**Modified:**
- `apps/platform/src/lib/real-api-client.ts`
- `apps/platform/src/lib/platform-data-source.ts`
- `apps/platform/src/app/(platform)/dashboard/page.tsx`
- `apps/platform/src/app/(platform)/assessments/page.tsx`
- `apps/platform/src/app/(platform)/assessments/[assessmentId]/page.tsx`
- `apps/platform/src/components/LiveAssessmentsTable.tsx`
- `apps/platform/src/components/LiveActivityAuditLists.tsx`

**Added:**
- `apps/platform/src/lib/real-api-client.server.ts`
- `apps/platform/src/lib/real-api-client.client.ts`

No file under `apps/backend/`, `apps/website/`, `apps/dashboard/`, or
any PBRS/scoring/certification-threshold file was touched. No file
under `packages/` was touched.

## No-regression confirmation

- No public deployment performed or claimed.
- No customer onboarding, auto-provisioning, or new product feature
  added.
- No backend source file modified (the backend used for live
  verification is the unmodified PHX-AUTH-002-R1 deliverable, used only
  as a fixed test target).
- No Clerk secret committed (the `pk_test_.../sk_test_...` build-time
  values are syntactically-valid-format placeholders, not real
  credentials).
- No token `localStorage`/`sessionStorage` usage introduced.
- `mock` remains unchanged and default.
- `real-dev` remains a dev-header-only local preview mode, verified
  working end-to-end against a real seeded database this session.
- `production-auth` remains an explicit opt-in mode; its Server
  Component token path is now correct by construction, verified by
  type-check/build/code-review (not a real Clerk E2E — see above).
- No passport/certification/report endpoint was connected.
- No PBRS dimension, weight, or certification threshold was changed.

## Limitations

- Real Clerk E2E was not performed (see above) — this is stated
  explicitly, not implied otherwise anywhere in this deliverable.
- `scoredInPage` (dashboard) is a per-page-load count, not a true
  workspace-wide aggregate — computing the latter correctly would
  require paging through every assessment in the workspace, which is
  out of scope for this fix.
- Live verification used a single seeded workspace with 4 assessments
  and 6 users (one per role) — it was not a load test or a multi-
  workspace test.
- The PostgreSQL instance, backend process, and platform process
  started during this session are running in this sandbox only; they
  are not part of the deliverable tar and will not persist.
- Public launch remains a firm No-Go; nothing in this deliverable
  claims otherwise.
