# Phoenix Platform — Release Notes

## PHX-PLATFORM-009 — Backend Integration Readiness Layer

**Release label:** PHX-PLATFORM-009-BACKEND-INTEGRATION-READINESS-LAYER
**Built from:** PHX-PLATFORM-008-SESSION-HYDRATION-STABILIZATION.tar

### What changed

- Introduced a formal API runtime mode boundary (`mock` |
  `real-disabled`), resolved from `NEXT_PUBLIC_PHOENIX_API_MODE` /
  `NEXT_PUBLIC_PHOENIX_REAL_API_ENABLED`, always defaulting to `mock`.
- Added generic, backend-ready client types: `PhoenixApiError`,
  `PhoenixApiResponse<T>`, `PhoenixApiRequestOptions`,
  `PhoenixApiClientError`.
- Added a disabled real API client (`real-api-client.ts`) — always returns
  a clear "not enabled" result, never calls `fetch()`.
- Split the mock API layer into an implementation file
  (`mock-api-client.ts`) and a public facade (`api-client.ts`). The facade
  routes `issuePassport`, `revokePassport`, `grantCertification`, and
  `revokeCertification` through the mode boundary; every other function is
  re-exported unchanged.
- Added `async-state.ts` — a small `AsyncState<T>` loading/error shape for
  future client-side data fetching.
- Added a subtle, internal-only "Runtime Mode" indicator to `/settings`.
- Added a full API contract mapping document connecting every current mock
  function to its future backend endpoint.

### What was preserved

- Mock mode remains the default and only fully-supported runtime — no
  behavior change for any existing user of the platform.
- All existing pages, routes, role gating, and PHX-PLATFORM-008 session
  hydration behavior are unchanged.
- PHX-PLATFORM-007 governance action UI (`GovernanceActionButton`,
  `ActionConfirmDialog`) required no code changes.
- PBRS scoring logic, the six PBRS dimensions, Certification Level
  thresholds, Internal Tier thresholds, and the PBRS Standard are all
  unchanged.
- The `sample-data.ts` import boundary is preserved (and slightly
  tightened — see the implementation report).
- No backend, database, or authentication provider was connected. No
  network call is made anywhere in this sprint's code.

### Alpha limitations

- Only the four governance actions are mode-aware; all read functions
  (dashboard, assessments, passports, certifications, reports,
  activity/audit, settings) still always run the mock implementation
  regardless of resolved mode.
- `real-api-client.ts`'s `phoenixFetch()` is a shape-only skeleton with no
  real network implementation.
- `realApiEnabled` is hard-coded `false` — no environment configuration in
  this Alpha can turn on a real network call.
- Settings changes remain preview-only and are not persisted, as in prior
  sprints.

### Next recommended sprint

Implement `phoenixFetch()` against a real backend base URL once one
exists, then extend the facade's mode-aware pattern (already proven on the
governance actions) to the read functions listed in
`PHX_PLATFORM_009_API_CONTRACT_MAPPING.md`, starting with `getAssessments`
and `getDashboardSummary` as the highest-traffic reads.
