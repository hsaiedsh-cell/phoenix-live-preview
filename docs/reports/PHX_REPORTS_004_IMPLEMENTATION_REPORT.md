# PHX-REPORTS-004 — Implementation Report

**Report Generation Lifecycle & Secure Artifact Delivery Foundation**

Branch: `phx-reports-004` · Baseline: `d9d5ba3bc52e8683b85f33f06d62865b72ce851f`

Authoritative basis: `PHX-REPORTS-004-OFFICIAL-TASK-BRIEF.md`, the Phase 1 Plan,
Phase 1 Addendum A, and Phase 1 Addendum B (all ChatGPT architecture/QA-reviewed
and approved before implementation began).

---

## 1. Summary of implemented behavior

- **Database**: two new migrations (`0005_report_generation_jobs.sql`,
  `0006_report_artifacts.sql`), pure additions after `0004_report_version.sql`.
  Verified against a real PostgreSQL 16 instance on both a fresh database
  (0001→0006 in one run) and an upgrade path (0001–0004 already applied, 0005–0006
  applied on top).
- **Backend lifecycle**: all 4 previously-stubbed endpoints implemented for real —
  `GET /api/workspaces/:workspaceId/reports`, `GET /api/reports/:reportId`,
  `POST /api/reports/:reportId/generate`, `GET /api/reports/:reportId/download`.
  The pre-existing `POST /api/workspaces/:workspaceId/reports` (PHX-REPORTS-003)
  is untouched.
- **Generation worker**: a persistent, database-backed job queue
  (`report_generation_jobs`), claimed via `SELECT ... FOR UPDATE SKIP LOCKED`,
  with process-unique worker IDs, heartbeat-based lease renewal, fenced
  completion/failure writes, bounded linear-backoff requeue, and a two-branch
  lease-reclaim sweep (reclaim vs. terminal-fail-when-exhausted). Both a
  continuous dev loop (`report-generation-worker.ts`) and a deterministic
  once/batch CLI (`report-worker-once.ts`) share one orchestration function
  (`services/report-generation.service.ts`).
- **Artifacts**: a provider-neutral `ReportArtifactStore` interface with a local
  filesystem adapter (deterministic server-generated keys, atomic temp-then-rename
  writes, path-traversal/absolute-path guards, post-write checksum re-read,
  size-bounded reads) and a fail-closed disabled adapter for when no store is
  configured. A three-condition, grace-period-gated reconciliation sweep cleans up
  genuine orphan files without racing a live in-flight generation.
- **Renderers**: real PDF (via `pdfkit`), HTML, and CSV renderers for both
  approved templates (`asset-readiness-summary`, `workspace-portfolio-summary`),
  reading real persisted PBRS data through existing/new read-only repository
  functions. Three distinct sanitizers (HTML-escape, PDF control-character
  strip + NFC normalize, CSV formula-injection-safe cell writer with a
  separate numeric-cell path).
- **Platform**: real-dev/production-auth now read live report data
  (`loadReportsListData()` widened, new `loadReportDetailData()`) and render an
  action-aware table (`LiveReportsActionTable.tsx` / `ReportDetailPoller.tsx`)
  with real Start/Retry/Regenerate/Download actions and bounded polling.
  `vercel-supabase-preview` remains read-only (its query now also selects
  `report_version`). `mock`/`real-disabled` are unchanged.

## 2. Complete changed/added/deleted file inventory

No files were deleted. See `git diff --stat` output (`04_git_diff_stat.txt` in
the QA evidence bundle) for exact line counts on every changed file.

### Changed
- `.gitignore` — local artifact storage dir + `*.tsbuildinfo` added.
- `apps/backend/.env.example` — new worker/storage env vars documented.
- `apps/backend/package.json` — `pdfkit` dependency, `pdf-parse`/`@types/pdfkit`
  devDependencies (all exact-pinned), 4 new worker scripts.
- `apps/backend/src/auth/ownership.ts` — added `ReportOwnershipContext`,
  `canGenerateReport()`.
- `apps/backend/src/auth/ownership-guards.ts` — added `'reports.generate'` to
  `OwnershipAction`, added `requireReportOwnership()`.
- `apps/backend/src/repositories/activity.repository.ts` — `actorUserId` widened
  to `string | null`, added `'ReportGenerated'` activity type.
- `apps/backend/src/repositories/audit.repository.ts` — `actorUserId` widened to
  `string | null`, added 6 new audit actions.
- `apps/backend/src/repositories/reports.repository.ts` — ~530 new lines: canonical
  read model, list/detail queries, lazy-expiry normalization, the generate/retry/
  regenerate transition, the integrity-failure transition, worker-facing
  generation-context + fenced completion/failure helpers.
- `apps/backend/src/routes/reports.ts` — the 4 stubs replaced with real handlers.
- `apps/backend/src/validation/route-params.ts` / `validators.ts` — `REPORT_STATUSES`,
  `parseReportId`, `parseReportListQuery`.
- `apps/platform/src/app/(platform)/reports/page.tsx` — three-way mode split
  (mock/real-disabled unchanged; real-dev/production-auth now live; preview
  unchanged).
- `apps/platform/src/components/LiveReportsTable.tsx` — added a Version column
  (preview mode, read-only, unchanged otherwise).
- `apps/platform/src/lib/api-adapters.ts`, `mock-api-client.ts` — added
  `version: 1` to two mock-data construction sites (required by the `Report`
  contract change; caught by the interim static gate).
- `apps/platform/src/lib/platform-data-source.ts` — widened `loadReportsListData()`,
  added `loadReportDetailData()`.
- `apps/platform/src/lib/preview-api-client.server.ts` — `report_version` added
  to `previewGetReports()`'s query/mapping.
- `apps/platform/src/lib/real-api-client.client.ts` — added `realGetReports`,
  `realGetReportDetail`, `realGenerateReport`, `realDownloadReport`.
- `apps/platform/src/lib/real-api-client.server.ts` — added `realGetReports`,
  `realGetReportDetail`.
- `apps/platform/src/lib/real-api-client.ts` — `version` added to `BackendReport`;
  `backendErrorToRealApiError` exported for reuse by `realDownloadReport`.
- `packages/core/src/contracts/report.ts` — `version: number` added to `Report`.
- `pnpm-lock.yaml` — updated for `pdfkit`/`pdf-parse`/`@types/pdfkit`.

### Added
- `apps/backend/db/migrations/0005_report_generation_jobs.sql`
- `apps/backend/db/migrations/0006_report_artifacts.sql`
- `apps/backend/scripts/verify-report-pdf.ts`
- `apps/backend/src/config/report-worker-env.ts`
- `apps/backend/src/rendering/` — `sanitize.ts`, `html-renderer.ts`,
  `csv-renderer.ts`, `pdf-renderer.ts`, `index.ts`
- `apps/backend/src/repositories/report-artifacts.repository.ts`
- `apps/backend/src/repositories/report-jobs.repository.ts`
- `apps/backend/src/repositories/report-render-data.repository.ts`
- `apps/backend/src/services/report-generation.service.ts`
- `apps/backend/src/storage/report-artifact-store.ts`
- `apps/backend/src/workers/report-generation-worker.ts`,
  `report-worker-once.ts`, `report-artifact-reconciliation.ts`
- `apps/platform/src/components/LiveReportsActionTable.tsx`,
  `ReportDetailPoller.tsx`

## 3. Dependency changes and rationale

| Package | Version | Type | Rationale |
|---|---|---|---|
| `pdfkit` | `0.19.1` (exact) | runtime | Pure JavaScript, no Chromium/headless-browser requirement, no native compilation step. Chosen over `pdf-lib` (also viable, but lower-level — would need more hand-rolled layout code for this "render a data summary" use case). |
| `@types/pdfkit` | `0.17.6` (exact) | dev | `pdfkit` ships no types of its own. |
| `pdf-parse` | `2.4.5` (exact) | dev | PDF-validity QA tool only — never imported by production code, only by `scripts/verify-report-pdf.ts`. |

No other dependency was added, removed, or upgraded. No broad dependency-upgrade
or `audit fix` was run.

## 4. Migration summary

See §1 above and `docs/reports/PHX_REPORTS_004_QA_REPORT.md` §"Database QA" for
the real fresh/upgrade migration run evidence.

## 5. API contract summary

| Endpoint | Method | Auth | Notes |
|---|---|---|---|
| `/api/workspaces/:workspaceId/reports` | GET | active membership | Lazy-expiry normalized before read; `status`/`limit` query params. |
| `/api/reports/:reportId` | GET | active membership | Workspace resolved from report id first. |
| `/api/reports/:reportId/generate` | POST | `reports.generate` + ownership (Contributor own-only, all 3 transitions) | No request body accepted. |
| `/api/reports/:reportId/download` | GET | active membership | Integrity-verified before any bytes sent; self-heals `Available→Failed` on failure. |

## 6. Lifecycle evidence

See the QA report for the full real-system evidence (fresh generation, retry
with version increment and prior-version preservation, regenerate, natural
expiry, concurrency, lease recovery, max-attempts exhaustion, integrity
self-healing).

## 7. Known limitations

- `apps/backend/package-lock.json` is a stale, pre-existing artifact not
  actually consulted by this pnpm workspace (confirmed: it doesn't even list
  `pdfkit`/`pdf-parse`, which are present in `package.json`). Not remediated —
  out of this sprint's scope; documented, not silently left unexplained.
- Real click-driven browser QA (Playwright) could not be run in this sandbox —
  the Chromium download is blocked by network policy. Platform QA relied on
  real SSR/RSC-payload inspection against the real backend instead (see QA
  report for what this does and doesn't cover).
- The `report-storage/reports/reports/...` doubled-path bug (found and fixed
  during this sprint) and the `CertificationStatus` literal bug (found and
  fixed) are documented in the QA report's "Bugs found and fixed" section.
- No proactive artifact-integrity check on list/detail reads — only download
  triggers verification (a deliberate scope decision, not an oversight — see
  Phase 1 Addendum B §3).
- Execution control #9 (concurrent-state-change handling during an
  integrity-failure transition) is confirmed correct by code review and the
  fencing mechanism's design, but was not exercised by a dedicated
  race-injection QA script — see the manual security checklist, item 10.

## 8. Rollback instructions

1. `git checkout main` in the repository (this branch is never merged/pushed).
2. If migrations were applied to a shared database, no destructive rollback is
   required — `report_generation_jobs` and `report_artifacts` are pure additions
   with no foreign keys pointing INTO them from pre-existing tables; they can be
   dropped independently (`DROP TABLE report_generation_jobs, report_artifacts;`)
   without affecting `reports` or any other existing table.
3. Stop any running `report-generation-worker`/`report-worker-once` process —
   these are separate processes from the API server and can be terminated
   independently.
4. Remove the local artifact storage directory (`apps/backend/storage/` by
   default) if disk cleanup is desired — it is never committed to Git.
