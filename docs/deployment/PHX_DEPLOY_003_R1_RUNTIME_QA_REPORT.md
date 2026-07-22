# PHX-DEPLOY-003-R1 — Runtime QA Report

All commands actually run against the fixed source tree, same execution
environment as PHX-DEPLOY-003 (Ubuntu 24, local PostgreSQL 16, Node 22,
pnpm 8.15.9, backend already migrated/seeded from the prior sprint).

## Build / lint / type-check

```
$ pnpm --filter @phoenix/backend type-check    → exit 0
$ pnpm --filter @phoenix/backend lint           → exit 0
$ pnpm --filter @phoenix/backend build          → exit 0
$ pnpm --filter @phoenix/platform type-check   → exit 0
$ pnpm --filter @phoenix/platform lint          → ✔ No ESLint warnings or errors
$ pnpm --filter @phoenix/platform build (mock defaults, no Clerk env) → PASS
  Route (app) ... ƒ Middleware  78.4 kB
```

## Mock mode — route smoke, zero Clerk keys

Backend running (dev-header mode, seeded DB, `PHOENIX_ALLOWED_ORIGINS=http://localhost:3001`).
Platform built with no Clerk env vars at all, started with no `.env.local`:

```
$ curl -o /dev/null -w "%{http_code}\n" http://localhost:3001/
200
$ .../login            → 200
$ .../dashboard         → 200
$ .../assessments       → 200
$ .../assessments/new   → 200
$ .../settings          → 200
$ .../passports         → 200
$ .../certifications    → 200
$ .../reports           → 200

$ grep -i "clerk\|error" <server log>
(no output — clean, zero Clerk-related lines of any kind)
```

## Real-dev mode — route smoke, zero Clerk keys

Rebuilt with `NEXT_PUBLIC_PHOENIX_API_MODE=real-dev`,
`NEXT_PUBLIC_PHOENIX_BACKEND_URL=http://localhost:4000`,
`NEXT_PUBLIC_PHOENIX_DEV_USER_ID=<seeded Owner id>`,
`NEXT_PUBLIC_PHOENIX_DEV_WORKSPACE_ID=<seeded workspace id>` — **no Clerk
vars** — started with matching runtime env, no `.env.local`:

```
$ curl ... /            → 200
$ curl ... /login       → 200
$ curl ... /dashboard   → 200
$ curl ... /assessments → 200
$ curl ... /assessments/new → 200
$ curl ... /settings    → 200
$ curl ... /passports   → 200
$ curl ... /certifications → 200
$ curl ... /reports     → 200

$ grep -i "clerk\|error" <server log>
(no output — clean)
```

`real-api-client.server.ts` confirmed (by inspection, unchanged this
sprint) to send `X-Phoenix-User-Id` only in this mode.

## Production-auth — config-missing (fail-closed) behavior

Rebuilt with `NEXT_PUBLIC_PHOENIX_API_MODE=production-auth`,
`NEXT_PUBLIC_PHOENIX_BACKEND_URL=http://localhost:4000` — **Clerk keys
deliberately absent** — started with matching runtime env:

```
$ curl -s http://localhost:3001/dashboard | grep -io "Auth configuration error"
Auth configuration error

$ curl -s http://localhost:3001/dashboard
... "Auth configuration error" ...
"NEXT_PUBLIC_PHOENIX_API_MODE is set to production-auth, but
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is missing. This deployment cannot show
platform data until Clerk is configured — production-auth never falls
back to mock mode automatically."
```

This is `ClerkProviderShell`'s root-layout-level gate (PHX-PLATFORM-010,
unmodified this sprint) — confirms the fail-closed behavior is fully
intact after the R1 middleware fix. No route silently showed mock data or
crashed.

### A genuine false alarm during this sprint's own QA (documented for transparency)

Earlier in this investigation, `/dashboard` briefly appeared to render mock
`AuthGate` content ("Preparing Phoenix Platform Alpha...") instead of the
config-missing gate, even with `production-auth` set at build time. Root
cause: `/dashboard` is a dynamic (`ƒ`) route, and dynamic routes read
`process.env` **fresh from the actual running `next start` process** at
request time — they are not guaranteed to reuse the build-time-inlined
value the way statically-generated (`○`) routes like `/login` are. The
`next start` invocation in question had been run in a shell that did not
have `NEXT_PUBLIC_PHOENIX_API_MODE` exported, so the dynamic route silently
resolved to the `mock` default at runtime, while static routes (built in a
shell that did have it set) correctly showed `production-auth` behavior.
Re-running `next start` with the same env vars as the `build` step
resolved this immediately and consistently across every route. This is
recorded here in full because it is exactly the kind of discrepancy this
sprint exists to catch — and because it is a testing-methodology artifact
of this sandbox (separate shell invocations don't share exported env vars),
not a code defect, and not a risk for a real hosted deployment where the
runtime environment is configured once and stays constant for the life of
the running process.

## Production-auth — configured (Clerk keys present) behavior

Rebuilt with `NEXT_PUBLIC_PHOENIX_API_MODE=production-auth`,
`NEXT_PUBLIC_PHOENIX_BACKEND_URL=http://localhost:4000`, and
placeholder-shaped Clerk keys (see Security Scan Report for exact
values and why they're safe to record):

```
$ pnpm --filter @phoenix/platform build
... ƒ Middleware  78.6 kB   (grew from 78.4 kB — Clerk code now bundled)

$ curl -i http://localhost:3001/dashboard
HTTP/1.1 200 OK
x-clerk-auth-reason: dev-browser-missing
x-clerk-auth-status: signed-out
...
<h1>Sign in required</h1>
<p>This deployment is running in production-auth (Clerk) mode. Sign in to
access Phoenix Platform.</p>
<a href="/login">Go to Sign In</a>
```

The `x-clerk-auth-status` / `x-clerk-auth-reason` response headers are set
only by Clerk's own middleware — their presence is direct proof
`clerkMiddleware()` genuinely executed for this request (not the
pass-through path), and the app correctly rendered `ProductionAuthGate`'s
"Sign in required" screen rather than mock data or a crash, exactly as
expected for a properly-configured-but-unauthenticated production-auth
deployment. (Real sign-in itself was not attempted — the placeholder Clerk
domain is unreachable from this sandbox's network egress, same class of
limitation as PHX-AUTH-003 / PHX-DEPLOY-003.)

```
$ for each of the 7 named routes + /:
    curl -o /dev/null -w "%{http_code}\n" ...
/               200
/login          200
/dashboard      200
/assessments    200
/settings       200
/passports      200
/certifications 200
/reports        200
```

All 200s, no crashes, with production-auth fully configured.

## Security scan

See `PHX_DEPLOY_003_R1_SECURITY_SCAN_REPORT.md` for the consolidated
result. Summary: clean — no secrets, no wildcard CORS, no token in
browser storage, no leftover diagnostic artifacts from this sprint's own
investigation (a temporary debug route used to inspect resolved API
config was created and fully removed before packaging).
