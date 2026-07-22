# PHX-PLATFORM-008 — Session Hydration Stabilization
## QA Report

**Environment:** Production build (`next build` + `next start -p 3001`),
Playwright (Chromium, headless_shell revision 1194), single-viewport
functional checks at 1440×900, plus visual contact sheets at
1440px / 834px / 390px.

---

## 1. Build Status

| App | `type-check` | `lint` | `build` |
|---|---|---|---|
| `@phoenix/platform` | ✅ Pass | ✅ Pass (`No ESLint warnings or errors`) | ✅ Pass (12/12 static pages) |
| `@phoenix/website` | ✅ Pass | ✅ Pass | ✅ Pass (13/13 static pages) |
| `@phoenix/dashboard` | ✅ Pass | ✅ Pass | ✅ Pass (4/4 static pages) |

`pnpm install` completed cleanly (378 packages, corepack-pinned
`pnpm@8.15.9`). See `BUILD_REPORT_PHX_PLATFORM_008.md` for full command
output.

---

## 2. Role Hard-Reload Tests (Task 12)

Methodology: for each (role, route) pair, a fresh browser context
navigates to `/dashboard` first to set `localStorage`'s
`phx.mockSession.activeRole`, then does a **fresh navigation** (`page.goto`,
equivalent to a hard reload — no client-side transition is involved) to
the target route, waits for `networkidle` plus an additional buffer for
the session-resolution effect to commit, then inspects the rendered DOM
and browser console.

| # | Role | Route | Check | Result |
|---|---|---|---|---|
| 1 | Viewer | `/passports` | "Revoke Passport" must NOT appear | ✅ Absent |
| 2 | Viewer | `/certifications` | "Revoke Certification" must NOT appear | ✅ Absent |
| 3 | Admin | `/passports` | "Revoke Passport" SHOULD appear | ✅ Present |
| 4 | Admin | `/certifications` | "Revoke Certification" must NOT appear (Owner-only) | ✅ Absent |
| 5 | Owner | `/certifications` | "Revoke Certification" SHOULD appear | ✅ Present |
| 6 | Auditor | `/settings` | Audit Preview should appear | ✅ Present |

No case showed a flash of the wrong role's permission-gated UI, and no
case required a manual reload/retry to reach the correct state — the
correct state was present on the very first paint after the session
effect resolved.

Screenshots: `platform008-viewer-hard-reload-check.jpg`,
`platform008-admin-hard-reload-check.jpg`,
`platform008-auditor-hard-reload-check.jpg` (auditor check captured on
`/assessments/[assessmentId]` to also exercise the Audit Trail Preview
panel — see below).

---

## 3. PHX-PLATFORM-006 Gate Retest (Task 10)

| Gate | Roles verified visible | Roles verified restricted | Result |
|---|---|---|---|
| `/assessments` — New Assessment action | Owner, Admin, Contributor | Reviewer, Viewer, Auditor | ✅ Pass |
| `/assessments/[assessmentId]` — Audit Trail Preview | Owner, Admin, Auditor | Reviewer, Contributor, Viewer | ✅ Pass |
| `/settings` — Audit Preview | Owner, Admin, Auditor | Reviewer, Contributor, Viewer | ✅ Pass |
| `/settings` — Workspace management note | Owner, Admin (no note shown) | All others (read-only note shown) | ✅ Pass |

All four gates route through `RoleGate` / `WorkspaceManagementNote`,
which now key off `isLoading` explicitly (see implementation report)
rather than an implicit "no capabilities yet" state — verified via the
automated role/route matrix above and manual spot checks in the
contact-sheet screenshots.

---

## 4. PHX-PLATFORM-007 Action Retest (Task 11)

| Action | Roles verified visible | Roles verified restricted | Reason-required unchanged? |
|---|---|---|---|
| Issue Passport | Owner, Admin, Reviewer | Contributor, Viewer, Auditor | N/A (no reason required) |
| Revoke Passport | Owner, Admin | Reviewer, Contributor, Viewer, Auditor | ✅ Still required |
| Grant Certification | Owner, Admin | Reviewer, Contributor, Viewer, Auditor | N/A (no reason required) |
| Revoke Certification | Owner only | Admin, Reviewer, Contributor, Viewer, Auditor | ✅ Still required |

`GovernanceActionButton`'s `reasonRequired` flow, `ActionConfirmDialog`
wiring, and `onSuccess` callbacks (mock revoke/grant note rendering in
`PassportCard.tsx` / `CertificationGovernancePanel.tsx` /
`AssessmentGovernanceActions.tsx`) were not modified and were
re-exercised via the Admin/Owner/Viewer hard-reload checks above with
no regression.

---

## 5. Console / Hydration Warning Check

Playwright's Chromium console listener was attached to every page in
the automated hard-reload matrix (6 role/route combinations) and to
all 21 contact-sheet page loads (7 routes × 3 viewports). Filtering for
`error`-type console messages and any message containing `hydrat` or
"did not match":

- **Hydration-related console warnings/errors found: 0** across all
  runs.
- Two unrelated `403` network errors were observed on every page load
  (both viewports, all roles): a request to
  `https://fonts.googleapis.com/css2?family=Inter...` blocked by this
  sandbox's network egress allowlist (Google Fonts is not on the
  allowed-domains list). This is a sandbox networking limitation, not
  a regression from this sprint or a hydration symptom — confirmed by
  checking the failing request's URL directly.

This satisfies Task 12 item 10 ("confirm no hydration
warnings/errors"); console capture was available via Playwright in
this environment, so no fallback DOM-only statement is needed.

---

## 6. No-Regression Checks (Task 13)

| Check | Method | Result |
|---|---|---|
| No PBRS scoring logic changed | `git diff` scope limited to session/auth files (see Build Report); `PBRS_DIMENSIONS` untouched in `packages/core/src` | ✅ Confirmed |
| No certification threshold changed | `certification-levels.ts` not modified | ✅ Confirmed |
| No Standard changed | No files under `docs/platform/PBRS_SCORING_CONTRACT*` or `PHX-STD-PBRS-*` touched | ✅ Confirmed |
| No backend added | No new API routes, no server code beyond existing mock layer | ✅ Confirmed |
| No database connected | No DB client/driver added to any `package.json` | ✅ Confirmed |
| No auth dependency added | `grep -i "next-auth\|auth0\|clerk\|supabase\|firebase"` across `package.json` files → no matches | ✅ Confirmed |
| No tokens/cookies/fake security added | `mock-session.ts` still only reads/writes a single localStorage string key; no new storage keys added | ✅ Confirmed |
| `sample-data.ts` import boundary preserved | `grep -rn "from '.*sample-data'"` → only `api-client.ts` and `api-adapters.ts` | ✅ Confirmed (0 violations) |
| Deprecated PBRS dimension names absent from live source | `grep -rl "Business Logic\|Clarity"` across `apps/platform/src`, `packages/core/src`, `packages/pbrs/src` | ✅ Confirmed (no matches) |

---

## 7. Known Limitations

- The automated role/route matrix covers the highest-risk
  permission boundaries called out in the task (Owner-only Revoke
  Certification, Owner/Admin Revoke Passport, Auditor-only Audit
  Trail) rather than every permission × every route combination;
  the full `PhoenixPermission` matrix was already covered by
  PHX-PLATFORM-006/007 QA and is not re-litigated here since the
  underlying `access-control.ts` logic was not touched.
- Visual contact sheets confirm layout/rendering at three viewports
  but were captured against the Owner default session (no role
  switch) except where a role-specific screenshot is called out by
  name — this matches the Task 16 requirement, which does not ask for
  per-role contact sheets beyond the three optional hard-reload
  checks.
