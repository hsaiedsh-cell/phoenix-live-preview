# PHX-DEPLOY-003 — Security Scan Report

Scan performed against the final packaged tree (post test-artifact cleanup —
no `.env.local` left over from local QA; see Runtime QA Report Task 10 for
the transient placeholder keys used and confirmed deleted before packaging).

| Check | Result |
|---|---|
| `.env` present anywhere in tree | Not found |
| `.env.local` present anywhere in tree | Not found (removed after local QA) |
| `sk_test_` / `sk_live_` real-looking secrets | Not found |
| `pk_test_` / `pk_live_` real-looking keys | Not found |
| `DATABASE_URL` with a real (non-localhost, non-placeholder) host | Not found — only the documented local dev default (`localhost:5432/phoenix_dev`, matching `docker-compose.yml`, explicitly labeled dev-only) |
| Raw JWT-shaped strings (`eyJ...eyJ...` triple-segment) | Not found |
| Session cookie values | Not found — this backend does not use cookies |
| `PHOENIX_DANGEROUSLY_ALLOW_DEV_HEADER_IN_PRODUCTION=true` committed as active | Not found — the one occurrence in `.env.example` is commented out, documentation only |
| CORS wildcard (`Access-Control-Allow-Origin: *`) anywhere in source | Not found — `middleware/cors.ts` actively rejects a `*` entry in `PHOENIX_ALLOWED_ORIGINS` rather than ever emitting it |
| Auth token in `localStorage`/`sessionStorage` | Not found — the only browser-storage usage in `apps/platform/src` is a mock-mode "active role" label (`mock-session.ts`); `platform-auth.client.ts` explicitly never persists a Clerk token |
| `node_modules`, `.next`, `dist`, `.turbo`, `.tsbuildinfo` in package | Excluded from the final tar (see Task 13 exclusion list) |

## Notes on the placeholder Clerk keys used during Task 10 QA

To exercise `middleware.ts` and confirm mock/real-dev routes still boot
without a real Clerk account (network to `clerk.com`/`api.clerk.dev` is
blocked in this sandbox — see Runtime QA Report), two syntactically-valid but
obviously-fake keys were used transiently, as shell-exported environment
variables and a local `.env.local` that was deleted before packaging:

- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_<base64 of
  "fake-domain-for-local-qa.clerk.accounts.dev$">`
- `CLERK_SECRET_KEY=sk_test_<base64 of "fake-secret-key-for-local-qa-only">`

Both base64-decode to plainly-fake, self-describing strings — neither
resembles a real Clerk key, and the browser-side network block (`Host not
in allowlist: fake-domain-for-local-qa.clerk.accounts.dev`) independently
confirms this domain does not exist as a reachable service. These values are
recorded here, in this report only, for reproducibility of the QA steps —
they are not present anywhere in the shipped source tree.

## Overall result: **CLEAN**

No secrets, no wildcard CORS, no token persistence, no unsafe committed
overrides. Safe to package and share as a source-code deliverable.
