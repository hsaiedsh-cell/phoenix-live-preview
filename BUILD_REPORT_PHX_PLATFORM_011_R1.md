# Build Report — PHX-PLATFORM-011-R1

**Task:** Server-Side Production Auth Token & Live Backend Verification Fix
**Environment:** Node v22.22.2, pnpm 8.15.9 (corepack), Next.js 14.2.35,
PostgreSQL 16.14 (installed this session)

## Commands run, in order

```
# Platform build/type/lint matrix
pnpm install --frozen-lockfile                                    # exit 0
cd apps/platform
pnpm exec tsc --noEmit                                             # exit 0
pnpm exec next lint                                                # exit 0, clean
rm -rf .next && pnpm exec next build                               # mock — exit 0
rm -rf .next && <real-dev env> pnpm exec next build                # exit 0
rm -rf .next && <prod-auth+fake-config env> pnpm exec next build   # exit 0
rm -rf .next && <prod-auth, no config env> pnpm exec next build    # exit 0

# Live backend stack (new this sprint)
apt-get install -y postgresql postgresql-contrib                   # exit 0
service postgresql start
psql -c "CREATE USER phoenix WITH PASSWORD 'phoenix_dev_password';"
psql -c "CREATE DATABASE phoenix_dev OWNER phoenix;"
cd apps/backend  # copied from PHX-AUTH-002-R1, unmodified
npm install                                                         # exit 0
DATABASE_URL=... PHOENIX_ENABLE_DATABASE=true npx tsx src/db/migrate.ts   # exit 0
DATABASE_URL=... PHOENIX_ENABLE_DATABASE=true npx tsx src/db/seed.ts      # exit 0
PHOENIX_AUTH_MODE=dev-header ... npx tsx src/index.ts &             # backend running

# Platform against the live backend
NEXT_PUBLIC_PHOENIX_API_MODE=real-dev ... pnpm exec next build      # exit 0
pnpm exec next start -p 3001 &                                      # platform running
curl http://localhost:3001/assessments | grep ...                   # verification (see QA report)
curl http://localhost:3001/dashboard | grep ...
curl http://localhost:3001/settings | grep ...
pkill -f "tsx src/index.ts"                                          # backend stopped
curl http://localhost:3001/assessments | grep "Backend unavailable"  # verification
```

Full output/transcripts for every step are in
`docs/platform/PHX_PLATFORM_011_R1_QA_REPORT.md`.

## Result

| Step | Result |
|---|---|
| Install | ✅ |
| Type-check | ✅ |
| Lint | ✅ |
| Build — mock | ✅ |
| Build — real-dev | ✅ |
| Build — production-auth (fake config) | ✅ |
| Build — production-auth (no config) | ✅ |
| PostgreSQL install + migrate + seed | ✅ |
| Backend start (dev-header mode) | ✅ |
| Platform build + start against live backend | ✅ |
| Live HTTP verification (see QA report) | ✅ |

## Issues found and fixed during this build pass

1. **Production-auth Server Component reads always failed with
   auth-required**, because the token-resolution function they called
   only works in a browser. Fixed by splitting `real-api-client.ts` into
   a shared file plus `real-api-client.server.ts` (server-side Clerk
   token, used by every migrated page) and `real-api-client.client.ts`
   (browser Clerk token, unused this sprint — a ready seam for future
   client-side reads).
2. **Six of seven `Backend*` response types had wrong field names**,
   discovered only once a real backend was actually queried with curl.
   PHX-PLATFORM-011 had inferred these from raw SQL column aliases
   rather than the backend's actual (camelCase) JSON output. All six
   were corrected against the verified live responses; every dependent
   component and page was updated to match.
3. As a direct consequence of fix #2, the dashboard's prior claim that
   "the live assessments list has no score data" was found to be false
   — the list endpoint does return per-row score/grade/risk. The
   dashboard now surfaces a "Scored (this page)" stat from that data
   instead of omitting it.

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
under `packages/` was touched. The backend used to perform live
verification (copied from the PHX-AUTH-002-R1 deliverable) was used
read-only as a test target and is not included in this tar.

## No-regression / no-launch confirmation

- No public deployment performed or claimed.
- No customer onboarding or auto-provisioning added.
- No backend auth logic changed — no backend source file in this tar.
- No Clerk secret committed.
- No token `localStorage` usage introduced.
- No `dev-header` behavior in `production-auth`.
- No silent mock fallback in any migrated real-dev/production-auth
  page — confirmed both by code grep and by an actual live HTTP test
  with the backend stopped.
- `mock` remains the default and is unchanged.
- `real-dev` remains a dev-header-only local preview mode — verified
  working end-to-end against a real, seeded backend this session.
- `production-auth` remains an explicit opt-in mode.
- No PBRS/scoring/certification-threshold change.
- Real Clerk end-to-end sign-in was not performed and is not claimed.

This is a targeted correctness fix and QA completion pass. It does not
launch Phoenix publicly.
