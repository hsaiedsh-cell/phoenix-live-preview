# PHX-CERTIFICATIONS-001 — Implementation Report

**Sprint:** PHX-CERTIFICATIONS-001 — Live Certifications List (preview mode)
**Base:** PHX-CERTIFICATIONS-001-CURRENT-MAIN-SOURCE (post-fast-forward from
`origin/main`; verified to contain `LivePassportCard`, `previewGetPassports`,
and `loadPassportsListData` before this sprint began)
**Type:** Read-only frontend/data-layer migration. No write endpoints, no
PBRS changes, no authentication changes, no UI redesign.

---

## 1. Scope decision — why this is narrower than a naive reading of "live migration"

Before writing any code, this sprint's brief ("follow the Passports
implementation as the exact architectural pattern") was checked against the
actual PHX-PASSPORTS-001 source, not assumed. The real pattern is:

- `apps/backend/src/routes/passports.ts` is **still the plain
  PHX-BACKEND-001 stub** — every route 501s. PHX-PASSPORTS-001 never added a
  live Express endpoint.
- The only live read is a **`vercel-supabase-preview`-mode-only** direct
  Supabase/Postgres query (`previewGetPassports()` in
  `preview-api-client.server.ts`), gated by the same permission the future
  backend route would enforce, called from a single data-source function
  (`loadPassportsListData()`) that every other mode (`mock`, `real-dev`,
  `production-auth`, `real-disabled`) resolves as `'mock'`, not
  `'not-wired'` — the page keeps rendering its pre-existing mock view for
  every mode except the one that was actually migrated.

PHX-CERTIFICATIONS-001 mirrors this exactly. **No backend Express route or
repository file was added.** `apps/backend/src/routes/certifications.ts`
remains the byte-identical PHX-BACKEND-001 stub. This is a deliberate,
narrower scope than an earlier draft of this work (built against a
different, non-current archive) which incorrectly added a live
`GET /api/workspaces/:workspaceId/certifications` Express route — that
draft was discarded because it did not match `origin/main`'s actual state
and could not honestly be described as following the Passports pattern
(which has no live backend route to follow).

## 2. What was added

| File | Change |
|---|---|
| `apps/platform/src/lib/real-api-client.ts` | Added `BackendCertification` type (mirrors `BackendPassport`'s shape and doc-comment style) |
| `apps/platform/src/lib/preview-api-client.server.ts` | Added `previewGetCertifications(workspaceId)` — mirrors `previewGetPassports()` structurally: `workspaceExists()` 404 check → `requirePreviewPermission(workspaceId, 'assessment.read')` → one parameterized join query → row mapping |
| `apps/platform/src/lib/platform-data-source.ts` | Added `LiveCertificationsListData` interface and `loadCertificationsListData()` — mirrors `loadPassportsListData()`: `vercel-supabase-preview`-only, `'mock'` for every other mode, same `LiveResult<T>` status handling |
| `apps/platform/src/components/LiveCertificationsTable.tsx` | **New file.** Renders `BackendCertification[]` as a table |
| `apps/platform/src/app/(platform)/certifications/page.tsx` | Added the `vercel-supabase-preview` branch; the `mode !== 'vercel-supabase-preview'` branch is the original mock-mode JSX, unchanged in content (only reorganized under the new `if`) |

Nothing else was modified. `apps/backend/src/routes/certifications.ts`,
`apps/backend/src/auth/permissions.ts`, `apps/platform/src/lib/
certification-levels.ts`, and every PBRS/scoring file are byte-identical to
the baseline archive.

## 3. Architectural decisions, and why

**Permission: `assessment.read`, not a new `certification.read`.**
`apps/backend/src/auth/permissions.ts` has no dedicated certification-read
permission — only the reserved, unused `certification.grant` write
permission exists, and this sprint's constraints explicitly rule out
auth-model changes. `assessment.read` is granted to every one of the six
roles (Owner/Admin/Reviewer/Contributor/Viewer/Auditor), which matches the
Certifications page's existing behavior of being visible to every
signed-in workspace member with no role gating. This is the exact
permission Passports' `previewGetPassports()` already uses for the same
reason — same choice, same rationale, not independently re-derived.

**Table, not a card grid.**
`LivePassportCard` is a card because the *mock* passports page already
renders passports as a card grid (`PassportCard`). The *mock* certifications
page renders its "Certified Assets" section as a table (`AssessmentTable`),
so `LiveCertificationsTable` is a table — this keeps the live rendering
visually consistent with the mock rendering of the same page section,
which is the same reasoning `LivePassportCard` applied in the other
direction. This is a presentation choice, not a deviation from the
architectural pattern (preview-mode-only backend, direct Supabase read,
shared `LiveResult`/`DataStatePanel` machinery, disabled/inert copy for
unsupported write actions).

**Certification Level cards keep their static fields, drop per-level asset counts.**
`getCertifications()` (mock-api-client.ts, via `mockDelay()`) is still
called in the live branch, but *only* to read `levels` — static PBRS
threshold display metadata (name/description/minScore) that is identical
in every mode and involves no network call (`mockDelay` is a pure
`setTimeout` wrapper, confirmed by reading its source). The per-level
`assetCount` prop, and the "Eligible Assets" / "Expiring Soon" stat cards,
are omitted in live mode because deriving them requires
assessment-score-threshold matching across the whole workspace — data this
sprint does not migrate. Showing a fabricated `0` for an unmigrated
aggregate would misrepresent an unknown value as a known one; the fields
are omitted entirely rather than defaulted.

**Certification-granting governance panel omitted in live mode.**
`CertificationGovernancePanel` exists to grant certifications to eligible
assets — a write action. It is preview-only per this sprint's brief in
every mode, so it is not rendered in the live branch at all (mirrors
`LivePassportCard`'s choice to render unsupported actions as plain, inert
copy rather than a wired-but-disabled button).

## 4. Known limitations (carried forward, same shape as Passports' own)

- Live certifications are visible only in `vercel-supabase-preview` mode.
  `real-dev` and `production-auth` will not show live certification data
  until a future sprint adds the actual `GET /api/workspaces/:workspaceId/
  certifications` Express route and repository (currently 501 stubs).
- No pagination — matches `previewGetPassports()`'s existing `LIMIT 100`,
  no cursor.
- Certification Level (PBRS Foundation/Practitioner/Enterprise) is not
  computed or displayed per-row in the live table; only the stored PBRS
  Internal Tier and status columns are shown, exactly as persisted. This
  keeps `certification-levels.ts` untouched and avoids introducing
  presentation-layer derivation this sprint did not review.
- Granting, revocation, and public verification remain preview-only for
  live data in every mode, including `vercel-supabase-preview`.

## 5. What was explicitly NOT done, per this sprint's constraints

- No write endpoints (grant/revoke/verify) were implemented anywhere.
- No PBRS scoring, threshold, or Certification Level logic was added,
  changed, or duplicated. `certification-levels.ts` and
  `PBRS_CERTIFICATION_THRESHOLD_ADDENDUM_PHX_CERT_003.md` remain the sole
  source of truth.
- No authentication or permission-model changes — `assessment.read` is an
  existing permission, reused as-is.
- No UI redesign — existing component styling, table conventions
  (`LiveAssessmentsTable`/`LivePassportCard`'s date-formatting helper,
  etc.), and page layout patterns were reused verbatim.
