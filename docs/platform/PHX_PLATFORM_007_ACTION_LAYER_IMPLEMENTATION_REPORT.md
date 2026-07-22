# PHX-PLATFORM-007 — Passport & Certification Action Layer
## Implementation Report

**Sprint:** PHX-PLATFORM-007
**Base:** PHX-PLATFORM-006-AUTH-WORKSPACE-ACCESS-FOUNDATION
**Scope:** Mock workflow actions for Passport issue/revoke and Certification grant/revoke, layered on top of the PHX-PLATFORM-006 mock auth/access-control foundation. No real backend, database, or authentication was added.

---

## 1. Files Changed

### New files

| File | Purpose |
|---|---|
| `apps/platform/src/lib/action-types.ts` | Shared `PhoenixActionStatus`, `PhoenixActionResult`, `PassportActionInput`, `CertificationActionInput` types (Task 2). |
| `apps/platform/src/components/ActionConfirmDialog.tsx` | Reusable confirmation modal — title, description, optional required reason textarea, submitting/success/error states. |
| `apps/platform/src/components/GovernanceActionButton.tsx` | Role-gated trigger button wrapping `ActionConfirmDialog`; shows a `RestrictedNote` instead of the button when the current mock role lacks the permission. Includes a client-mount guard (see §5, Known Limitations). |
| `apps/platform/src/components/CertificationGovernancePanel.tsx` | Client panel for `/certifications` — "Eligible for Certification" (Grant action) and "Certification Governance" (Revoke action) sections. |
| `apps/platform/src/components/AssessmentGovernanceActions.tsx` | Client panel for the assessment detail page — Issue Passport / Grant Certification actions, shown when the assessment is eligible and not yet Certified. |
| `docs/platform/PHX_PLATFORM_007_ACTION_LAYER_IMPLEMENTATION_REPORT.md` | This report. |
| `docs/platform/PHX_PLATFORM_007_ACTION_PERMISSION_MATRIX.md` | Action × role permission matrix. |
| `docs/platform/PHX_PLATFORM_007_QA_REPORT.md` | QA results. |
| `docs/platform/RELEASE_NOTES_PHX_PLATFORM_007.md` | Release notes. |
| `BUILD_REPORT_PHX_PLATFORM_007.md` | Build report. |

### Modified files

| File | Change |
|---|---|
| `apps/platform/src/lib/api-client.ts` | Replaced the previous placeholder `issuePassport(assessmentId)`, `grantCertification(passportId, input)`, `revokeCertification(certificationId, input)` (unused anywhere else in the codebase) with the Task 3/4-specified `issuePassport(input)`, `revokePassport(input)`, `grantCertification(input)`, `revokeCertification(input)` — each returning `Promise<PhoenixActionResult>`. The original passport-record synthesis logic was preserved as a private helper (`synthesizeIssuedPassportRecord`) rather than deleted. |
| `apps/platform/src/components/PassportCard.tsx` | Added `'use client'`, a local mock-only "revoked" indicator (`useState`), and a `GovernanceActionButton` for Revoke Passport (`canRevokePassport`). Card is never hard-deleted; a revoked note replaces the action area. |
| `apps/platform/src/app/(platform)/certifications/page.tsx` | Fetches `getPassports()` alongside `getCertifications()`, builds an `asset.id -> passport.passportId` lookup map, and renders `<CertificationGovernancePanel>` below the existing certified-assets table. `AssessmentTable` and `CertificationCard` are unchanged. |
| `apps/platform/src/app/(platform)/assessments/[assessmentId]/page.tsx` | Fetches `getPassports()` to find an existing passport for the asset, and renders `<AssessmentGovernanceActions>` below `AssessmentScoreSummary`. |
| `apps/platform/src/lib/mock-fixtures/activity.ts` | Added one representative `PassportRevoked` activity entry (`act-011`). |
| `apps/platform/src/lib/mock-fixtures/audit.ts` | Added one representative `passport.revoked` audit entry (`adt-011`), pairing with the existing `certification.revoked` example. |
| `packages/core/src/contracts/enums.ts` | Additive: `ActivityType` gained `'PassportRevoked'`. No existing enum values changed. |

`apps/platform/src/app/(platform)/passports/page.tsx` was **not** modified — `SessionProvider` already wraps the whole app in `apps/platform/src/app/layout.tsx`, so the server-rendered page can render the now-client `PassportCard` without any page-level change. Per Task 6, no Issue Passport action was added to `/passports` (it only shows already-issued passports) — Issue Passport lives on the assessment detail page instead.

`apps/platform/src/app/(platform)/login/page.tsx` was **not** touched (Task 11 — no changes were required).

---

## 2. Mock API Functions (Task 3 / Task 4)

All four live in `apps/platform/src/lib/api-client.ts` and return `Promise<PhoenixActionResult>`:

- **`issuePassport(input: PassportActionInput)`** — requires an `assessmentId` or `passportId` reference; always succeeds given one (no workflow engine to reject against in this Alpha).
- **`revokePassport(input: PassportActionInput)`** — requires a non-empty `reason`; returns `{ ok: false, message: 'Revocation requires a documented reason.' }` otherwise.
- **`grantCertification(input: CertificationActionInput)`** — requires `passportId`; message includes `PBRS_CERTIFICATION_SAFE_DISCLAIMER`.
- **`revokeCertification(input: CertificationActionInput)`** — requires `certificationId` or `passportId`, and a non-empty `reason`; returns `{ ok: false, message: 'Certification revocation requires a documented reason.' }` if the reason is missing.

None of these functions enforce permissions — that is UI-only, via `RoleGate`/`GovernanceActionButton` reading `access-control.ts`, consistent with the file-level note already present in `api-client.ts` from PHX-PLATFORM-006. None persist anything; every call is a `mockDelay()`-wrapped `Promise.resolve()`.

---

## 3. UI Components Added

- **`ActionConfirmDialog`** — presentational only; local `reason` state; three visual states (confirm form / submitting / done).
- **`GovernanceActionButton`** — the one integration point pages/cards use. Reads `usePhoenixSession().capabilities` for the given `PhoenixPermission`; renders `RestrictedNote` if disallowed, otherwise a button that opens `ActionConfirmDialog` and calls the caller's `onRun`.
- **`CertificationGovernancePanel`** — two sections: eligible-but-not-certified assets (Grant Certification, requires a resolved `passportId`) and certified assets (Revoke Certification, Owner-only).
- **`AssessmentGovernanceActions`** — Issue Passport + Grant Certification, shown only when `statusLabel !== 'Certified'` and the score clears a Certification Level threshold (`eligibleCertificationLevel !== 'None'`).

---

## 4. Role Gating Behavior

Gating uses the **existing, unmodified** `access-control.ts` permissions (`canIssuePassport`, `canRevokePassport`, `canGrantCertification`, `canRevokeCertification`, `canViewAuditTrail`) exactly as defined in PHX-PLATFORM-006. No permission arrays were changed. See `PHX_PLATFORM_007_ACTION_PERMISSION_MATRIX.md` for the full table and `PHX_PLATFORM_007_QA_REPORT.md` for verified results per role.

---

## 5. Passport / Certification Action Behavior

- **Issue Passport** — mock-only; on success, the assessment detail page shows a static success note in place of the button. Nothing is written back to `sample-data.ts`; a page refresh reverts it.
- **Revoke Passport** — requires a reason (enforced both in `ActionConfirmDialog`'s UI — the Confirm button is disabled without one — and in `revokePassport()` itself); the passport card is never removed, only shown with a "Revoked (Alpha mock action)" indicator and the returned message.
- **Grant Certification** — always references a specific `passportId`, resolved server-side on `/certifications` (via a `getPassports()` lookup) and via `existingPassportId` (or a synthesized mock reference) on the assessment detail page.
- **Revoke Certification** — Owner-only in the UI; requires a reason; the certified-asset card shows the returned message in place of the button afterward.

---

## 6. Activity / Audit Handling (Task 9)

- `ActivityType` gained one additive value, `'PassportRevoked'` (packages/core/src/contracts/enums.ts) — there was previously no way to represent a passport revocation in the activity feed.
- One representative `PassportRevoked` activity fixture (`act-011`) and one `passport.revoked` audit fixture (`adt-011`) were added, following the existing "illustrative historical example" pattern already used for `certification.revoked` (`adt-007`).
- The four mock action functions each return a synthesized `activityId`/`auditRecordId` (`act-mock-<timestamp>` / `adt-mock-<timestamp>`) in their `PhoenixActionResult`, representing what a real backend would persist — no actual fixture rows are appended at runtime, consistent with "mock-only, no real persistence."

---

## 7. Limitations

- **Mock-only, non-persistent.** Every action result is held in local component state (`useState`); a page refresh reverts all of it. This is by design (Task constraints).
- **No optimistic cross-page sync.** Issuing a passport on the assessment detail page does not update `/passports`' list (no shared mock store exists yet).
- **SSR/hydration nuance inherited from PHX-PLATFORM-006 (pre-existing, not introduced by this sprint).** `SessionProvider`'s initial state differs between the server (no `window`/`localStorage`, defaults to Owner) and the client (reads a previously-switched role from `localStorage`). On a **hard page reload** with a non-Owner role already stored, this can produce a brief React hydration mismatch — this affects any role-gated content on this page (e.g. the existing Audit Trail `RoleGate`, the Alpha Role Switcher's own label), not just the new governance actions. It does **not** occur when switching roles via the in-app Alpha Role Switcher during a normal session (a pure client-side state update). `GovernanceActionButton` includes a client-mount guard to reduce (not eliminate) the chance of a stale/incorrect flash. See the QA report for the verified-correct role matrix (captured via the in-app switcher) and recommended QA method going forward.
- **`/passports` shows no "eligible, not yet issued" state.** Per Task 6, this Alpha's sample data only produces already-issued passports on that page; Issue Passport lives on the assessment detail page instead.

---

## 8. Future Backend Integration Path

1. Swap each of the four `api-client.ts` action functions' bodies for real `fetch()` calls against the endpoints implied by `API_CONTRACT_PHX_PLATFORM_002.md` — call sites (components) depend only on `PhoenixActionResult`/`PassportActionInput`/`CertificationActionInput` shapes, so no component changes should be needed.
2. Enforce `PERMISSIONS_MODEL_PHX_PLATFORM_002.md` server-side (the mock functions do not — see the file-level notes in `api-client.ts`).
3. Replace `SessionProvider`'s mock-session read with a real session lookup, which would also resolve the SSR/hydration nuance in §7 since server and client would then agree on the same session source.
4. Persist activity/audit rows server-side instead of returning synthesized mock ids.
