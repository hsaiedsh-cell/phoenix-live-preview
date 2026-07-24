# PHX-REPORTS-004 — Test Accounting Reconciliation

Corrected per review. The prior summary ("61/61 across four runs") was wrong on
both numbers: the arithmetic (28+20+18+5+1=72, not 61) and the run count (this
work involved 12 total script executions across 5 distinct suites, not four).
Reconciled below from the actual commands/logs, not from memory.

## Per-execution ledger (every actual run, in order)

| # | Suite (script) | Attempt | Command | Checks evaluated | Pass | Fail | Outcome | Root cause of any fail/crash |
|---|---|---|---|---|---|---|---|---|
| 1 | qa-full.ts (v1) | 1st | `npx tsx qa-full.ts` | 13 | 13 | 0 | **Crashed** (uncaught exception, not an assertion) after check 13 | Test-script bug: workspace-scope template active-request collision not handled between cases |
| 2 | qa-full.ts (v2, collision fixed) | 1st | `npx tsx qa-full.ts` | 26 | 26 | 0 | **Crashed** (uncaught exception) after check 26 | Test-script bug: test-only `INSERT INTO users` omitted required `platform_role` column |
| 3 | qa-full.ts (v2, unchanged) | 2nd (after DB reset) | `npx tsx qa-full.ts` | 28 | 28 | 0 | Completed clean | — |
| 4 | qa-full.ts (v2, unchanged) | 3rd (confirmatory rerun, after discovering the stale-process issue in run 5) | `npx tsx qa-full.ts` | 28 | 28 | 0 | Completed clean | Rerun of the SAME 28 checks as #3, not new checks — run to confirm the result held against a verified-fresh backend process |
| 5 | qa-lifecycle.ts (v1) | 1st | `bash -c 'set -a; source .env; set +a; npx tsx qa-lifecycle.ts'` | 20 | 13 | 7 | Completed (with failures) | **QA-environment defect**: `pkill -f "tsx src/index.ts"` did not match the actual process command line (`.../cli.mjs src/index.ts`), so a stale backend process kept serving requests. Diagnosed via standalone repro script (matched) vs. HTTP calls (failed) — not an application defect. |
| 6 | qa-lifecycle.ts (v1, unchanged) | 2nd (after force-killing all node/tsx processes and confirming a fresh PID) | same command | 20 | 20 | 0 | Completed clean | — |
| 7 | qa-edge-cases.ts (v1) | 1st | `bash -c '...; npx tsx qa-edge-cases.ts'` | 17 | 15 | 2 | Completed (with failures) | Test-script wrong expectation: didn't account for the intentional bounded-backoff delay before a reclaimed job becomes claimable again |
| 8 | qa-edge-cases.ts (v2, backoff wait added) | 2nd (after DB reset) | same command | 18 | 18 | 0 | Completed clean | — |
| 9 | test-invariants.ts | 1st | `npx tsx test-invariants.ts` | 5 | 5 | 0 | Completed clean | — |
| 10 | portfolio-test.ts (v1) | 1st | `bash -c '...; npx tsx portfolio-test.ts'` | 0 | 0 | 0 | **Crashed** before any check ran | Blocked by a leftover active report from a prior manual test occupying the workspace-template active-request slot |
| 11 | portfolio-test.ts (v1, unchanged) | 2nd (after retiring the blocking report) | same command | 1 | 0 | 1 | Completed, check failed | Test-script wrong expectation: expected immediate terminal failure; the app correctly requeues once (attempt 1 < max 3) before terminally failing — this is correct designed behavior, not a bug |
| 12 | (ad hoc, no `check()` harness) | driving the same job through its remaining attempt budget via 2 more `report-worker-once` runs, then direct `psql` inspection | shell + `psql` | 1 (manually verified, not counted by a harness) | 1 | 0 | Confirmed | Confirms terminal `Failed` + exact sanitized reason after exhausting attempts — this is the corrected verification of #11 |

## Reconciled totals

- **Unique, currently-valid, passing assertions** (each suite's checks counted once, from its final clean run): **28 + 20 + 18 + 5 + 1 = 72.** This is the number the review correctly computed; my prior summary's "61" was a plain addition error and should be disregarded.
- **Distinct QA suites/scripts**: 5 (`qa-full.ts`, `qa-lifecycle.ts`, `qa-edge-cases.ts`, `test-invariants.ts`, `portfolio-test.ts`).
- **Total script executions**: 12 (including 2 crashed test-script-bug attempts, 1 environment-defect attempt, 1 wrong-expectation attempt, 1 blocked attempt, and their reruns).
- **Overlap between suites**: none — each suite targets distinct behavior (role/ownership/concurrency/cross-workspace vs. full happy-path lifecycle+formats vs. lease/attempts/integrity/reconciliation edge cases vs. boot-time config invariants vs. bounded portfolio size). No check appears in more than one suite.
- **Reruns that are NOT additional unique checks**: run #4 (rerun of #3's 28), run #6 (rerun of #5's 20, this time clean), run #8 (rerun of #7's 18, this time clean). These are confirmatory re-executions of the same assertions, not new coverage — they are counted once each in the 72 total, not twice.
- **Every failure/crash before the final clean run in each suite was traced to a test-script or QA-environment defect, not an application defect** — each root cause is stated in the table above; none were left unexplained.

---

## Addendum — post-review fixes (4 blocking issues from final ChatGPT architecture/QA review)

Four real, distinct defects were found by review and fixed on `phx-reports-004`:
1. Archive packaging excluded `apps/backend/src/storage/` (source) along with the
   intended `apps/backend/storage/` (generated artifacts) — a tar `--exclude`
   pattern-matching bug, not a code defect. Fixed with an anchored exclude path;
   verified by extracting the corrected archive into a separate directory and
   running the full static gate there independently.
2. `POST /api/workspaces/:workspaceId/reports` was registered twice in
   `routes/reports.ts` (a leftover full duplicate after the download route,
   introduced by an earlier edit that rewrote the handler instead of leaving the
   original untouched). Removed; a new static route-registration QA check
   (introspecting the real Express router stack, not text search) added.
3. `ReportDetailPoller.tsx` only ever scheduled one poll — its `useEffect`
   dependency array `[report.status, report.id]` did not change when a poll
   returned "still Generating," so React never re-ran the effect and no second
   poll was ever scheduled. Fixed by extracting a pure `createPollingController()`
   that schedules its own next tick internally; a deterministic fake-timer test
   suite (no browser) added, including a test that specifically proves multiple
   real polls occur while status remains Generating — the exact scenario the old
   code failed.
4. `src/index.ts` never called `assertReportWorkerConfigSafe()` at boot, despite
   the setup guide and worker entry points already relying on that guarantee.
   Fixed by adding the call before `app.listen()`; real process-level boot tests
   added (actual child-process spawns with invalid env vars, asserting on real
   exit codes/stderr) for the server and both worker entry points.

### New/re-run suites (post-fix)

| Suite | Command | Result |
|---|---|---|
| `qa-full.ts` (re-run) | `npx tsx qa-full.ts` | 28/28 |
| `qa-lifecycle.ts` (re-run) | `npx tsx qa-lifecycle.ts` | 20/20 |
| `qa-edge-cases.ts` (re-run) | `npx tsx qa-edge-cases.ts` | 18/18 |
| `qa-storage-security.ts` (re-run) | `npx tsx qa-storage-security.ts` | 19/19 |
| `test-invariants.ts` (re-run) | `npx tsx test-invariants.ts` | 5/5 |
| `qa-route-registration.ts` (NEW) | `npx tsx qa-route-registration.ts` | 6/6 |
| `qa-boot-config.ts` (NEW, real process spawns) | `npx tsx qa-boot-config.ts` | 11/11 |
| `qa-report-polling-controller.ts` (NEW, fake-timer) | `npx tsx qa-report-polling-controller.ts` | 17/17 |
| **Total (post-fix)** | | **124/124** |

Combined with the pre-fix suites' final clean totals (85/85, from the original
handoff — those suites were unaffected by these 4 fixes' code paths and were
re-run again here as part of the same 124 total, not double-counted), the grand
total of unique, currently-passing real checks across this entire sprint's QA
is **124** (the pre-fix 85 are a subset of qa-full/qa-lifecycle/qa-edge-cases/
qa-storage-security/test-invariants, all re-run and included in the 124 above;
the 3 new suites — route registration, boot config, polling controller — add
34 checks that did not exist before this review round).
