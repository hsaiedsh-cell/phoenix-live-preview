# BUILD_REPORT_PHX_DEPLOY_003.md

**Task:** PHX-DEPLOY-003 — Hosted Preview Blocker Resolution
**Result:** B1 and B2 resolved and verified against a real, running,
merged source tree. B3 and Task 5 were already resolved in the provided
source and are verified, not rebuilt. Hosted Private Preview remains
No-Go pending a real-network Clerk QA pass. Public Deployment remains
No-Go. No PBRS/scoring/certification changes.

## Source basis

This sprint was explicitly paused in an earlier turn because only
documentation packages (`PHX-AUTH-003-REAL-CLERK-E2E-VERIFICATION`,
`PHX-DEPLOY-002-HOSTED-PRIVATE-PREVIEW-READINESS`) were available — no
source. It resumed once `PHOENIX-REAL-SOURCE-FOR-DEPLOY-003-CLEAN` was
provided: every prior sprint's full deliverable directory (36 directories,
~31 MB uncompressed), cleaned of `.env`/`.env.local`, `node_modules`,
`.next`, and macOS metadata by the operator before upload.

## Commands run (this sprint)

```
tar -xzf PHOENIX-REAL-SOURCE-FOR-DEPLOY-003-CLEAN_tar.gz
# systematic diffing of apps/backend and apps/platform file lists and
# content across all 36 provided sprint directories to establish true
# lineage (see PHX_DEPLOY_003_BLOCKER_RESOLUTION_REPORT.md for the full
# diff evidence)

corepack enable && corepack prepare pnpm@8.15.9 --activate
pnpm install --no-frozen-lockfile

pnpm --filter @phoenix/backend type-check   # PASS
pnpm --filter @phoenix/backend lint          # PASS
pnpm --filter @phoenix/backend build          # PASS
pnpm --filter @phoenix/platform type-check   # PASS
pnpm --filter @phoenix/platform lint          # PASS
pnpm --filter @phoenix/platform build         # PASS

apt-get install -y postgresql postgresql-contrib
# created phoenix/phoenix_dev_password/phoenix_dev matching docker-compose.yml
npx tsx src/db/migrate.ts     # 2 migrations applied
npx tsx src/db/seed.ts        # applied, re-run for idempotency check — PASS
npx tsx src/db/smoke.ts       # connected, 23 tables — PASS

# backend started 5 separate times (dev-header, oidc-jwt misconfigured,
# production-disabled, token-placeholder, production boot guard ×3
# variants) with full curl QA against each — see runtime QA report

# backend started with PHOENIX_ALLOWED_ORIGINS set, then with "*" —
# full CORS curl matrix — see runtime QA report

# platform built and started in real-dev mode against the live backend;
# rebuilt once with placeholder Clerk keys present at build time after
# discovering middleware.ts requires them in every API mode; curl matrix
# across all 7 routes; Playwright (pre-cached Chromium 1194) used for a
# real-browser check of /dashboard and /assessments — see runtime QA
# report for the network-egress finding that stopped full pixel
# verification there

grep-based security scan across the final tree — see security scan report
```

## Pass/fail summary

| Item | Result |
|---|---|
| Backend type-check / lint / build | PASS / PASS / PASS |
| Platform type-check / lint / build | PASS / PASS / PASS |
| DB migrate / seed (idempotent) / smoke | PASS / PASS / PASS |
| Auth mode QA (5 scenarios) | PASS — all 5 |
| CORS QA (allowed/disallowed/preflight/wildcard-rejection) | PASS — all 4 |
| Platform route QA (7 routes, curl) | PASS — all 200s once Clerk keys present |
| Platform preview-only labeling (3 pages) | PASS — all 3 labeled |
| Real Clerk sign-in | **Not run** — network blocked, same as PHX-AUTH-003 |
| Live-data browser rendering (Playwright) | **Blocked** — Clerk client script hit the same network egress restriction from the browser side |
| Security scan | PASS — clean |

## Known limitations (honestly documented, not smoothed over)

1. Real Clerk sign-in and full browser-rendered live-data verification were
   not completed — both require network access this sandbox does not have.
   See `PHX_DEPLOY_003_RUNTIME_QA_REPORT.md` Task 10 for exactly what was
   and wasn't verified.
2. `apps/website` and `apps/dashboard` were not touched, built, or tested
   this sprint — out of scope per the task brief.
3. The platform's Clerk middleware requiring valid-shaped keys at build
   time, in every API mode, is documented but not changed — it reflects
   already-approved PHX-PLATFORM-011-R1 behavior, not a defect introduced
   here.

## Files changed this sprint

- `apps/backend/src/middleware/cors.ts` (new)
- `apps/backend/src/server.ts` (wire in `productionCorsMiddleware`)
- `apps/backend/src/routes/readiness.ts` (add `cors` block)
- `apps/backend/src/middleware/dev-cors.ts` (copied in from prior lineage,
  header comment updated to note it's not wired into `server.ts`)
- `apps/backend/.env.example` (add `PHOENIX_ALLOWED_ORIGINS` section)
- `docs/deployment/PHX_DEPLOY_003_*.md` (new — 5 files)
- `BUILD_REPORT_PHX_DEPLOY_003.md` (this file)

No file under `packages/pbrs`, `packages/core`'s PBRS contracts, or any
certification threshold definition was touched.
