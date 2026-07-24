# BUILD_REPORT — PHX-REPORTS-004

**Report Generation Lifecycle & Secure Artifact Delivery Foundation**

Branch: `phx-reports-004` · Baseline: `d9d5ba3bc52e8683b85f33f06d62865b72ce851f`

## Final regression gate (run last, against the truly final code state)

```
$ pnpm install --frozen-lockfile
Scope: all 11 workspace projects
Lockfile is up to date, resolution step is skipped
Already up to date

$ pnpm type-check
Scope: 4 of 11 workspace projects
apps/backend type-check: Done
apps/dashboard type-check: Done
apps/platform type-check: Done
apps/website type-check: Done

$ pnpm lint
Scope: 4 of 11 workspace projects
apps/backend lint: Done
apps/dashboard lint: ✔ No ESLint warnings or errors
apps/platform lint: ✔ No ESLint warnings or errors
apps/website lint: ✔ No ESLint warnings or errors

$ pnpm build   (clean rebuild — .next dirs removed first)
apps/backend build: Done
apps/dashboard build: ✓ Compiled successfully, ✓ Generating static pages (4/4)
apps/website build: ✓ Compiled successfully, ✓ Generating static pages (13/13)
apps/platform build: ✓ Compiled successfully, ✓ Generating static pages (12/12)
```

All four apps: clean install, clean type-check, clean lint, clean production
build. No warnings suppressed, no `--no-frozen-lockfile` used for the final
gate.

## Live backend regression, re-run after all fixes (fresh database each time)

| Suite | Result |
|---|---|
| Role/ownership/concurrency/cross-workspace (`qa-full.ts`) | 28/28 |
| Full lifecycle + formats (`qa-lifecycle.ts`) | 20/20 |
| Edge cases: lease recovery, max-attempts, integrity, reconciliation (`qa-edge-cases.ts`) | 18/18 |
| Storage security (`qa-storage-security.ts`) | 19/19 |
| **Total** | **85/85** |

This is the FINAL confirmation, run last, on the code as it will be handed
off — not reused from earlier in the session. Each suite ran against a freshly
migrated and seeded database and a freshly-started backend process (with
explicit PID verification before each run, after two further recurrences of
this session's stale-process QA-harness issue were caught and corrected).

## Platform build matrix

| Mode | Build | Runtime behavior confirmed |
|---|---|---|
| `mock` | Clean | Unchanged mock `ReportCard` grid; zero real-backend data present. |
| `real-dev` | Clean | Live data confirmed via real SSR/RSC-payload inspection against the real backend. |
| `production-auth` | Clean | Correct "Sign-in required" fail-safe without a real Clerk session; no crash, no leak, no mock fallback. |
| `vercel-supabase-preview` | Clean | Read-only, `Version` column present, no write action rendered; correct fail-safe without a real Clerk session. |

## Dependency footprint change

- `apps/backend/package.json`: +1 runtime dependency (`pdfkit@0.19.1`, exact),
  +2 devDependencies (`@types/pdfkit@0.17.6`, `pdf-parse@2.4.5`, both exact).
- `pnpm-lock.yaml`: updated accordingly (256 lines added).
- No other `package.json` in the workspace changed its dependency list.

## Artifacts produced

- 2 new migrations (`0005_report_generation_jobs.sql`, `0006_report_artifacts.sql`)
- 3 real generated QA samples (PDF, HTML, CSV) — see the QA report §14 and the
  handoff `samples/` directory.
- 6 documentation deliverables under `docs/reports/` + this build report at
  the repository root.

## Post-review fix round (4 blocking issues)

See `docs/reports/PHX_REPORTS_004_QA_REPORT.md` §15 and
`docs/reports/00_TEST_ACCOUNTING.md`'s addendum for full detail. All 5
pre-existing live-backend regression suites re-run clean after the fixes
(28+20+18+19+5 = 90), plus 3 new suites added specifically to cover the fixed
defects (route registration 6, real process-level boot config 11,
deterministic polling controller 17 = 34). **Combined total: 124/124.**

The corrected source archive was extracted into a completely separate
directory and the full static gate (`install --frozen-lockfile`, `type-check`,
`lint`, `build`) was re-run there independently, confirming the packaging fix
with real, independent evidence rather than a file-listing check alone.
