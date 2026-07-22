# BUILD REPORT — PHX-PLATFORM-010-R1 (Clerk Config Gate & Mock Data Transparency Fix)

## Install

```
$ pnpm install --frozen-lockfile=false
Lockfile is up to date, resolution step is skipped
Packages: +394
Done in 6.7s
```

No dependency was added, upgraded, or removed this sprint — `@clerk/nextjs`
remains at the version PHX-PLATFORM-010 installed (`^6.12.0`, resolved
`6.39.6`).

## Type-check

```
$ pnpm --filter @phoenix/platform run type-check
> tsc --noEmit
```
Exit 0, no output.

## Lint

```
$ pnpm --filter @phoenix/platform run lint
> next lint
✔ No ESLint warnings or errors
```
Exit 0.

## Builds

| Configuration | Result | Route shape |
|---|---|---|
| mock (no env) | Exit 0 | Static, identical to PHX-PLATFORM-010 |
| real-dev | Exit 0 | Static, identical to mock |
| production-auth, all fake config present | Exit 0 | All `(platform)` routes dynamic (ƒ) |
| production-auth, missing publishable key | Exit 0 | All static — `ClerkProviderShell` + `ProductionAuthGate` both short-circuit |
| production-auth, missing backend URL | Exit 0 | All static — `ProductionAuthGate` short-circuits before `auth()` |
| production-auth, missing `CLERK_SECRET_KEY` only | Exit 0 | **All static** — proves `auth()` never called; config-missing, not signed-out |

Full logs, exact env values, and the reasoning behind each result are in
`docs/platform/PHX_PLATFORM_010_R1_AUTH_QA_REPORT.md`.

## Files added

```
apps/platform/src/components/MockDataTransparencyBanner.tsx
docs/platform/PHX_PLATFORM_010_R1_IMPLEMENTATION_REPORT.md
docs/platform/PHX_PLATFORM_010_R1_AUTH_QA_REPORT.md
docs/platform/RELEASE_NOTES_PHX_PLATFORM_010_R1.md
BUILD_REPORT_PHX_PLATFORM_010_R1.md
```

## Files modified

```
apps/platform/src/lib/auth/platform-auth.server.ts   (+getServerAuthConfigStatus, +isServerClerkSecretConfigured, gated resolveProductionAuthState/getServerBackendToken)
apps/platform/src/lib/auth/platform-auth.ts           (+ServerAuthConfigStatus re-export)
apps/platform/src/components/ProductionAuthGate.tsx   (+MockDataTransparencyBanner in signed-in branch, richer config-missing text)
apps/platform/src/app/(platform)/settings/page.tsx    (+three-part server config status, explicit auth-state line)
```

## Files NOT modified (explicitly)

```
apps/platform/src/lib/api-config.ts        (client-safe boundary, unchanged — CLERK_SECRET_KEY correctly stays out of it)
apps/platform/src/lib/real-api-client.ts   (header-attachment logic unaffected by this fix, re-verified only)
apps/platform/src/components/AuthGate.tsx
apps/platform/src/components/SessionProvider.tsx
apps/platform/src/lib/mock-session.ts
apps/platform/src/app/login/page.tsx
apps/platform/src/components/ClerkSignInPanel.tsx
apps/platform/src/components/ClerkProviderShell.tsx
apps/platform/package.json                  (no dependency change)
packages/pbrs/**, packages/core/src/contracts/pbrs-score.ts, certification-levels.ts
apps/backend/**  (not included in this deliverable — no backend file touched)
```

## Dependencies added

None. `@clerk/nextjs` version is unchanged from PHX-PLATFORM-010.

## Issues found / fixed during this sprint

- **Issue 1 (as filed):** confirmed and fixed — see implementation report
  and QA report §8 for the build-level proof (missing-secret-key build
  stays fully static, proving `auth()` is never invoked and the result is
  `config-missing`, not `signed-out`).
- **Issue 2 (as filed):** confirmed and fixed via Option A — persistent
  banner added, scoped to signed-in production-auth routes only.
- No other build/lint/type errors were encountered this sprint.
