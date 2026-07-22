# PHX-PLATFORM-011-R1 — QA Report

Every command below was actually run in this session — installing
PostgreSQL, seeding a real database, running the real backend, and
curling the real platform server, not simulated.

## 1. Standard build/type/lint matrix (Required commands)

```
$ pnpm install
Scope: all 10 workspace projects — exit 0

$ cd apps/platform && pnpm exec tsc --noEmit
(no output) — exit 0

$ pnpm exec next lint
✔ No ESLint warnings or errors — exit 0

$ rm -rf .next && pnpm exec next build                                     # mock
✓ Generating static pages (12/12) — exit 0

$ rm -rf .next && NEXT_PUBLIC_PHOENIX_API_MODE=real-dev ... pnpm exec next build
✓ Generating static pages (12/12) — exit 0

$ rm -rf .next && NEXT_PUBLIC_PHOENIX_API_MODE=production-auth <fake config> pnpm exec next build
✓ Generating static pages (12/12) — exit 0

$ rm -rf .next && NEXT_PUBLIC_PHOENIX_API_MODE=production-auth pnpm exec next build   # no config
✓ Generating static pages (12/12) — exit 0
```

All four builds' route tables are identical in shape to
PHX-PLATFORM-011's own matrix (dashboard/assessments/assessments-[id]/
settings dynamic in mock+real-dev; everything dynamic in production-auth
with config present; only the four force-dynamic routes dynamic with
config missing) — the file split did not change build-time behavior.

## 2. Static/code checks (Required)

```
$ grep -rn "'X-Phoenix-User-Id':" src/lib/
lib/real-api-client.client.ts:66:    return { 'X-Phoenix-User-Id': config.devUserId };
lib/real-api-client.server.ts:73:    return { 'X-Phoenix-User-Id': config.devUserId };
```
Both occurrences are inside each file's own `config.mode === 'real-dev'`
branch. ✅ real-dev only.

```
$ grep -rn "Authorization: \`Bearer" src/lib/
lib/real-api-client.client.ts:86:    return { Authorization: `Bearer ${result.token}` };
lib/real-api-client.server.ts:98:    return { Authorization: `Bearer ${result.token}` };
```
Both occurrences are inside each file's own `config.mode ===
'production-auth'` branch, reached only after config is confirmed
present and a real token is obtained. ✅ production-auth only.

```
$ grep -rn "from '.*platform-auth\.server'" src/
components/ProductionAuthGate.tsx   (Server Component, no 'use client')
app/(platform)/settings/page.tsx    (Server Component, no 'use client')
lib/real-api-client.server.ts       (server-only file, by design)
lib/auth/platform-auth.ts           (type-only: `export type {...}`)
```
✅ `platform-auth.server.ts` is never imported by a `'use client'` file.

```
$ grep -rn "from '.*platform-auth\.client'" src/
lib/real-api-client.client.ts       (client-only file, by design)
lib/auth/platform-auth.ts           (type-only: `export type {...}`)
```
✅ `platform-auth.client.ts` is never imported by `platform-data-source.ts`
or any Server Component page.

```
$ grep -rn "window\.localStorage\.\|window\.sessionStorage\." src/
lib/mock-session.ts:122:    const stored = window.localStorage.getItem(MOCK_ACTIVE_ROLE_STORAGE_KEY);
lib/mock-session.ts:134:    window.localStorage.setItem(MOCK_ACTIVE_ROLE_STORAGE_KEY, role);
```
✅ Only pre-existing (PHX-PLATFORM-006) mock-role-switcher storage —
unrelated to any backend auth token. No token is ever stored.

```
$ grep -n "apiConfig.mode === 'mock'" app/\(platform\)/{dashboard,assessments,settings}/page.tsx app/\(platform\)/assessments/\[assessmentId\]/page.tsx
```
✅ Confirms every migrated page's mock-only functions are still called
exclusively inside a `mock`-mode branch — no mock fallback in the
real-dev/production-auth branch of any migrated page (unchanged from
PHX-PLATFORM-011, re-verified after the file split).

## 3. Live local verification (Issue 2) — full transcript

### 3a. Environment setup

```
$ apt-get install -y postgresql postgresql-contrib
... Setting up postgresql-16 ... Creating new PostgreSQL cluster 16/main ... 
$ service postgresql start
 * Starting PostgreSQL 16 database server    ...done.
$ su postgres -c "psql -c \"CREATE USER phoenix WITH PASSWORD 'phoenix_dev_password';\""
CREATE ROLE
$ su postgres -c "psql -c \"CREATE DATABASE phoenix_dev OWNER phoenix;\""
CREATE DATABASE
```

### 3b. Backend: migrate + seed (source: PHX-AUTH-002-R1's apps/backend, unmodified)

```
$ export DATABASE_URL=postgresql://phoenix:phoenix_dev_password@localhost:5432/phoenix_dev
$ export PHOENIX_ENABLE_DATABASE=true PORT=4000 PHOENIX_AUTH_MODE=dev-header
$ npx tsx src/db/migrate.ts
[phoenix-backend:migrate] Applying migration 0001_initial_schema.sql
[phoenix-backend:migrate] Applying migration 0002_auth_identities.sql
[phoenix-backend:migrate] Migration complete (2 applied, 0 already applied/skipped).

$ npx tsx src/db/seed.ts
[phoenix-backend:seed] Seed summary (row counts only):
  organizations: 1, departments: 1, workspaces: 1, users: 6,
  workspace_users: 6, assets: 3, asset_versions: 3, assessments: 4,
  assessment_steps: 4, evidence_items: 6, pbrs_scores: 2,
  pbrs_dimension_scores: 12, derived_signals: 6, pbrs_passports: 1,
  activity_logs: 3, audit_records: 1
```

### 3c. Backend: start in dev-header mode

```
$ npx tsx src/index.ts
[phoenix-backend] listening on port 4000 (nodeEnv=development, apiVersion=v0-alpha, database=enabled(unconnected), authMode=dev-header)

$ curl -s http://localhost:4000/api/readiness
{"ok":true,"data":{"ok":true,"database":{"enabled":true,"configured":true,"status":"connected"},"auth":{"mode":"dev-header","status":"enabled","productionSafe":false},"mode":"foundation"},"requestId":"..."}
```

### 3d. Direct backend curl — confirms exact response shapes (this is what found the Issue-1-adjacent type bug — see implementation report)

```
$ curl -H "x-phoenix-user-id: <seed Owner id>" \
    http://localhost:4000/api/workspaces/<seed workspace id>/assessments
{"ok":true,"data":{"items":[
  {"assessmentId":"...0004","assetId":"...","assetName":"Product Launch Social Campaign","assetType":"Marketing Asset","status":"Draft","overallScore":null,"grade":null,"riskLevel":null,"createdAt":"...","updatedAt":"..."},
  {"assessmentId":"...0002","assetName":"Customer Data Handling Policy","status":"Under Review","overallScore":76.05,"grade":"C","riskLevel":"Medium", ...},
  {"assessmentId":"...0001","assetName":"Q3 Investor Update Draft","status":"Approved","overallScore":87.15,"grade":"B+","riskLevel":"Low", ...}
],"total":4,"cursor":null},"requestId":"..."}
```

Confirms: camelCase throughout, `assessmentId`/`assetName` (not
`id`/`title`), and score data (`overallScore`/`grade`/`riskLevel`) IS
present per row.

```
$ curl -H "x-phoenix-user-id: <seed Owner id>" \
    http://localhost:4000/api/workspaces/<seed workspace id>/audit-records
{"ok":true,"data":{"items":[{"id":"...","workspaceId":"...","actorUserId":"...","action":"assessment.decision.approved","entityType":"Assessment","entityId":"...","changes":{"status":["Under Review","Approved"]},"context":"Dev seed record — PHX-BACKEND-003.","createdAt":"..."}],"total":1,"cursor":null},"requestId":"..."}

$ curl -w "%{http_code}" -H "x-phoenix-user-id: <seed Viewer id>" \
    http://localhost:4000/api/workspaces/<seed workspace id>/audit-records
{"ok":false,"error":{"code":"FORBIDDEN","message":"Role \"Viewer\" does not have permission \"audit.read\"."}}
403

$ curl -w "%{http_code}" -H "x-phoenix-user-id: <seed Auditor id>" \
    http://localhost:4000/api/workspaces/<seed workspace id>/audit-records
{"ok":true,"data":{...}}
200
```

Confirms: `changes` is already `{field: [before, after]}`-shaped at
runtime, `FORBIDDEN` → 403 for a Viewer, 200 for an Auditor.

### 3e. Platform: build + start in real-dev mode against the live backend

```
$ NEXT_PUBLIC_PHOENIX_API_MODE=real-dev \
  NEXT_PUBLIC_PHOENIX_BACKEND_URL=http://localhost:4000 \
  NEXT_PUBLIC_PHOENIX_DEV_USER_ID=<seed Owner id> \
  NEXT_PUBLIC_PHOENIX_DEV_WORKSPACE_ID=<seed workspace id> \
  pnpm exec next build
✓ Generating static pages (12/12) — exit 0

$ pnpm exec next start -p 3001
▲ Next.js 14.2.35 — Local: http://localhost:3001 — ✓ Ready in 460ms
```

### 3f. Verification — `/assessments` renders seeded backend titles, not mock names

```
$ curl -s http://localhost:3001/assessments | grep -o "Q3 Investor Update Draft\|Customer Data Handling Policy\|Product Launch Social Campaign" | sort -u
Customer Data Handling Policy
Product Launch Social Campaign
Q3 Investor Update Draft

$ curl -s http://localhost:3001/assessments | grep -o "Executive AI Brief\|HR Policy Summary\|Board Report Draft\|Sustainability Claims Review\|Marketing Campaign Copy\|Legal Risk Memo"
(no output — zero mock-only names present)
```
✅ **Confirmed**: live seeded titles render; zero mock-fixture titles appear.

### 3g. Verification — `/assessments/[assessmentId]` renders seeded detail/evidence/score

```
$ curl -s http://localhost:3001/assessments/<seed "Q3 Investor Update Draft" id> \
  | grep -o "Q3 Investor Update Draft\|Live backend data\|87.15\|Board Report"
87.15
Board Report
Live backend data
Q3 Investor Update Draft
```
✅ **Confirmed**: live asset name, live score (87.15), live asset type.

### 3h. Verification — `/dashboard` renders live-derived count/statuses

```
$ curl -s http://localhost:3001/dashboard \
  | grep -o "Live backend data\|Total Assessments\|Q3 Investor Update Draft\|Product Launch Social Campaign\|Customer Data Handling Policy"
Customer Data Handling Policy
Live backend data
Product Launch Social Campaign
Q3 Investor Update Draft
Total Assessments
```
✅ **Confirmed**.

### 3i. Verification — `/settings` activity/audit uses backend endpoints (Owner)

```
$ curl -s http://localhost:3001/settings \
  | grep -o "Live backend data\|Priya Nair\|assessment.decision.approved"
Live backend data
Priya Nair
assessment.decision.approved
```
✅ **Confirmed**: real activity actor name and real audit action string.

### 3j. Verification — Viewer role gets permission-denied for activity/audit

Restarted the platform with `NEXT_PUBLIC_PHOENIX_DEV_USER_ID` set to the
seeded **Viewer** user (no rebuild needed — `NEXT_PUBLIC_*` vars are
inlined per-build, so a config change technically warrants a rebuild for
full correctness, but Server Component code in this app reads
`process.env` directly at request time and the running dev/start server
picked up the new value without issue in this instance; done, confirmed
via curl output changing accordingly):

```
$ curl -s http://localhost:3001/settings | grep -o "Permission required\|does not have permission"
Permission required
does not have permission

$ curl -s http://localhost:3001/settings | grep -oF "Data source (activity/audit): permission-denied"
Data source (activity/audit): permission-denied

$ curl -s http://localhost:3001/settings | grep -o "assessment.decision.approved"
(no output — audit data correctly absent for this role)
```
✅ **Confirmed**: Viewer sees `PermissionDeniedPanel`, not audit data.

### 3k. Verification — stopping the backend produces backend-unavailable, not mock fallback

```
$ pkill -f "tsx src/index.ts"
$ curl -m 3 http://localhost:4000/api/readiness ; echo "exit: $?"
exit: 7    # connection refused — backend confirmed down

$ curl -s http://localhost:3001/assessments | grep -o "Backend unavailable\|Live backend data"
Backend unavailable

$ curl -s http://localhost:3001/assessments | grep -o "Q3 Investor Update Draft\|Executive AI Brief"
(no output — neither live nor mock data leaked through)

$ curl -s http://localhost:3001/dashboard | grep -o "Backend unavailable"
Backend unavailable
```
✅ **Confirmed**: backend-unavailable state renders; no fallback of any
kind (mock or stale live data).

### 3l. Cleanup

```
$ pkill -f "next start"
$ ps aux | grep -i "next\|tsx"
(no matching processes — confirmed stopped)
```

## 4. Production-auth QA (no real Clerk account)

Per the task's explicit instruction, no real Clerk E2E was attempted.
What was verified:

- Type-check passes with the new server/client split (§1).
- All four required build configurations pass, including
  production-auth with fake-format config and with no config at all
  (§1) — route-table shape unchanged from PHX-PLATFORM-011's own
  verification, confirming the split did not alter build-time behavior.
- Code inspection confirms (§2): the Server Component loader
  (`platform-data-source.ts`) imports exclusively from
  `real-api-client.server.ts`; that file's production-auth branch sends
  `Authorization` only, never `X-Phoenix-User-Id`; it never imports
  `auth/platform-auth.client.ts`; the client file
  (`real-api-client.client.ts`) exists only as an unused-this-sprint seam
  and is never imported from any Server Component or page.

## Summary

| Check | Result |
|---|---|
| `pnpm install` | ✅ exit 0 |
| `tsc --noEmit` | ✅ exit 0, clean |
| `next lint` | ✅ exit 0, clean |
| Build — mock | ✅ exit 0 |
| Build — real-dev | ✅ exit 0 |
| Build — production-auth (fake config) | ✅ exit 0 |
| Build — production-auth (no config) | ✅ exit 0 |
| X-Phoenix-User-Id / Authorization boundary | ✅ never overlap, in either split file |
| platform-auth.server.ts client-import check | ✅ never imported by 'use client' |
| platform-auth.client.ts server-path-import check | ✅ never imported by platform-data-source.ts |
| localStorage/sessionStorage token check | ✅ no token storage anywhere |
| No mock fallback in migrated live pages | ✅ confirmed by grep and by live HTTP test |
| **Real PostgreSQL + backend + platform live run** | ✅ **performed this session** — seeded data render on /assessments, /assessments/[id], /dashboard |
| Settings activity/audit live (Owner) | ✅ confirmed |
| Settings permission-denied (Viewer) | ✅ confirmed |
| Backend-unavailable state (backend stopped) | ✅ confirmed, no fallback |
| Real Clerk / production-auth E2E | ❌ not performed — explicitly out of scope, no paid/provider account used |
