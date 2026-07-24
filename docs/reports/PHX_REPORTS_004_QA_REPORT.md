# PHX-REPORTS-004 — QA Report

All evidence below comes from real command executions against a real PostgreSQL
16 instance, a real backend server process, real worker processes, and (for
platform QA) a real `next build`/`next start` process reading from the real
backend — nothing in this report is simulated or asserted without a
corresponding real run. Where a check could not be run for a concrete,
documented reason, that is stated explicitly rather than silently omitted.

---

## 1. Test accounting (corrected)

A prior summary in this session miscounted totals. Reconciled precisely:

- **72 unique, currently-passing assertions**, across **5 distinct QA suites**
  (`qa-full.ts`, `qa-lifecycle.ts`, `qa-edge-cases.ts`, `test-invariants.ts`,
  `portfolio-test.ts`), run across **12 total script executions** (including
  crashed/failed preliminary attempts and confirmatory reruns).
- No suite's checks overlap another's in content.
- Every failure/crash before each suite's final clean run was traced to a
  specific, documented root cause — a test-script bug, a QA-environment defect
  (a `pkill` pattern mismatch that let a stale server process keep serving —
  this recurred twice in this session and is explicitly a QA-harness issue,
  not a product defect, documented in both occurrences), or a wrong test
  expectation about correct-but-non-obvious app behavior (bounded backoff
  delay; retry-before-terminal-fail). None were application defects.
- Full per-execution ledger: see `00_TEST_ACCOUNTING.md` in the QA evidence
  bundle.

**Additional suites run after that reconciliation** (not part of the 72):
- Storage security suite: **19/19** (see §4).
- Config-invariant assertions: 5/5 (counted within the 72 above, suite
  `test-invariants.ts`).
- Portfolio-too-large full-exhaustion confirmation: 1/1 manual (counted within
  the 72 above).

---

## 2. Database QA

```
$ pnpm db:migrate:dev   (fresh database, 0001-0006 in one run)
[phoenix-backend:migrate] Applying migration 0001_initial_schema.sql
[phoenix-backend:migrate] Applying migration 0002_auth_identities.sql
[phoenix-backend:migrate] Applying migration 0003_report_request_constraints.sql
[phoenix-backend:migrate] Applying migration 0004_report_version.sql
[phoenix-backend:migrate] Applying migration 0005_report_generation_jobs.sql
[phoenix-backend:migrate] Applying migration 0006_report_artifacts.sql
[phoenix-backend:migrate] Migration complete (6 applied, 0 already applied/skipped).
```

```
$ pnpm db:migrate:dev   (upgrade path: 0001-0004 already applied, 0005-0006 new)
[phoenix-backend:migrate] Skipping already applied migration 0001_initial_schema.sql
[phoenix-backend:migrate] Skipping already applied migration 0002_auth_identities.sql
[phoenix-backend:migrate] Skipping already applied migration 0003_report_request_constraints.sql
[phoenix-backend:migrate] Skipping already applied migration 0004_report_version.sql
[phoenix-backend:migrate] Applying migration 0005_report_generation_jobs.sql
[phoenix-backend:migrate] Applying migration 0006_report_artifacts.sql
[phoenix-backend:migrate] Migration complete (2 applied, 4 already applied/skipped).
```

```
$ pnpm db:seed:dev   (idempotent — run repeatedly across this session without error)
[phoenix-backend:seed] Seed applied (or already present).
users: 6, workspace_users: 6, assets: 3, assessments: 4, pbrs_scores: 2, ...
```

## 3. Role/ownership/lifecycle/concurrency QA (`qa-full.ts` — 28/28)

Real backend, real seeded users across all 6 roles.

- All 6 roles: list (200), detail (200).
- Owner/Admin/Reviewer: generate any report (202).
- Contributor: generate OWN report (202); **cannot** start a report they did
  not request (403, `OWNERSHIP_REQUIRED`) — confirms Addendum A §1's
  all-three-transitions correction for the *start* case specifically.
- Viewer/Auditor: cannot generate (403) for all cases.
- Generate while already Generating → 409.
- **Concurrency**: 8 parallel `POST .../generate` calls against the same
  report → exactly 1 succeeds (202), exactly 7 conflict (409), exactly 1
  `report_generation_jobs` row created (verified via direct SQL count) —
  confirms the `SELECT ... FOR UPDATE` row lock + migration 0005's partial
  unique index both hold under real concurrent load.
- Cross-workspace: a genuinely separate workspace/user (created via direct SQL
  for this test only) cannot read or generate a report belonging to another
  workspace (403 both times).
- Client-supplied `version` field on the create-request body → 400.

## 4. Storage security QA (`qa-storage-security.ts` — 19/19)

Direct tests against `LocalReportArtifactStore` with an isolated `/tmp` root:

- Write rejects bytes exceeding `REPORT_MAX_ARTIFACT_BYTES` (`ArtifactTooLargeError`); no file created.
- Bounded read rejects a stored file exceeding the read-time limit.
- Write/read/delete all reject 4 distinct traversal-key patterns; no file
  created outside the root by any of them.
- **Absolute-looking key**: initially found to be *safely contained* (Node's
  `path.join` does not jump to filesystem root) but not *explicitly rejected*
  — hardened with a new `assertKeyFormat()` guard during this QA pass;
  re-verified passing after the fix.
- 3 encoded/normalized traversal variants: rejected or safely contained in
  every case.
- Legitimate deterministic key still writes/reads/deletes correctly (no
  over-blocking).

Re-verified end-to-end (a real generate → worker → Available cycle) after the
hardening change to confirm no regression.

## 5. Full lifecycle + format QA (`qa-lifecycle.ts` — 20/20)

Real request → generate → real once-batch worker run → Available → download
(200, correct `Content-Type: application/pdf`, correct
`Cache-Control: private, no-store`, real PDF magic bytes) → forced-Failed →
retry (202, version 2, v1 artifact metadata preserved) → real worker run →
Available v2 (both v1 and v2 artifact rows preserved, confirming "prior
version metadata preserved" holds under a real retry, not just in theory) →
forced-Expired → regenerate (202, version 3) → download while Generating (409)
→ real worker run → Available v3 → forced-past `expires_at` → list read with
`?status=Expired` correctly shows the report AND a `report.expired` audit row
with `actor_user_id = NULL` was written (confirms lazy-expiry-after-
normalization ordering and system attribution both hold for real) → HTML
format generated and downloaded (200, correct content-type, escaped output
confirmed via absence of `<script>`) → CSV/portfolio format generated and
downloaded (200, correct content-type; real sample content included in this
report's evidence, showing correct numeric-vs-string cell typing).

**Note**: this suite's first run showed 7 failures that were entirely a
QA-environment defect (a stale backend server process from an earlier
`pkill` pattern mismatch) — traced, fixed, and reconfirmed clean on rerun; see
§1 and `00_TEST_ACCOUNTING.md`.

## 6. Edge-case QA (`qa-edge-cases.ts` — 18/18)

- **Lease recovery**: a job manually stamped `Processing` with a `locked_at`
  10 minutes in the past is correctly reclaimed to `Queued` by the sweep
  (locks cleared), then — after its bounded-backoff window passes — correctly
  re-claimed and completed to `Succeeded`, with the report reaching
  `Available`.
- **Max-attempts exhaustion**: a job manually stamped `Processing`,
  `attempt_count = 3` (the default max), and stale → the sweep marks it
  **and** the matching report **and** writes the audit record, all in one
  atomic pass (execution control #8) — verified via direct SQL that all three
  actually changed together, with `actor_user_id = NULL` on the audit row and
  a sanitized (no `/`) `last_error`/`failure_reason` on both the job and the
  report.
- **Integrity failure on download**: a real, successfully-generated PDF was
  deliberately overwritten with corrupted bytes on disk (metadata untouched).
  The download endpoint correctly returned 409, sent zero bytes, contained no
  path/hash/internal detail in the response, transitioned the report
  `Available → Failed` with `actor_user_id = NULL`, and a subsequent authorized
  retry (recovery path) succeeded normally.
- **Reconciliation race safety**: a freshly-written orphan file (no metadata
  row, no lease) was correctly **retained** (within the grace period); the
  same file, after its mtime was backdated past the grace period, was
  correctly **deleted** on the next sweep.

## 7. Config-invariant QA (`test-invariants.ts` — 5/5)

All 4 Addendum-B invariants (`heartbeat < lease`, `grace > lease`,
`maxAttempts >= 1`, `backoffBaseSeconds > 0`) correctly throw
`assertReportWorkerConfigSafe()` when violated, individually confirmed; a
fully valid config does not throw.

## 8. Bounded portfolio-size QA (1/1, confirmed via direct SQL after a
   corrected test expectation)

With `REPORT_PORTFOLIO_MAX_ASSETS=2` against a workspace with 3 real seeded
assets: the job correctly **requeues** on its first failure (attempt 1 <
max 3 — the app's actual, correct designed behavior, not the "immediate
terminal failure" my first test draft wrongly expected), then, after being
driven through its full attempt budget across 2 more real worker runs,
terminally fails with the exact documented sanitized reason: *"Workspace
portfolio exceeds the supported report size for this release."*

## 9. Bugs found and fixed during this sprint's QA (not pre-existing)

1. **`CertificationStatus` literal error**: `report-render-data.repository.ts`
   originally queried `pbrs_certifications.status = 'Active'`; the actual
   `CertificationStatus` enum has no `'Active'` value — the correct "currently
   valid" value is `'Certified'`. Found by cross-referencing
   `packages/core/src/contracts/enums.ts` during implementation (before any
   QA run), fixed before first use.
2. **Redundant `reports/reports/` storage path**: the default
   `REPORT_STORAGE_LOCAL_DIR` (`./storage/reports`) combined with the
   deterministic key's own `reports/` prefix produced a doubled path segment.
   Found by direct filesystem inspection after the first real generation run;
   fixed by changing the default to `./storage` (the key's own prefix is the
   `reports/` segment).
3. **Absolute-looking storage key not explicitly rejected**: see §4 above.

## 10. QA-environment issues (not product defects)

- A `pkill -f "tsx src/index.ts"` pattern did not match the actual process
  command line (`.../tsx/dist/cli.mjs src/index.ts`), leaving a stale backend
  server running across two separate points in this session. Both times this
  produced misleading test failures/ambiguous grep matches that were traced
  and resolved by killing by exact PID and confirming a fresh process before
  re-testing. This is a QA-harness defect in this session's own tooling, not
  a defect in the application under test.
- Playwright/Chromium could not be installed in this sandbox (network policy
  blocks the browser-binary download domain) — see §12.

## 11. Static/build gates

```
$ pnpm install --frozen-lockfile   → clean (both the interim run and the final run below)
$ pnpm type-check                  → clean, all 4 apps (backend/dashboard/platform/website)
$ pnpm lint                        → clean, all 4 apps
$ pnpm build                       → clean, all 4 apps, full production build
```

The interim gate (run before platform work began) caught a real regression:
the `Report.version` contract addition broke two pre-existing mock-data
construction sites in the platform app — fixed (added `version: 1` to both,
since mock data has no real generation lifecycle) before proceeding.

## 12. Platform QA

- **Real list rendering from backend data**: confirmed via real SSR/RSC-payload
  inspection — a report created via a direct backend call was found,
  byte-for-byte, in the platform's server-rendered output (real id, name,
  `version:1`, real timestamps, real `requestedByDisplayName`).
- **Mock mode regression**: confirmed clean — zero real-backend data leakage,
  correct mock `ReportCard` grid (`Coming Soon`/`Available` mock cards), no
  `LiveDataBadge`. (First attempt showed a false alarm from the same stale-
  process QA-environment issue noted in §10 — retraced and reconfirmed clean
  after a proper process kill.)
- **Preview mode regression**: confirmed read-only — the `Version` column
  header renders (from the `previewGetReports()` addition), the static
  preview-mode description text is present, **no** `RequestReport`/write
  button renders. A real Clerk session was not available in this sandbox, so
  the page correctly showed "Sign-in required" rather than a crash or a false
  success — this is the correct fail-safe behavior for a real deployment
  lacking a session, not a full end-to-end functional test of preview mode's
  data path.
- **Production-auth build path**: `next build` with placeholder Clerk env vars
  set completed cleanly (no server/client boundary violation, no compile
  error). At runtime, without a real Clerk session (none available in this
  sandbox — no network egress to Clerk's servers is permitted), the page
  correctly rendered "Sign-in required. No Clerk session token is available
  for this request." with a link to `/login` — no crash, no data leak, no
  fallback to mock data.
- **No hydration/client-server-boundary/server-only-import errors**: inferred
  from the four clean `next build` runs (mock, real-dev, production-auth,
  vercel-supabase-preview configurations) — Next.js's build-time bundler
  analysis would fail the build on a real server/client boundary violation
  (e.g. `@clerk/nextjs/server` reaching a client bundle), and none of the four
  builds failed.
- **What was NOT tested — stated plainly**: real button-click interaction
  (Start/Retry/Regenerate/Download), real bounded-polling termination
  behavior in a live browser, and real authenticated-download-triggers-a-
  save-dialog behavior were **not** exercised with an actual browser in this
  sandbox — Playwright's Chromium binary could not be downloaded (network
  policy). The underlying functions these UI actions call
  (`realGenerateReport`, `realGetReportDetail`, `realDownloadReport`) hit the
  exact same backend endpoints already exhaustively tested in §3, §5, and §6
  above via direct HTTP calls with the same headers a browser would send, so
  the *backend-side* behavior these actions trigger is thoroughly verified;
  what is not independently verified is the *client-side* React
  state/rendering/polling-loop code executing correctly inside a real
  browser's JavaScript engine. This is a genuine, stated gap, not glossed
  over.

## 13. Dependency and security audit

See `02_pnpm_audit_output.txt` and `03_npm_audit_backend_output.txt` in the
evidence bundle, and `docs/reports/PHX_REPORTS_004_SECURITY_SCAN_REPORT.md`
for the categorized findings and the manual security checklist
(`01_MANUAL_SECURITY_CHECKLIST.md`).

## 14. Generated QA samples

Real generated artifacts, included in the handoff (`samples/` directory),
with SHA-256 checksums recorded in the final handoff checksums file:
- `asset-readiness-summary.pdf` — validated via `scripts/verify-report-pdf.ts`
  (`pdf-parse`): `%PDF-1.3` signature confirmed, 1 page, `Producer=PDFKit`.
- `asset-readiness-summary.html` — real escaped output for a different
  (unscored/under-review) asset than the PDF sample.
- `workspace-portfolio-summary.csv` — real portfolio data across all 3 seeded
  assets, showing correct numeric-vs-string cell typing (unquoted numbers,
  quoted strings, truthful blank cells for the unscored asset).
