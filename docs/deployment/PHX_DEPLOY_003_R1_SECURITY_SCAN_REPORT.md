# PHX-DEPLOY-003-R1 — Security Scan Report

Scan performed against the final packaged tree (post cleanup — no
`.env.local`, no diagnostic/debug route left over from this sprint's own
investigation).

| Check | Result |
|---|---|
| `.env` present anywhere in tree | Not found |
| `.env.local` present anywhere in tree | Not found |
| Temporary debug route (`debugmode000`, used only to inspect resolved API config during this sprint's investigation) | Removed — confirmed absent from final tree |
| `sk_test_` / `sk_live_` real-looking secrets | Not found |
| `pk_test_` / `pk_live_` real-looking keys | Not found |
| CORS wildcard (`Access-Control-Allow-Origin: *`) anywhere in source | Not found (unchanged from PHX-DEPLOY-003 — `middleware/cors.ts` was not touched this sprint) |
| Auth token in `localStorage`/`sessionStorage` | Not found — same three files as PHX-DEPLOY-003 (`SessionProvider.tsx`, `mock-session.ts` — mock role label only, `platform-auth.client.ts` — explicitly documents no token persistence) |
| `PHOENIX_DANGEROUSLY_ALLOW_DEV_HEADER_IN_PRODUCTION=true` committed as active | Not found (commented out, unchanged from PHX-DEPLOY-003) |
| Middleware pass-through path imports Clerk SDK | Confirmed **not** — `passthroughMiddleware` only calls `NextResponse.next()`; `clerkMiddleware()` is never constructed unless both Clerk env vars are present |

## Notes on placeholder Clerk keys used during this sprint's QA

Same class of transiently-used, obviously-fake, syntactically-valid keys
as PHX-DEPLOY-003 (never committed to the tree):

- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_<base64 of
  "fake-domain-for-local-qa.clerk.accounts.dev$">`
- `CLERK_SECRET_KEY=sk_test_<base64 of "fake-secret-key-for-local-qa-only">`

Used only as shell-exported env vars for the "production-auth configured"
test in the Runtime QA Report; never written to any file that was
packaged.

## Overall result: **CLEAN**
