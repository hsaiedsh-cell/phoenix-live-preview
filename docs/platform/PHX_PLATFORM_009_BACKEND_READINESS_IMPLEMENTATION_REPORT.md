# Phoenix Platform — Backend Integration Readiness Implementation Report

**Task ID:** PHX-PLATFORM-009
**Task Name:** Backend Integration Readiness Layer
**Source:** PHX-PLATFORM-008-SESSION-HYDRATION-STABILIZATION.tar
**Status:** Complete — mock mode remains the only active runtime; real API calls remain disabled.

---

## 1. Summary

PHX-PLATFORM-009 introduces a formal API mode boundary ahead of a future real
backend integration, without connecting a real backend, database, or
authentication provider. Phoenix Platform Alpha now has:

- A resolved runtime mode (`mock` | `real-disabled`) read from
  `NEXT_PUBLIC_*` env vars, always defaulting to `mock`.
- A generic client-side request/response/error contract
  (`PhoenixApiResponse<T>`, `PhoenixApiError`) shared by the mock and future
  real clients.
- A disabled real API client (`real-api-client.ts`) that always returns a
  clear "not enabled" result and never calls `fetch()`.
- A clean split between the mock **implementation**
  (`mock-api-client.ts`) and the public **facade** (`api-client.ts`) that
  pages/components import, with the facade routing the four governance
  actions through the mode boundary.
- A loading/error state utility (`async-state.ts`) for future client-driven
  data fetching.
- A subtle, internal-only API mode indicator on `/settings`.
- A full API contract mapping document
  (`PHX_PLATFORM_009_API_CONTRACT_MAPPING.md`) connecting every current mock
  function to its future `API_CONTRACT_PHX_PLATFORM_002.md` endpoint.

No PBRS scoring logic, dimensions, Certification Level thresholds, Internal
Tier thresholds, or the PBRS Standard were touched. No backend, database, or
auth provider was connected. No network call is made anywhere in this
sprint's code paths.

---

## 2. Files Added

| File | Purpose |
|---|---|
| `apps/platform/src/lib/api-config.ts` | Resolves `PhoenixApiMode` from env vars; always fails safe to `mock` or `real-disabled`. |
| `apps/platform/src/lib/api-types.ts` | `PhoenixApiError`, `PhoenixApiResponse<T>`, `PhoenixApiRequestOptions`, `PhoenixApiClientError`. |
| `apps/platform/src/lib/real-api-client.ts` | Disabled real API client — `createDisabledRealApiError`, `disabledRealApiCall`, and a `phoenixFetch` skeleton that never reaches a real `fetch()` call this sprint. |
| `apps/platform/src/lib/mock-api-client.ts` | The former `api-client.ts` content, unchanged in behavior, now the mock **implementation** file. Still the only file besides `api-adapters.ts` permitted to import `sample-data.ts`. |
| `apps/platform/src/lib/async-state.ts` | `AsyncState<T>` shape plus `createIdleState` / `createLoadingState` / `createSuccessState` / `createErrorState` constructors and status-check helpers. |

## 3. Files Modified

| File | Change |
|---|---|
| `apps/platform/src/lib/api-client.ts` | Rewritten as a public facade. No longer imports `sample-data.ts`. Re-exports everything from `mock-api-client.ts` via `export *`, then locally re-declares `issuePassport`, `revokePassport`, `grantCertification`, `revokeCertification` to route through `getPhoenixApiConfig()`. Adds `apiResponseToActionResult()` adapter. |
| `apps/platform/src/app/(platform)/settings/page.tsx` | Imports `getPhoenixApiConfig` / `describePhoenixApiMode`; renders a single-line, low-contrast "Runtime Mode" indicator between the settings panel grid and the Audit Preview panel. |
| `.env.example` | Documents `NEXT_PUBLIC_PHOENIX_API_MODE`, `NEXT_PUBLIC_PHOENIX_API_BASE_URL`, `NEXT_PUBLIC_PHOENIX_REAL_API_ENABLED` as placeholder-only, non-secret config. |

No other application files were changed. `apps/website` and
`apps/dashboard` were not touched.

---

## 4. API Mode Configuration (Task 1)

`api-config.ts` exports `PhoenixApiMode = 'mock' | 'real-disabled'` and
`getPhoenixApiConfig(): PhoenixApiConfig`.

Resolution rules (`resolveApiMode()`):

- `NEXT_PUBLIC_PHOENIX_API_MODE` unset, `"mock"`, or any unrecognized value
  → `'mock'`.
- `NEXT_PUBLIC_PHOENIX_API_MODE=real` → `'real-disabled'`, **regardless** of
  `NEXT_PUBLIC_PHOENIX_REAL_API_ENABLED`. The enabled flag is read (for
  forward-compatibility / QA visibility) but `PhoenixApiConfig.realApiEnabled`
  is hard-coded `false` in this Alpha — see the file's header comment for the
  reasoning. This means there is no environment configuration that turns on
  a real network call this sprint.

`baseUrl` is only surfaced when mode isn't `'mock'`, so the Settings
indicator and any future consumer never treats an empty string as if it
were a real backend URL.

## 5. API Error / Response Types (Task 2)

`api-types.ts` defines `PhoenixApiError`, `PhoenixApiResponse<T>`,
`PhoenixApiRequestOptions`, and `PhoenixApiClientError` exactly as specified.
`PhoenixApiResponse<T>` is documented as distinct from `@phoenix/core`'s
`ApiResult<T>` — one is the future backend's success envelope, the other is
this Alpha's uniform client-side envelope (success or failure, tagged with
`mode`). Does not import `sample-data.ts`.

## 6. Disabled Real API Client (Task 3)

`real-api-client.ts` exports `createDisabledRealApiError(endpoint)` (sync,
always returns `{ ok: false, error: { code: 'REAL_API_DISABLED', ... },
mode: 'real-disabled' }`), `disabledRealApiCall(endpoint, options)` (the
async form actually used by the facade), and a `phoenixFetch()` skeleton
that short-circuits to the disabled response before any `fetch()` call
could be made — the guard is written so a partial edit to the condition
alone cannot introduce an accidental network call, since the "then" branch
below it is also `disabledRealApiCall(...)`, not a real fetch. **No
`fetch()` call exists in this file.**

## 7. Mock / Real Client Boundary (Task 4)

Followed the task's documented risk-control fallback in a slightly fuller
form than the minimal option: rather than leaving `api-client.ts` fully
as-is, its content was moved verbatim (behavior-identical) into
`mock-api-client.ts`, and `api-client.ts` was rewritten as a thin facade.
This was judged low-risk because:

- `mock-api-client.ts` keeps the same exported function names/signatures —
  no call site elsewhere needed to change.
- `api-client.ts` re-exports everything via `export * from
  './mock-api-client'`, then locally re-declares only the four governance
  actions. ES module semantics (confirmed against this repo's actual
  Next.js/webpack build, not just a Node script — see §9) resolve a local
  named export in favor of the same name from a star re-export, so the
  wrapped versions are what every caller gets.
- The `sample-data.ts` import boundary is preserved in spirit: it is now
  `mock-api-client.ts` and `api-adapters.ts` (previously `api-client.ts`
  and `api-adapters.ts`) that are the only two files permitted to import
  it. `api-client.ts` itself no longer imports `sample-data.ts` at all,
  which is a **stronger** version of the original constraint.

No import in any page or component changed — every existing `from
'@/lib/api-client'` import continues to resolve the same function names.

## 8. Backend-Ready Governance Actions (Task 5)

`issuePassport`, `revokePassport`, `grantCertification`,
`revokeCertification` in `api-client.ts` now:

1. Call `getPhoenixApiConfig()`.
2. If `mode === 'mock'`, delegate to the corresponding
   `mock-api-client.ts` function — byte-for-byte the PHX-PLATFORM-007
   behavior.
3. Otherwise (`'real-disabled'`), call `disabledRealApiCall(endpoint)` and
   adapt the result via the new `apiResponseToActionResult()` helper into a
   `PhoenixActionResult`, so `GovernanceActionButton` /
   `ActionConfirmDialog` — which only know about `PhoenixActionResult` —
   need no changes.

`apiResponseToActionResult<T>(response: PhoenixApiResponse<T>):
PhoenixActionResult` lives in `api-client.ts` next to the four actions it
serves.

## 9. Loading/Error State Helpers (Task 6)

`async-state.ts` implements `AsyncStatus`, `AsyncState<T>`, and the four
constructors exactly as specified, plus small `isIdle`/`isLoading`/
`isSuccess`/`isError` predicates. Not wired into any existing page — this
sprint intentionally scopes it as a ready-to-use utility for a future
client-side data fetch, per the task's explicit "do not refactor every
page" instruction.

## 10. API Mode Indicator (Task 7)

Added to `/settings`, directly above the existing "Audit Preview" panel: a
single low-contrast line —

```
● Runtime Mode: Mock API Active
```

— using a small dot (gray in mock mode, amber in real-disabled mode) and
`text-xs text-gray-400` styling so it reads as an internal/QA affordance,
not a product feature. In `real-disabled` mode the line reads "Runtime
Mode: Real API Disabled — using mock runtime". No backend URL is ever
rendered (see `api-config.ts §4` — `baseUrl` stays `null` in mock mode).

## 11. API Contract Mapping (Task 8)

See `PHX_PLATFORM_009_API_CONTRACT_MAPPING.md` — covers every function
requested (dashboard, assessments, passports, certifications, reports,
activity/audit) plus the workspace/user/evidence/score functions already
present in the mock layer, each mapped to its
`API_CONTRACT_PHX_PLATFORM_002.md` endpoint, current status, and
integration notes.

## 12. API Mode QA (Task 9)

See `PHX_PLATFORM_009_QA_REPORT.md` for the full results. Summary: default
env resolves to `mock`; `NEXT_PUBLIC_PHOENIX_API_MODE=real` (with or
without the enabled flag) resolves to `real-disabled` and the four
governance actions return the disabled result instead of mutating
anything; no other function's behavior changes; verified against an actual
`next build` + `next start` run in both configurations, not just
unit-level logic.

## 13. Preserved UX (Task 10)

All eight required routes (`/dashboard`, `/assessments`,
`/assessments/[assessmentId]`, `/passports`, `/certifications`, `/reports`,
`/settings`, `/login`) return `200` against the production build in both
mock and real-disabled configurations. No component was redesigned. Role
gating and PHX-PLATFORM-008 hydration behavior were not touched by any
change in this sprint (no edits to `SessionProvider.tsx`, `mock-session.ts`,
`RoleGate.tsx`, or `GovernanceActionButton.tsx`'s hydration handling).

## 14. Limitations

- Only the four governance actions are mode-aware. Every read function
  (dashboard, assessments, passports, certifications, reports,
  activity/audit, settings) still always executes the mock implementation
  regardless of resolved mode — this is a deliberate scope decision (see
  `api-client.ts`'s header and §7 above), not an oversight. A future sprint
  extending real reads should wire each function individually using the
  same `getPhoenixApiConfig()` + `disabledRealApiCall()` pattern already
  proven on the governance actions.
- `phoenixFetch()` in `real-api-client.ts` is a documented skeleton only —
  it has no `fetch()` implementation. A future sprint will need to add one
  once a real backend URL and auth mechanism exist.
- `realApiEnabled` is hard-coded `false` in `api-config.ts` on purpose.
  Removing that hard-code is itself a deliberate, separate future decision
  — not something this sprint's env vars can flip on by themselves.

## 15. Future Backend Integration Path

1. Implement `phoenixFetch()`'s body in `real-api-client.ts` against a real
   base URL (from `PhoenixApiConfig.baseUrl`), matching the
   `PhoenixApiRequestOptions` → `PhoenixApiResponse<T>` shape already
   defined.
2. Flip `realApiEnabled` in `api-config.ts` to actually reflect the env
   flag once a backend exists to call.
3. Extend `api-client.ts`'s facade pattern (already proven for the four
   governance actions) to the read functions listed in
   `PHX_PLATFORM_009_API_CONTRACT_MAPPING.md`, one at a time.
4. Wire `async-state.ts` into any page that moves from a Server Component
   `await` to a client-side fetch as part of that migration.
5. Only at that point does session/role enforcement described in
   `PERMISSIONS_MODEL_PHX_PLATFORM_002.md` become a real security boundary
   — see the standing note in `mock-api-client.ts`'s header that UI-only
   gating is not a substitute for server-side enforcement.
