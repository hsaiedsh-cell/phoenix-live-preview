# PHX-DEPLOY-003 — Production CORS Security Design

## Purpose

Define exactly how `apps/backend/src/middleware/cors.ts`'s
`productionCorsMiddleware` behaves, so a reviewer can audit it against this
document rather than re-reading the implementation from scratch.

## Design summary

| Property | Behavior |
|---|---|
| Config source | `PHOENIX_ALLOWED_ORIGINS` — comma-separated exact origins |
| Wildcard (`*`) | Never honored. Parsed and discarded; logs one warning. |
| Unset / empty | No CORS headers set for **any** origin. Never falls back to "allow all". |
| Disallowed origin | No `Access-Control-Allow-Origin` header at all, on any method, including `OPTIONS`. |
| Credentials | `Access-Control-Allow-Credentials` is never set — this backend never uses cookies. |
| Preflight (`OPTIONS`) | Always `204`. Allowed origin: CORS headers present. Disallowed/no-Origin: `204` with no CORS headers. |
| Logging | Only ever logs allowlist size and the fact a `*` entry was seen — never the actual configured origins, tokens, or secrets. |
| `NODE_ENV=production` | No special-casing needed — behavior is identical in every `NODE_ENV`; safety comes from the allowlist being explicit, not from an environment check. |

## Why a new middleware instead of reusing `dev-cors.ts`

`dev-cors.ts` (PHX-LIVE-001) is single-origin and was designed as a
local-development convenience — enabled by default outside production, with
an explicit opt-in override for a production-like box. Task 2 of this sprint
calls for something structurally different: a **named env var
(`PHOENIX_ALLOWED_ORIGINS`), multiple exact origins, and identical behavior
in every environment** rather than an environment-conditional default. Rather
than bending `dev-cors.ts` to do both jobs (risking a regression in its
existing, already-shipped local-dev behavior), this sprint added a second,
narrowly-scoped file. `dev-cors.ts` is retained in the tree for local-dev
reference but is **not** wired into `server.ts` — only one CORS middleware
runs, avoiding duplicate/conflicting headers. A future sprint may retire
`dev-cors.ts` once local workflows migrate to `PHOENIX_ALLOWED_ORIGINS`;
that consolidation decision is explicitly out of scope here.

## Disallowed-origin OPTIONS: 204 vs 403

The task brief allows either "403 or 204 without allow headers, whichever is
safer and documented." This implementation always returns `204` for
`OPTIONS`, regardless of whether the origin is allowed — the only
difference is whether CORS headers are attached. Rationale:

- A `403` on `OPTIONS` for a disallowed origin would let a prober distinguish
  "this backend exists and rejected me" from "nothing is here," which is a
  strictly worse information leak than a uniform `204`.
- Non-browser callers (health checks, internal tooling issuing `OPTIONS` for
  unrelated reasons) are not blocked outright by this middleware; the actual
  authorization decision still happens in the normal auth/permission layer
  for the real request that follows. CORS headers only ever affect what a
  **browser** does with the response — they are not an authorization
  mechanism, and this backend does not treat them as one anywhere.

## Readiness exposure (`/api/readiness`'s `cors` block)

```json
"cors": {
  "status": "configured",
  "allowedOriginsCount": 2,
  "wildcardAllowed": false
}
```

Deliberately omits the actual origin strings. The task brief allows exposing
them if "considered safe," but preview URLs are treated here as sensitive
enough to withhold from an unauthenticated endpoint — `/api/readiness` has no
auth requirement by design (it is the health/readiness probe), so anything it
returns should be safe for an anonymous caller. A count and a boolean are
enough for an operator dashboard to know "is CORS configured at all,"
without handing an unauthenticated caller the exact set of trusted origins to
target.

## What this middleware does *not* do

- It is not an authentication or authorization mechanism. A request from a
  disallowed origin is not rejected by this middleware — it proceeds to
  the normal auth/permission stack exactly as before; only the browser-facing
  CORS headers differ. Blocking actually happens client-side, in the
  browser, once it sees no `Access-Control-Allow-Origin` for its origin.
- It does not rate-limit, log request bodies, or inspect the auth mode in
  any way — it runs unconditionally, before route registration, and is
  fully independent of `PHOENIX_AUTH_MODE`.

## Verification

See `PHX_DEPLOY_003_RUNTIME_QA_REPORT.md` for the full curl matrix: allowed
origin (headers present, 204/200), disallowed origin (no headers, 204/200),
no-Origin request (no headers, 200 — unaffected), and the wildcard-rejection
test (`PHOENIX_ALLOWED_ORIGINS=*` → `cors.status: not_configured`, no origin
receives headers).
