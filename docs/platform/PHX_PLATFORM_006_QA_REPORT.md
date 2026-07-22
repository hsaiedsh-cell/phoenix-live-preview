# Phoenix Platform — PHX-PLATFORM-006 QA Report

**Task ID:** PHX-PLATFORM-006
**Title:** Authentication & Workspace Access Foundation

---

## 1. Build Status

| Step | Result |
|---|---|
| `pnpm install` | ✅ Pass — 378 packages, workspace resolved from lockfile |
| `pnpm --filter @phoenix/platform type-check` | ✅ Pass — 0 errors |
| `pnpm --filter @phoenix/platform lint` | ✅ Pass — "No ESLint warnings or errors" |
| `pnpm --filter @phoenix/platform build` | ✅ Pass — 12/12 static pages generated after fixing an `onSubmit` handler issue on `/login` (see §5) |
| `pnpm --filter=./apps/* type-check` (all 3 apps) | ✅ Pass |
| `pnpm --filter=./apps/* lint` (all 3 apps) | ✅ Pass |
| `pnpm --filter @phoenix/website build` | ✅ Pass — 13/13 static pages |
| `pnpm --filter @phoenix/dashboard build` | ✅ Pass — 4/4 static pages |

Full monorepo `pnpm --filter=./apps/* build` in one command exceeded the
tool's execution time limit in this environment; each app was built
individually instead (same underlying `next build` command per app, run to
completion). See `BUILD_REPORT_PHX_PLATFORM_006.md` for command transcripts.

---

## 2. Route Checks

All 7 in-scope platform routes render without errors at a production
(`next start`) build:

- `/login`
- `/dashboard`
- `/assessments`
- `/assessments/[assessmentId]` (tested with `ast-001-assessment`)
- `/passports`
- `/certifications`
- `/settings`

`apps/website` (13 routes) and `apps/dashboard` (1 route) were rebuilt and
confirmed unaffected.

---

## 3. Role-Switch Checks

Verified with an automated Playwright script (`role-qa.js`) driving a
production `next start` server, setting `localStorage['phx.mockSession.activeRole']`
before navigating (mirrors what `AlphaRoleSwitcher` does at runtime), then
checking rendered DOM state per role. Raw output is included below.

```json
[
  { "role": "Owner",       "dashboardVisible": true, "newAssessmentButtonVisible": true,  "newAssessmentRestrictedNote": false, "auditTrailVisibleOnDetail": true,  "auditTrailRestrictedOnDetail": false, "auditPreviewVisibleOnSettings": true,  "auditPreviewRestrictedOnSettings": false, "workspaceManagementNoteShown": false },
  { "role": "Admin",       "dashboardVisible": true, "newAssessmentButtonVisible": true,  "newAssessmentRestrictedNote": false, "auditTrailVisibleOnDetail": true,  "auditTrailRestrictedOnDetail": false, "auditPreviewVisibleOnSettings": true,  "auditPreviewRestrictedOnSettings": false, "workspaceManagementNoteShown": false },
  { "role": "Reviewer",    "dashboardVisible": true, "newAssessmentButtonVisible": false, "newAssessmentRestrictedNote": true,  "auditTrailVisibleOnDetail": false, "auditTrailRestrictedOnDetail": true,  "auditPreviewVisibleOnSettings": false, "auditPreviewRestrictedOnSettings": true,  "workspaceManagementNoteShown": true },
  { "role": "Contributor", "dashboardVisible": true, "newAssessmentButtonVisible": true,  "newAssessmentRestrictedNote": false, "auditTrailVisibleOnDetail": false, "auditTrailRestrictedOnDetail": true,  "auditPreviewVisibleOnSettings": false, "auditPreviewRestrictedOnSettings": true,  "workspaceManagementNoteShown": true },
  { "role": "Viewer",      "dashboardVisible": true, "newAssessmentButtonVisible": false, "newAssessmentRestrictedNote": true,  "auditTrailVisibleOnDetail": false, "auditTrailRestrictedOnDetail": true,  "auditPreviewVisibleOnSettings": false, "auditPreviewRestrictedOnSettings": true,  "workspaceManagementNoteShown": true },
  { "role": "Auditor",     "dashboardVisible": true, "newAssessmentButtonVisible": false, "newAssessmentRestrictedNote": true,  "auditTrailVisibleOnDetail": true,  "auditTrailRestrictedOnDetail": false, "auditPreviewVisibleOnSettings": true,  "auditPreviewRestrictedOnSettings": false, "workspaceManagementNoteShown": true }
]
```

All six roles behaved exactly as specified in
`PHX_PLATFORM_006_ACCESS_CONTROL_MATRIX.md` — see §4 below for the
role-by-role PASS/FAIL matrix required by Task 13.

---

## 4. Role QA Matrix (Task 13)

| Check | Owner | Admin | Reviewer | Contributor | Viewer | Auditor |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| Dashboard visibility | PASS | PASS | PASS | PASS | PASS | PASS |
| "New Assessment" create action visible | PASS (visible) | PASS (visible) | PASS (hidden, note shown) | PASS (visible) | PASS (hidden, note shown) | PASS (hidden, note shown) |
| Assessment detail — review/action area (Audit Trail Preview) | PASS (visible) | PASS (visible) | PASS (hidden, note shown) | PASS (hidden, note shown) | PASS (hidden, note shown) | PASS (visible) |
| Passport action visibility | N/A — no issue/revoke UI exists yet in Alpha (see Implementation Report §9) | N/A | N/A | N/A | N/A | N/A |
| Certification action visibility | N/A — no grant/revoke UI exists yet in Alpha | N/A | N/A | N/A | N/A | N/A |
| Settings visibility | PASS (full) | PASS (full) | PASS (read-only note shown) | PASS (read-only note shown) | PASS (read-only note shown) | PASS (read-only note shown) |
| Audit trail visibility (Settings → Audit Preview) | PASS (visible) | PASS (visible) | PASS (hidden, note shown) | PASS (hidden, note shown) | PASS (hidden, note shown) | PASS (visible) |

All checked rows: **PASS**. Passport/Certification rows are marked N/A
because no create/issue/revoke/grant control exists anywhere in the current
Alpha UI to gate — see Implementation Report §9 for the explicit reasoning
and the ready-to-use `RoleGate` permissions for when those controls are
built.

---

## 5. Issues Found & Fixed

| Issue | Where | Fix |
|---|---|---|
| `next build` failed with "Event handlers cannot be passed to Client Component props" for `onSubmit` | `apps/platform/src/app/login/page.tsx` | Removed the `onSubmit={(e) => e.preventDefault()}` handler from the server-rendered `<form>` (the page is a server component; the form has no real submit target in this Alpha, so no handler is needed). Verified fixed by rebuilding — 12/12 static pages generated. |

No other build, type, or lint issues were found.

---

## 6. Compliance Confirmations

- ✅ No real auth dependency added (no OAuth/Auth0/Clerk/Supabase/Firebase/NextAuth packages in `package.json`).
- ✅ No backend connected — `mock-session.ts` and `api-client.ts` remain fully local/mock.
- ✅ No database connected.
- ✅ No tokens, cookies, or fake production security added — `localStorage` stores only a role string for QA convenience, guarded behind browser checks.
- ✅ No PBRS scoring logic changes — `certification-levels.ts` and `packages/core/src/contracts/pbrs-score.ts` are byte-identical to the PHX-CERT-003 source (verified via `diff`).
- ✅ No PBRS dimension changes — `PBRS_DIMENSIONS` untouched.
- ✅ No certification threshold changes.
- ✅ No PBRS Standard changes.
- ✅ Sample-data import discipline preserved — no new file outside `api-client.ts`/`api-adapters.ts` imports `sample-data.ts` (verified via `grep`; pre-existing references in `mock-ids.ts`, `view-models.ts`, `certification-levels.ts`, and `mock-fixtures/evidence.ts` predate this sprint and were not modified).
- ✅ `pnpm type-check` passes (all 3 apps).
- ✅ `pnpm lint` passes (all 3 apps).
- ✅ `pnpm build` passes (all 3 apps, built individually due to a tooling time limit on the combined command — see §1).

---

## 7. Known Limitations

See Implementation Report §12 for the full list. Summary: this is UI gating
only (not a real security boundary), role-only (not ownership-aware), and
scoped to `apps/platform` — `apps/website` and `apps/dashboard` were left
untouched, as required.
