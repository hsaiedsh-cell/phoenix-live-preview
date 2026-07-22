# Release Notes — PHX-PLATFORM-007

**Release label:** PHX-PLATFORM-007 — Passport & Certification Action Layer
**Base:** PHX-PLATFORM-006-AUTH-WORKSPACE-ACCESS-FOUNDATION

## What Changed

- Added a shared mock action-result contract (`action-types.ts`): `PhoenixActionStatus`, `PhoenixActionResult`, `PassportActionInput`, `CertificationActionInput`.
- Added four mock workflow actions to `api-client.ts`: `issuePassport`, `revokePassport`, `grantCertification`, `revokeCertification` — each mock-only, none persisted, none a security boundary.
- Added two reusable UI building blocks: `ActionConfirmDialog` (confirmation modal with optional required-reason field) and `GovernanceActionButton` (role-gated trigger wrapping it).
- **Passports (`/passports`):** every `PassportCard` now offers a Revoke Passport action (Owner/Admin, reason required). Cards are never hard-deleted; a revoked note replaces the action area on success.
- **Certifications (`/certifications`):** a new governance panel shows Grant Certification for eligible-but-not-yet-certified assets (Owner/Admin) and Revoke Certification for certified assets (Owner only, reason required).
- **Assessment detail (`/assessments/[assessmentId]`):** a new "Governance Actions" area offers Issue Passport (Owner/Admin/Reviewer) and Grant Certification (Owner/Admin) for eligible, not-yet-Certified assessments.
- Added one representative `PassportRevoked` activity entry and one `passport.revoked` audit entry, and the additive `ActivityType` value `'PassportRevoked'` needed to represent it.

## What Was Preserved

- PBRS six-dimension scoring model, Certification Level thresholds (70/83/92), and Internal Tier vocabulary — all unchanged.
- PBRS Standard — unchanged.
- The `sample-data.ts` import boundary — still only `api-client.ts` and `api-adapters.ts` import it.
- The Alpha Role Switcher, all existing routes, and the existing mock auth/access-control foundation from PHX-PLATFORM-006 — unchanged.
- Certification UI still leads with PBRS Foundation / Practitioner / Enterprise; Bronze/Silver/Gold/Platinum never appears as a primary label.
- No real backend, database, authentication, tokens, or third-party auth libraries were introduced.

## Alpha Limitations

- Every action in this release is mock-only: results live in local component state and are lost on page refresh. Nothing is persisted across sessions or pages.
- No optimistic cross-page sync — e.g., issuing a passport on an assessment detail page does not update the `/passports` list in the same session.
- A pre-existing PHX-PLATFORM-006 SSR/hydration characteristic (the mock session defaults to Owner on the server) can cause role-gated content to briefly show stale permissions immediately after a **hard page reload with a previously-switched role stored in `localStorage`**. This does not occur when switching roles via the in-app Alpha Role Switcher during normal use. See the QA report for detail and a recommended future fix.
- `/passports` has no "eligible, not yet issued" state in this Alpha's sample data, so Issue Passport is offered on the assessment detail page instead.

## Next Recommended Sprint

- **PHX-PLATFORM-008 (suggested):** resolve the SessionProvider SSR-default nuance noted above (e.g., a neutral "loading" initial session state instead of defaulting to Owner), then begin real backend/auth integration per the PHX-PLATFORM-002 contract — starting with the four governance actions added in this sprint, since their `PhoenixActionResult` contract was designed to swap onto real `fetch()` calls without call-site changes.
