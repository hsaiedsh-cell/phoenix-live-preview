# PHX-PLATFORM-007 — QA Report

## Build Status

| Command | App | Result |
|---|---|---|
| `pnpm install` | (workspace) | ✅ Pass |
| `pnpm type-check` | `@phoenix/platform` | ✅ Pass (`tsc --noEmit`, no errors) |
| `pnpm lint` | `@phoenix/platform` | ✅ Pass ("No ESLint warnings or errors") |
| `pnpm build` | `@phoenix/platform` | ✅ Pass (12/12 pages generated) |
| `pnpm build` | `@phoenix/website` | ✅ Pass (13/13 pages generated) — untouched this sprint, verified unaffected |
| `pnpm build` | `@phoenix/dashboard` | ✅ Pass (4/4 pages generated) — untouched this sprint, verified unaffected |

Builds were run per-app via `pnpm --filter <app> build` (not the combined root `pnpm build`), consistent with the fallback documented for this environment.

## Role Gating Checks

Verified with a Playwright script driving the **in-app Alpha Role Switcher** (client-side role changes, no page reload) across all six roles, navigating between `/passports`, `/certifications`, and an assessment detail page (`/assessments/ast-002-assessment`, a Business Ready, not-yet-certified asset) via the sidebar links.

| Role | Issue Passport | Revoke Passport | Grant Certification | Revoke Certification | Audit Trail |
|---|:---:|:---:|:---:|:---:|:---:|
| Owner | PASS (visible) | PASS (visible) | PASS (visible) | PASS (visible) | PASS (visible) |
| Admin | PASS (visible) | PASS (visible) | PASS (visible) | PASS (restricted) | PASS (visible) |
| Reviewer | PASS (visible) | PASS (restricted) | PASS (restricted) | PASS (restricted) | PASS (restricted) |
| Contributor | PASS (restricted) | PASS (restricted) | PASS (restricted) | PASS (restricted) | PASS (restricted) |
| Viewer | PASS (restricted) | PASS (restricted) | PASS (restricted) | PASS (restricted) | PASS (restricted) |
| Auditor | PASS (restricted) | PASS (restricted) | PASS (restricted) | PASS (restricted) | PASS (visible) |

All 30 cells (6 roles × 5 checks) **PASS** against the acceptance criteria and `PHX_PLATFORM_006_ACCESS_CONTROL_MATRIX.md`.

## Action Visibility Checks

- **Issue Passport / Grant Certification** on the assessment detail page correctly disappear entirely (return `null` from `AssessmentGovernanceActions`) for assessments already at `Certified` status, and for assessments whose score does not clear the Foundation threshold (`eligibleCertificationLevel === 'None'`) — verified against `ast-001-assessment` (Certified) and `ast-006-assessment` (Draft, below threshold).
- **Revoke Passport** appears on every `PassportCard` on `/passports` regardless of certification status (Pending Certification or Certified), matching Task 6's "secondary governance action on existing passport cards."
- **Grant Certification** on `/certifications` only appears for assets in the `eligibleItems` list (Business Ready, score ≥ 83, not yet certified) and only when a passport id could be resolved; if no passport is on record, a plain-text note is shown instead of the button (no incorrect action state is invented).
- **Revoke Certification** on `/certifications` only appears for assets in `certifiedItems`.

## Reason-Required Checks

- `ActionConfirmDialog`'s Confirm button is disabled (`confirmDisabled`) while `reasonRequired` is true and the reason textarea is empty/whitespace-only — verified by inspecting the rendered `disabled` attribute before/after typing into the textarea.
- `revokePassport({ reason: '' })` and `revokePassport({})` both return `{ ok: false, message: 'Revocation requires a documented reason.' }` — verified by direct unit-style invocation via a small Node/tsx script against the compiled function logic (mirrors the `ActionConfirmDialog` behavior, confirming both layers enforce it independently).
- `revokeCertification({ passportId: '...', reason: '' })` returns `{ ok: false, message: 'Certification revocation requires a documented reason.' }`; `revokeCertification({ reason: '...' })` (no `passportId`/`certificationId`) returns `{ ok: false, message: 'Certification revocation requires a certification or passport reference.' }`.
- `issuePassport({})` (no `assessmentId`/`passportId`) returns `{ ok: false, message: 'Issuing a passport requires an assessment or passport reference.' }`.
- `grantCertification({ passportId: '' } as any)` / `grantCertification({} as any)` returns `{ ok: false, message: 'Granting a certification requires a passport reference.' }`.

## Activity / Audit Mock Event Checks

- `ActivityType` (`packages/core/src/contracts/enums.ts`) gained the additive value `'PassportRevoked'` — confirmed no existing enum value was removed or renamed via `git diff`-style manual comparison against the PHX-PLATFORM-006 baseline.
- `mock-fixtures/activity.ts` and `mock-fixtures/audit.ts` each gained one new representative entry (`act-011` / `adt-011`) documenting a passport revocation, following the existing "illustrative historical example" convention already used for `certification.revoked` (`adt-007`).
- All four mock action functions (`issuePassport`, `revokePassport`, `grantCertification`, `revokeCertification`) return a synthesized `activityId`/`auditRecordId` string on success.

## No Real Auth/Backend/Database Check

- `grep -rln "next-auth\|OAuth\|Auth0\|Clerk\|Supabase\|Firebase" apps/platform/src` → no matches.
- No new `fetch()` calls to any external endpoint were added; every new/modified function in `api-client.ts` uses `mockDelay()` only.
- No database client, connection string, or ORM was introduced.
- No token, cookie, or header-based credential was added anywhere in the new code.

## No PBRS Scoring / Certification Threshold / Standard Changes

- `certification-levels.ts` (Foundation 70 / Practitioner 83 / Enterprise 92) — untouched.
- `@phoenix/pbrs`'s scoring engine and `PBRS_DIMENSIONS` — untouched.
- No file under `docs/standards/` was modified.
- Certification UI continues to lead with PBRS Foundation / Practitioner / Enterprise; Bronze/Silver/Gold/Platinum (Internal Tier) is never used as a primary label in any new component (`CertificationGovernancePanel` shows `certificationLevelLabel`, never `internalTier`, as the primary text).

## No `sample-data.ts` Import Violations

`grep -rn "from '.*sample-data'" apps/platform/src` returns matches only in `api-client.ts` and `api-adapters.ts` — the two files permitted to import it. No new component or page imports it directly.

## Known Limitations

1. **Mock-only state.** All action results (issued/revoked/granted/revoked notes) live in local component `useState` and are lost on refresh — by design for this Alpha.
2. **No cross-page sync.** Issuing a passport on the assessment detail page does not retroactively update the `/passports` list in the same session.
3. **Pre-existing SSR/hydration nuance (not introduced by this sprint).** `SessionProvider` (PHX-PLATFORM-006) initializes to Owner on the server (no `localStorage` access there) and to the last-switched role on the client. During QA, **hard-reloading a page after setting the mock role directly via `localStorage`** (bypassing the in-app switcher) can trigger a genuine React hydration mismatch, because the server-rendered HTML (Owner-permissioned) briefly disagrees with the client's actual role. This was traced conclusively during this sprint's QA:
   - Switching roles through the **in-app Alpha Role Switcher** (a pure client-side state update, no reload) produces 100%-correct results across all 30 role/action combinations (see table above).
   - Reproducing the same role via `localStorage.setItem(...)` **followed by a hard page navigation** intermittently shows stale (server-default) content until React's hydration pass corrects it, and in some cases surfaces React error #418/#423/#425 (hydration mismatch) in the browser console.
   - This affects any existing role-gated content on the page, including the pre-existing Audit Trail `RoleGate` and the Alpha Role Switcher's own displayed role label — it is a foundational characteristic of the mock session's SSR default inherited from PHX-PLATFORM-006, not something specific to the new governance actions.
   - `GovernanceActionButton` includes a client-mount guard (renders nothing until after the first client effect fires) as a defensive improvement, but the only fully reliable QA method for this Alpha is the in-app switcher, or a `localStorage` role change followed by **two** reloads.
   - **Recommendation for a future sprint:** resolve at the source by giving `SessionProvider` a loading/unauthenticated initial state on the server (rather than defaulting to Owner) so client and server agree before any permission-gated content renders — this was out of scope for PHX-PLATFORM-007 as a workflow action-layer sprint.
4. **`/passports` has no "eligible, not yet issued" state to gate an Issue Passport action against** (Task 6) — this Alpha's sample data only produces already-issued passport rows on that page. Issue Passport is offered on the assessment detail page instead, per the task's explicit guidance for this case.
