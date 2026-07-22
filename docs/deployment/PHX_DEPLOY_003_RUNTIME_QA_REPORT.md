# PHX-DEPLOY-003 — Runtime QA Report

All commands below were actually run against the reconciled source tree in
this sprint's execution environment (Ubuntu 24, local PostgreSQL 16 installed
via `apt-get`, Node 22, pnpm 8.15.9). Output is trimmed for length but not
edited for content.

## Task 7 — Build and static QA

```
$ pnpm install --no-frozen-lockfile
Scope: all 11 workspace projects
...
Done in 36.2s
```

```
$ pnpm --filter @phoenix/backend type-check   # tsc --noEmit
(no output — PASS)

$ pnpm --filter @phoenix/backend lint          # eslint "src/**/*.ts"
(no output — PASS)

$ pnpm --filter @phoenix/backend build          # tsc -p tsconfig.json
(no output — PASS)

$ pnpm --filter @phoenix/platform type-check    # tsc --noEmit
(no output — PASS)

$ pnpm --filter @phoenix/platform lint          # next lint
✔ No ESLint warnings or errors

$ pnpm --filter @phoenix/platform build         # next build
✓ Compiled successfully
✓ Generating static pages (12/12)
Route (app)                              Size     First Load JS
├ ƒ /assessments                         3.38 kB         101 kB
├ ƒ /assessments/[assessmentId]          3.79 kB         110 kB
├ ○ /assessments/new                     4.4 kB          104 kB
├ ○ /certifications                      1.89 kB         108 kB
├ ƒ /dashboard                           180 B          96.2 kB
├ ○ /login                               2.62 kB         132 kB
├ ○ /passports                           1.7 kB          108 kB
├ ○ /reports                             180 B          96.2 kB
└ ƒ /settings                            713 B          98.5 kB
ƒ Middleware                             78.4 kB
```

website/dashboard packages were not built this sprint — out of scope (this
sprint's brief only names backend + platform), and this sprint made no
changes under `apps/website` or `apps/dashboard`.

## Task 8 — Backend local runtime QA

Database setup:
```
$ npx tsx src/db/migrate.ts
[phoenix-backend:migrate] Applying migration 0001_initial_schema.sql
[phoenix-backend:migrate] Applying migration 0002_auth_identities.sql
[phoenix-backend:migrate] Migration complete (2 applied, 0 already applied/skipped).

$ npx tsx src/db/seed.ts        # first run
...
$ npx tsx src/db/seed.ts        # second run — idempotency check
[phoenix-backend:seed] Seed summary (row counts only...):
  organizations: 1, departments: 1, workspaces: 1, users: 6,
  workspace_users: 6, assets: 3, asset_versions: 3, assessments: 4,
  assessment_steps: 4, evidence_items: 6, pbrs_scores: 2,
  pbrs_dimension_scores: 12, derived_signals: 6, pbrs_passports: 1,
  activity_logs: 3, audit_records: 1
```
Identical row counts on both runs — **seed confirmed idempotent**.

```
$ npx tsx src/db/smoke.ts
[phoenix-backend:smoke] Database connected
[phoenix-backend:smoke] Migrations table found
[phoenix-backend:smoke] Applied migrations: 2
[phoenix-backend:smoke] Public tables: 23
[phoenix-backend:smoke] First 10 table(s): activity_logs, assessment_steps,
  assessments, asset_versions, assets, audit_records, auth_identities,
  departments, derived_signals, evidence_items
```
`auth_identities` confirmed present.

### A) `dev-header` mode (default)

Started: `authMode=dev-header` (log-confirmed). Workspace
`00000003-1111-4111-8111-000000000001`, Owner user
`00000004-1111-4111-8111-000000000001`, Viewer user
`00000004-1111-4111-8111-000000000004`.

| Request | Result |
|---|---|
| No header, protected route | `401 AUTH_REQUIRED` |
| Valid Owner header | `200`, real seeded data returned |
| Viewer header (read route) | `200` — viewers can read, as expected |
| Malformed header (`not-a-uuid`) | `400 VALIDATION_ERROR`, `INVALID_UUID` |
| Well-formed but unknown user id | `401 AUTH_REQUIRED`, "No user was found..." |
| `/api/readiness` | `auth: {mode: dev-header, status: enabled, productionSafe: false}`, `cors: {status: not_configured, allowedOriginsCount: 0, wildcardAllowed: false}` |

### B) `oidc-jwt` misconfigured (no issuer/audience/JWKS/provider set)

```
GET /api/readiness →
"auth": {"mode": "oidc-jwt", "status": "misconfigured", "productionSafe": false}

GET /api/workspaces/.../assessments (no header) →
401 {"code":"AUTH_NOT_CONFIGURED","message":"Production authentication (oidc-jwt) is not fully configured for this backend."}

GET /api/workspaces/.../assessments (WITH valid x-phoenix-user-id header) →
401 — SAME error. The dev-header does not bypass oidc-jwt mode.
```

### C) `production-disabled`

```
GET /api/readiness → "auth": {"mode":"production-disabled","status":"disabled","productionSafe":true}
GET protected route (no header) → 401 AUTH_NOT_CONFIGURED, "Production authentication is not configured for this backend."
GET protected route (WITH dev-header) → SAME 401 — dev-header ignored entirely in this mode.
```

### D) `token-placeholder`

```
GET /api/readiness → "auth": {"mode":"token-placeholder","status":"not_implemented","productionSafe":false}
GET protected route → 501 {"code":"AUTH_NOT_IMPLEMENTED","message":"Token authentication is not implemented in this release.","details":{"authorizationHeaderPresent":false}}
```

### E) Production boot guard

```
$ NODE_ENV=production PHOENIX_AUTH_MODE=dev-header npx tsx src/index.ts
[phoenix-backend] Startup aborted — unsafe auth mode for this environment:
  PHOENIX_AUTH_MODE=dev-header is not allowed when NODE_ENV=production. ...
```
Process exits before listening — confirmed by `timeout`-wrapped run with no
"listening on port" line ever printed.

```
$ NODE_ENV=production PHOENIX_AUTH_MODE=dev-header \
  PHOENIX_DANGEROUSLY_ALLOW_DEV_HEADER_IN_PRODUCTION=true npx tsx src/index.ts
[phoenix-backend] listening on port 4002 (nodeEnv=production, ..., authMode=dev-header)
```
Override works exactly as documented — an explicit, alarming-named escape
hatch, not a default.

```
$ NODE_ENV=production npx tsx src/index.ts   # no PHOENIX_AUTH_MODE set
[phoenix-backend] listening on port 4003 (nodeEnv=production, ..., authMode=production-disabled)
```
Confirms the safe default: production with nothing explicitly set resolves
to `production-disabled`, not a crash and not `dev-header`.

## Task 9 — CORS runtime QA

Backend started with `PHOENIX_ALLOWED_ORIGINS=http://localhost:3001,https://preview.example.com`.

```
$ curl -i -X OPTIONS -H "Origin: http://localhost:3001" http://localhost:4000/api/readiness
HTTP/1.1 204 No Content
Access-Control-Allow-Origin: http://localhost:3001
Vary: Origin
Access-Control-Allow-Methods: GET,POST,PATCH,DELETE,OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization, X-Request-Id
Access-Control-Expose-Headers: X-Request-Id

$ curl -i -X OPTIONS -H "Origin: https://evil.example.com" http://localhost:4000/api/readiness
HTTP/1.1 204 No Content
(no Access-Control-* headers at all)

$ curl -i -H "Origin: http://localhost:3001" http://localhost:4000/api/readiness
HTTP/1.1 200 OK
Access-Control-Allow-Origin: http://localhost:3001
...

$ curl -i -H "Origin: https://evil.example.com" http://localhost:4000/api/readiness
HTTP/1.1 200 OK
(no Access-Control-* headers)

$ curl -i http://localhost:4000/api/readiness   # no Origin header at all
HTTP/1.1 200 OK
(no Access-Control-* headers — unaffected, as expected for non-browser calls)

$ curl -s http://localhost:4000/api/readiness | jq .data.cors
{"status": "configured", "allowedOriginsCount": 2, "wildcardAllowed": false}
```

**Wildcard rejection test** — backend restarted with `PHOENIX_ALLOWED_ORIGINS=*`:
```
[Phoenix][cors] PHOENIX_ALLOWED_ORIGINS contained "*" — wildcard origins are
never honored by this backend. The "*" entry was ignored...

$ curl -i -H "Origin: https://anything.example.com" http://localhost:4000/api/readiness
HTTP/1.1 200 OK
(no Access-Control-* headers)

$ curl -s http://localhost:4000/api/readiness | jq .data.cors
{"status": "not_configured", "allowedOriginsCount": 0, "wildcardAllowed": false}
```
No origin is ever allowed under a literal `*` entry — confirmed.

## Task 10 — Platform local production-auth QA

**Real Clerk sign-in was not run** — `clerk.com` and `api.clerk.dev` both
returned `403 host_not_allowed` from this sandbox's network egress, the same
class of blocker `PHX-AUTH-003`'s build report already documented. This is a
sandbox network policy, not a Phoenix configuration problem.

What **was** actually run, against the live, migrated/seeded backend from
Task 8:

1. Platform built and started (`next start`) in `real-dev` mode
   (`NEXT_PUBLIC_PHOENIX_API_MODE=real-dev`, dev user/workspace ids pointed at
   the seeded Owner and seeded workspace).
2. First attempt with no Clerk keys configured at all: every route 500'd with
   `@clerk/nextjs: Missing publishableKey` — because `middleware.ts`'s
   matcher covers essentially every route regardless of API mode. This is a
   real, load-bearing finding (see the Blocker Resolution Report's B3
   section) — not a defect introduced this sprint, but worth documenting
   clearly since it means **no route on this platform boots without
   Clerk credentials configured, in any mode**.
3. Rebuilt with syntactically-valid (but fake/local-only) placeholder Clerk
   keys present at `next build` time (`pk_test_...`, `sk_test_...` — both
   base64-decode to obviously-fake strings, never resembling a real key; see
   the Security Scan Report for why these are safe to include in this
   report). After rebuilding:

```
$ curl -o /dev/null -w "%{http_code}\n" http://localhost:3001/dashboard
200
$ curl -o /dev/null -w "%{http_code}\n" http://localhost:3001/assessments
200
$ curl -o /dev/null -w "%{http_code}\n" http://localhost:3001/login
200
$ curl -o /dev/null -w "%{http_code}\n" http://localhost:3001/settings
200
$ curl -o /dev/null -w "%{http_code}\n" http://localhost:3001/passports
200
$ curl -o /dev/null -w "%{http_code}\n" http://localhost:3001/certifications
200
$ curl -o /dev/null -w "%{http_code}\n" http://localhost:3001/reports
200
```

4. Confirmed the three preview-only pages carry the required label in their
   server-rendered HTML:
```
$ curl -s http://localhost:3001/passports | grep -io "preview-only"
Preview-only
$ curl -s http://localhost:3001/certifications | grep -io "preview-only"
Preview-only
$ curl -s http://localhost:3001/reports | grep -io "preview-only"
Preview-only
```

5. Used Playwright (pinned `1.56.0`, pre-cached Chromium at
   `/opt/pw-browsers/chromium-1194`) to load `/dashboard` and `/assessments`
   in a real headless browser and read the rendered body text. Result: the
   Clerk client bundle attempts to reach the (fake) Clerk frontend-API host
   and the browser reports:
   `Host not in allowlist: fake-domain-for-local-qa.clerk.accounts.dev.` —
   the **same network-egress blocker class**, now hit from the browser side
   rather than the server side. This means the actual live-data panels
   inside `/dashboard` and `/assessments` (which fetch client-side via
   `real-api-client.client.ts`) could not be visually confirmed pixel-by-
   pixel in this sandbox, even though:
   - the backend they'd call is confirmed live and correct (Task 8/9 above),
   - the pages themselves compile, route, and return `200` server-side,
   - and code inspection confirms `LiveScorePanel`/`LiveAssessmentsTable`/
     `LiveActivityAuditLists`/`LiveEvidenceList` call `real-api-client.ts`,
     which calls the same backend already QA'd in Tasks 8–9.

**What remains for human local/hosted QA** (cannot be completed from this
sandbox): sign in through a real Clerk instance (test or preview app) and
visually confirm the dashboard/assessments/settings panels render live
backend data end-to-end in a browser with normal network access. This sprint
does not claim that step passed — it explicitly did not run.

## Task 11 — Security scan

```
$ find . -iname ".env" -o -iname ".env.local"   # (excluding node_modules)
(only *.example / *.env.local.example templates — no real .env/.env.local files)

$ grep -rlE "sk_test_[A-Za-z0-9]{10,}|sk_live_...|pk_test_...|pk_live_..." \
  --include="*.ts" --include="*.tsx" --include="*.md" --include="*.example" .
(no matches — the fake keys used transiently for local QA above were never
 committed to any file in this tree; they were only ever exported as shell
 env vars / written to a gitignored-pattern .env.local that was deleted
 before packaging)

$ grep -rn "Access-Control-Allow-Origin.*['\"]\*['\"]" apps/backend/src
(no matches — no wildcard CORS header is ever set anywhere in source)

$ grep -rn "PHOENIX_DANGEROUSLY_ALLOW_DEV_HEADER_IN_PRODUCTION=true" --include="*.example" .
apps/backend/.env.example:101:# PHOENIX_DANGEROUSLY_ALLOW_DEV_HEADER_IN_PRODUCTION=true
(commented out — documentation of the escape hatch, not an active setting)

$ grep -rln "localStorage|sessionStorage" apps/platform/src
apps/platform/src/components/SessionProvider.tsx
apps/platform/src/lib/mock-session.ts
apps/platform/src/lib/auth/platform-auth.client.ts
```
Inspected all three: `mock-session.ts` stores only a mock "active role"
label (`MOCK_ACTIVE_ROLE_STORAGE_KEY`) used by the mock-mode QA role
switcher — not a credential. `platform-auth.client.ts` explicitly documents
"No token is ever written to localStorage/sessionStorage here" and calls
Clerk's own in-memory `session.getToken()` per request. **No auth token of
any kind is persisted to browser storage.**

**Security scan result: clean.** See
`PHX_DEPLOY_003_SECURITY_SCAN_REPORT.md` for the consolidated pass/fail
table.
