# QA Report — PHX-PASSPORTS-001 — Live Passport Endpoint Foundation

**Scope of this QA pass:** local source verification only (`pnpm install` /
`type-check` / `lint` / `build`, plus static code review). This environment has no
network access to the operator's live Vercel deployment, live Supabase database, or
GitHub repo, and no Clerk credentials — so **no request was made against the live
site, and no row was read from the real database.** Every result below marked
"Verified (static)" is a code-level check; every result marked "Not tested (requires
live deployment)" is explicitly a gap for the operator/ChatGPT reviewer to close
after deploying.

## Source-level verification

| Area | Result |
|---|---|
| `pnpm install --frozen-lockfile` | PASS — no lockfile drift |
| `pnpm --filter @phoenix/platform type-check` | PASS — zero errors |
| `pnpm --filter @phoenix/platform lint` | PASS — zero warnings/errors |
| `pnpm --filter @phoenix/platform build` | PASS — `/passports` builds as a dynamic (`ƒ`) route |
| Full-repo diff scoped to exactly 5 files | Verified (static) — `diff -rq` confirms no other file changed |

## Per-route status

| Route | Result |
|---|---|
| `/dashboard` | Verified (static) — file untouched by this sprint; confirmed via diff. Not re-tested live. |
| `/assessments` | Verified (static) — file untouched by this sprint; confirmed via diff. Not re-tested live. |
| `/assessments/[id]` | Verified (static) — file untouched by this sprint; confirmed via diff. Not re-tested live. |
| `/settings` | Verified (static) — file untouched by this sprint; confirmed via diff (the settings *page* file was untouched; `platform-data-source.ts`'s `loadSettingsActivityAuditData` export was re-verified present and unchanged after an editing mistake was caught and corrected mid-sprint — see note below). Not re-tested live. |
| `/passports` (mock / real-dev / real-disabled / production-auth) | Verified (static) — code path is unchanged from before this sprint (same `getPassports()` call, same JSX). `next build`'s successful static generation of every other prerendered route is consistent with no regression, but this was not exercised with a live request in any of these modes. |
| `/passports` (vercel-supabase-preview, live) | **Not tested against a live database.** Verified (static): the SQL is syntactically valid per the schema in `0001_initial_schema.sql`, the auth/permission preflight mirrors the sibling `previewGet*` functions exactly, and `tsc`/`next build` both pass. Not verified: an actual signed-in Clerk session resolving to a real `pbrs_passports` row, including the one seed row the task brief mentions. |
| `/certifications` | Verified (static) — file not touched by this sprint; still fully mock-backed, as before. |
| `/reports` | Verified (static) — file not touched by this sprint; still fully mock-backed, as before. |

## Editing-process note (disclosed for transparency)

During implementation, a `str_replace` edit to `platform-data-source.ts` briefly and
accidentally deleted the body of the pre-existing `loadSettingsActivityAuditData()`
function while adding the new `loadPassportsListData()` function. This was caught
immediately (before type-check/build were run) by re-viewing the file, and the
deleted function body was restored verbatim. The final `pnpm --filter @phoenix/platform
type-check` and `build` passes above were run *after* this correction, and a
follow-up `grep` confirmed all five `load*Data` exports (`loadDashboardData`,
`loadAssessmentsListData`, `loadAssessmentDetailData`, `loadSettingsActivityAuditData`,
`loadPassportsListData`) are present in the final file. Disclosed here rather than
omitted, per this project's transparent-documentation-of-deviations standard.

## Empty/error states

| State | Result |
|---|---|
| Empty passport list (live, zero rows) | Verified (static) — `result.data.items.length === 0` renders `EmptyState` with passport-specific copy. Not exercised against a real empty workspace. |
| Backend/Supabase unavailable | Verified (static) — `previewGetPassports` throws through the same `errorToLiveResult()` mapping as every sibling function; `renderDataStatePanel` renders `BackendUnavailablePanel`. Not exercised against an actual dropped connection. |
| No matching Clerk identity / no Phoenix user linked | Verified (static) — `resolvePreviewUserOrThrow()` throws `RealApiError(401, 'AUTH_REQUIRED', ...)` with the same message every sibling function uses; maps to `AuthRequiredPanel`. Not exercised with a real unlinked Clerk account. |
| Unauthorized user (wrong workspace / insufficient role) | Verified (static) — `requirePreviewPermission` throws `PERMISSION_DENIED` (403) exactly like every sibling function; maps to `PermissionDeniedPanel`. Not exercised with a real low-privilege account. |
| Workspace not found | Verified (static) — `workspaceExists()` 404s before any permission check, matching `previewGetAssessments`'s ordering. Not exercised live. |
| Query failure without leaking connection details | Verified (static) — `previewGetPassports` throws the same typed `RealApiError`/`RealApiConfigError` classes as every sibling function; none of them include the raw SQL or `PHOENIX_DATABASE_URL` value in any thrown message. Not exercised against an actual malformed query. |

## Vercel deployment verification

**Not performed.** No deployment was made from this environment — see
`BUILD_REPORT_PHX_PASSPORTS_001.md` §3. The operator must apply
`PHX-PASSPORTS-001.patch` (or copy `updated-files/`), commit, and push to trigger
Vercel's automatic redeploy, then re-run this route matrix against the live URL.

## Overall

**Local source QA: PASS.** **Live-environment QA: not performed, and required before
this sprint can be considered verified end-to-end.** This report intentionally does
not claim a live pass it cannot support with evidence.

Status: **PHX-PASSPORTS-001 — Ready for ChatGPT QA Review.** Not self-approved — a
live pass against the real deployment and database is still needed from the operator
or a reviewer with that access.
