# BUILD_REPORT_PHX_DEPLOY_003_R1.md

**Task:** PHX-DEPLOY-003-R1 — Middleware Mode Safety Fix & Documentation
Cleanup
**Result:** Fixed. `apps/platform/src/middleware.ts` no longer requires Clerk
keys to boot mock/real-dev routes; production-auth's Clerk session
detection and fail-closed config-missing behavior are both confirmed
intact. `apps/backend/.env.example`'s stale oidc-jwt-fallback wording is
corrected. No deployment performed. No PBRS/scoring/certification changes.

## Scope

This is a narrowly-scoped R1, focused only on the middleware mode-safety
regression PHX-DEPLOY-003's own runtime QA found, plus the documentation
cleanup called out alongside it. No other file from PHX-DEPLOY-003 was
touched.

## What was wrong (recap)

PHX-DEPLOY-003's `middleware.ts` called `clerkMiddleware()` unconditionally.
Because its matcher covers nearly every route, any deployment without
`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY` set — including
`mock` and `real-dev` API modes, which have nothing to do with Clerk —
500'd on every matched route with `@clerk/nextjs: Missing publishableKey` /
`Missing secretKey`. That directly violates this file's own stated
requirements ("does not break mock mode", "does not break real-dev mode").

## Fix

`middleware.ts` now only constructs and invokes `clerkMiddleware()` when
both `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` are present
and non-empty. Otherwise it exports a plain pass-through middleware
(`NextResponse.next()`) that never imports or executes any Clerk SDK code.
Matcher is unchanged.

## Commands run

```
pnpm --filter @phoenix/backend type-check    # PASS
pnpm --filter @phoenix/backend lint           # PASS
pnpm --filter @phoenix/backend build           # PASS
pnpm --filter @phoenix/platform type-check    # PASS
pnpm --filter @phoenix/platform lint           # PASS (no ESLint warnings)

# Mock mode, zero Clerk env vars, fresh .next:
pnpm --filter @phoenix/platform build          # PASS
next start (no .env.local)                     # boots clean, no Clerk errors
curl 9 routes                                  # all 200

# real-dev mode, zero Clerk env vars, rebuilt with real-dev vars:
pnpm --filter @phoenix/platform build          # PASS
next start (matching runtime env)              # boots clean, no Clerk errors
curl 9 routes                                  # all 200

# production-auth, Clerk keys deliberately absent:
pnpm --filter @phoenix/platform build          # PASS (no crash at build time either)
next start (matching runtime env)              # boots clean
curl /dashboard, /login, etc.                  # all 200, correct config-missing gate content

# production-auth, valid-shaped placeholder Clerk keys present:
pnpm --filter @phoenix/platform build          # PASS, Middleware bundle grows (Clerk active)
next start (matching runtime env)              # boots clean
curl -i /dashboard                             # 200, x-clerk-auth-status: signed-out header present
                                                # body: "Sign in required" (not mock, not crash)
```

## A note on how this was actually verified (important methodology finding)

Next.js only inlines `NEXT_PUBLIC_*` env vars into **statically-generated**
routes at `next build` time. Routes marked `ƒ` (dynamic, server-rendered on
demand) — which includes `/dashboard`, `/assessments`, `/assessments/[id]`,
`/settings` in this app — read `process.env` **fresh, from the actual
running `next start` process**, at request time. This means `next build`
and `next start` must be run with the **same** env vars for dynamic-route
behavior to reflect what was intended; a mismatch (e.g. building with
`production-auth` set but starting the server in a shell that doesn't have
it) makes dynamic routes silently behave as if unset (defaulting to
`mock`), while static routes (`/login`, `/certifications`, etc.) still show
the build-time behavior. This caused a real false alarm during this
sprint's own QA — investigated and resolved by re-running `next start` with
matching env vars — and is recorded here because it is exactly the kind of
build/runtime env mismatch a real hosted deployment must avoid (a hosting
platform's env config applies for the life of the running process, so this
specific confusion is a sandbox/local-testing artifact, not a deployment
risk — but worth knowing when running local QA).

## Files changed this sprint

- `apps/platform/src/middleware.ts` — conditional Clerk invocation
- `apps/backend/.env.example` — two stale oidc-jwt wording blocks corrected
- `docs/deployment/PHX_DEPLOY_003_R1_*.md`, `RELEASE_NOTES_PHX_DEPLOY_003_R1.md` (new)
- `BUILD_REPORT_PHX_DEPLOY_003_R1.md` (this file)

No file under `packages/pbrs`, `packages/core`'s PBRS contracts, or any
certification threshold definition was touched. No `apps/backend/src`
file other than `.env.example` (a template, not source) was touched.
