# Phoenix Platform — PHX-PLATFORM-009 QA Report

**Task ID:** PHX-PLATFORM-009
**Scope:** Backend Integration Readiness Layer (mode boundary only — no real backend).

---

## 1. Build Status

| App | `pnpm type-check` | `pnpm lint` | `pnpm build` |
|---|---|---|---|
| `apps/platform` | ✅ Pass | ✅ Pass (No ESLint warnings or errors) | ✅ Pass (12 routes) |
| `apps/website` | ✅ Pass | ✅ Pass | ✅ Pass (13 routes, untouched) |
| `apps/dashboard` | ✅ Pass | ✅ Pass | ✅ Pass (2 routes, untouched) |

Full monorepo `pnpm type-check` and `pnpm lint` (all three apps via
`pnpm --filter=./apps/*`) both pass cleanly. See
`BUILD_REPORT_PHX_PLATFORM_009.md` for full command output.

## 2. API Mode Checks (Task 9)

All four checks run against an actual `next build` + `next start` of
`apps/platform`, not just isolated unit logic:

| Configuration | `getPhoenixApiConfig().mode` | Verified via |
|---|---|---|
| No env vars set (default) | `mock` | Isolated `tsx` run of `api-config.ts` + full app build/start with default `.env` |
| `NEXT_PUBLIC_PHOENIX_API_MODE=mock` | `mock` | Isolated `tsx` run |
| `NEXT_PUBLIC_PHOENIX_API_MODE=real`, no enabled flag | `real-disabled` | Isolated `tsx` run |
| `NEXT_PUBLIC_PHOENIX_API_MODE=real`, `NEXT_PUBLIC_PHOENIX_REAL_API_ENABLED=true` | `real-disabled` (never flips to a "real" network mode) | Full `next build` with both env vars set, then `next start` and a live request against a temporary QA route calling all four governance actions — see §3. Temporary route removed before packaging; final build is the default-mode build. |

Settings page indicator text confirmed to switch correctly:
- Default/mock build → `Runtime Mode: Mock API Active`
- Real-mode build → `Runtime Mode: Real API Disabled — using mock runtime`

## 3. Governance Action Checks (Task 5 / Task 9 item 4)

A temporary `GET /api/qa-test` route (removed before final packaging) called
`issuePassport`, `revokePassport`, `grantCertification`, and
`revokeCertification` against the running production build in two
configurations:

**Mock-mode build** — all four returned `ok: true` with the same message
copy as PHX-PLATFORM-007 (e.g. *"Passport PBRS-ACME-2026-MOCK-GD issued.
Alpha mock workflow action — not persisted to a real backend yet."*).

**Real-mode build** (`NEXT_PUBLIC_PHOENIX_API_MODE=real`,
`NEXT_PUBLIC_PHOENIX_REAL_API_ENABLED=true`) — all four returned `ok:
false` with message *"Real API mode is not enabled in Platform Alpha. Mock
mode remains the active runtime."*, confirming the facade's `export *` +
local-override pattern resolves correctly under Next.js's actual webpack
build (not just under Node/tsx — the two module systems can differ on this
kind of re-export, so both were checked).

This also confirms `GovernanceActionButton` / `ActionConfirmDialog` need no
changes — they only ever see a `PhoenixActionResult`, produced either
directly by `mock-api-client.ts` or via `apiResponseToActionResult()`.

## 4. Route Checks (Task 10)

All 8 required routes returned `200` against the production build, checked
in both mock-mode and real-mode configurations:

```
/dashboard                          200
/assessments                        200
/assessments/ast-001-assessment     200
/passports                          200
/certifications                     200
/reports                            200
/settings                           200
/login                              200
```

## 5. No-Network-Call Verification (Task 13)

- `real-api-client.ts` contains no `fetch()` call. `phoenixFetch()`'s only
  behavior is to short-circuit to `disabledRealApiCall()` — confirmed by
  reading the file and by the governance-action QA in §3 returning
  instantly with the disabled message rather than timing out or erroring.
- `grep -rn "fetch(" apps/platform/src/lib` (excluding the word
  "phoenixFetch" itself, which never calls the global `fetch`) returns no
  matches to a real network call.
- The sandboxed build environment's network egress allowlist does not
  include any Phoenix backend domain — a real `fetch()` call, had one
  existed, would have failed outright rather than silently succeeding,
  which is a second independent confirmation none was attempted.

## 6. No Backend / Database / Auth Check (Task 13)

- No new dependency was added to any `package.json` (`pnpm install` after
  these changes reused the existing lockfile — "Lockfile is up to date").
- No `NextAuth`, `Auth0`, `Clerk`, `Supabase`, or `Firebase` import exists
  anywhere in `apps/platform/src`.
- No database client, connection string, or ORM was introduced.
- `mock-session.ts` (PHX-PLATFORM-006/008's mock auth/session provider) was
  not modified.

## 7. No Scoring / Threshold / Standard Changes (Task 13)

- `packages/pbrs/src` and `packages/core/src/contracts` were not modified.
- `PBRS_DIMENSIONS` (six dimensions, same weights) is untouched — the
  Settings page still renders it live, unchanged from PHX-PLATFORM-005/008.
- `certification-levels.ts` (Certification Level / Internal Tier
  thresholds) was not modified — `api-client.ts` still re-exports its
  helpers unchanged.
- `/docs/standards/PBRS_STANDARD_V1_2_RELEASE_CANDIDATE.md` was read for
  reference only, not edited.

## 8. Sample-Data Import Boundary Check (Task 13)

```
$ grep -rn "from '\./sample-data'" apps/platform/src --include="*.ts" --include="*.tsx"
src/lib/api-adapters.ts:64:} from './sample-data';
src/lib/mock-api-client.ts:85:import { SAMPLE_ASSETS, SAMPLE_REPORTS } from './sample-data';
src/lib/mock-api-client.ts:150:export type { PhoenixAsset, PhoenixPassport, PhoenixReport, AssetStatus } from './sample-data';
```

Exactly two files import `sample-data.ts`: `api-adapters.ts` and
`mock-api-client.ts`. `api-client.ts` (the public facade every
page/component imports) does **not** import it — a stricter version of the
prior PHX-PLATFORM-003 rule, since the facade is now fully decoupled from
sample data at the type level too.

## 9. PHX-008 Hydration Non-Regression (Task 13)

- `SessionProvider.tsx`, `mock-session.ts`, `RoleGate.tsx`, and
  `GovernanceActionButton.tsx`'s `isLoading` gating logic were not touched.
- `GovernanceActionButton.tsx` still calls `onRun(reason)` and only
  branches on the returned `PhoenixActionResult` — it has no knowledge of
  `api-config.ts` or mode resolution, so PHX-008's hydration-safe rendering
  path is unaffected by this sprint.
- All 8 routes rendered successfully on first load in the production build
  (§4), consistent with hydration remaining stable.

## 10. Known Limitations

- Read-path functions are not mode-aware this sprint (documented
  intentionally — see implementation report §14 and the mapping doc's
  "Mock (always mock)" rows).
- `phoenixFetch()` has no real implementation; it is a shape-only skeleton.
- Contact sheets were generated via a custom Playwright + sharp script
  (Chromium revision 1194, matching the environment's pre-cached browser)
  rather than a project-standard tool, since no packaged screenshot script
  exists in this Alpha's repo. Images are included as
  `platform009-*-contact-sheet.jpg`.
