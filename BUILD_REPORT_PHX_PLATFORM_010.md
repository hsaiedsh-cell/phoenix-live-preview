# BUILD REPORT — PHX-PLATFORM-010 (Clerk Platform Auth Integration)

## Install

```
$ corepack enable && corepack prepare pnpm@latest --activate
$ pnpm install --frozen-lockfile=false
Packages: +394
Done in 20.5s
```

Resolved `@clerk/nextjs@6.39.6` (requested `^6.12.0`) against `next@14.2.35`,
`react@18.3.1`. No dependency conflicts. `@clerk/shared`'s postinstall
telemetry notice printed (informational only, not an error).

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

| Configuration | Command | Result |
|---|---|---|
| mock (no `.env.local`) | `pnpm --filter @phoenix/platform run build` | Exit 0, all routes static except `[assessmentId]` |
| real-dev (backend URL + dev user id set) | same | Exit 0, identical route table to mock |
| production-auth (fake-format Clerk keys) | same | Exit 0, all `(platform)` routes correctly dynamic (ƒ) |
| production-auth (no Clerk key at all) | same | Exit 0, all routes static — `ClerkProviderShell` renders its config-error panel before any Clerk server code runs |

Full logs and exact env values used are in
`docs/platform/PHX_PLATFORM_010_AUTH_QA_REPORT.md`.

## Files added

```
apps/platform/src/lib/auth/platform-auth.ts
apps/platform/src/lib/auth/platform-auth.client.ts
apps/platform/src/lib/auth/platform-auth.server.ts
apps/platform/src/components/ClerkProviderShell.tsx
apps/platform/src/components/ClerkSignInPanel.tsx
apps/platform/src/components/ProductionAuthGate.tsx
apps/platform/.env.example
apps/platform/.env.local.example
docs/platform/PHX_PLATFORM_010_IMPLEMENTATION_REPORT.md
docs/platform/PHX_PLATFORM_010_AUTH_QA_REPORT.md
docs/platform/RELEASE_NOTES_PHX_PLATFORM_010.md
BUILD_REPORT_PHX_PLATFORM_010.md
```

## Files modified

```
apps/platform/package.json                          (+@clerk/nextjs dependency)
apps/platform/src/lib/api-config.ts                  (rewritten: +real-dev, +production-auth modes)
apps/platform/src/lib/real-api-client.ts              (rewritten: mode-aware header attachment + read helpers)
apps/platform/src/app/layout.tsx                      (+ClerkProviderShell wrapper)
apps/platform/src/app/(platform)/layout.tsx           (mode-based gate selection: AuthGate vs ProductionAuthGate)
apps/platform/src/app/login/page.tsx                  (+production-auth early-return branch)
apps/platform/src/app/(platform)/settings/page.tsx    (expanded runtime indicator)
.env.example                                          (root — updated mode list)
```

## Files NOT modified (explicitly, per acceptance criteria)

```
apps/platform/src/components/AuthGate.tsx
apps/platform/src/components/SessionProvider.tsx
apps/platform/src/lib/mock-session.ts
apps/platform/src/lib/auth-types.ts
apps/platform/src/lib/access-control.ts
apps/platform/src/components/LoginRoleSelector.tsx
packages/pbrs/**
packages/core/src/contracts/pbrs-score.ts
apps/platform/src/lib/certification-levels.ts
apps/backend/**  (not included in this deliverable — no backend file touched)
```

## Dependencies added

```
@clerk/nextjs: ^6.12.0  (resolved 6.39.6)
```

No other dependency was added, upgraded, or removed.

## Issues found / fixed during this sprint

- **PHX-LIVE-001 / PHX-PLATFORM-009 divergence:** PHX-LIVE-001's real-dev
  additions were delivered as a small standalone patch with its own
  differently-shaped `api-config.ts`/`real-api-client.ts`, not merged into
  PHX-PLATFORM-009's canonical tree. Resolved by merging real-dev's
  behavior into PHX-PLATFORM-009's file structure (documented as a
  deliberate deviation in the implementation report) rather than carrying
  two competing client files forward.
- **Static Clerk build with no config:** initial `ClerkProviderShell` draft
  rendered `<ClerkProvider>` unconditionally when `production-auth` was
  selected, which would have thrown at render time with a missing
  publishable key. Fixed by adding the explicit `!clerkPublishableKey`
  guard before ever rendering `<ClerkProvider>` — verified via the "no
  Clerk key at all" build (all routes stayed static, confirming the
  guard fires before any Clerk code path is reached).
- No other build/lint/type errors were encountered.
