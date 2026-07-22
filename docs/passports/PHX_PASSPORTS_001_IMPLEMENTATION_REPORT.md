# Implementation Report — PHX-PASSPORTS-001 — Live Passport Endpoint Foundation

## Source inspection performed before writing any code

Per this project's standing "read everything before writing anything" discipline,
the following were read in full before any implementation began:

- `apps/platform/src/app/(platform)/passports/page.tsx` (existing mock-backed page)
- `apps/platform/src/components/PassportCard.tsx` (existing mock card — confirmed it
  calls `passport.validUntil.slice(0, 10)` unguarded, and wires a revoke button to
  `revokePassport()`)
- `apps/platform/src/lib/api-client.ts`, `mock-api-client.ts`, `sample-data.ts`,
  `view-models.ts`, `api-adapters.ts` (existing mock passport shape:
  `PassportListItemViewModel`, `PhoenixPassport`, `buildPassportListItems()`)
- `apps/platform/src/lib/platform-data-source.ts`, `preview-api-client.server.ts`,
  `real-api-client.ts`, `real-api-client.server.ts` (the existing live-read
  architecture used by `/dashboard`, `/assessments`, `/assessments/[id]`, `/settings`)
- `apps/platform/src/lib/auth/preview-auth.server.ts`, `db/preview-db.server.ts`
  (Clerk→Phoenix-user mapping, workspace role resolution, permission matrix, and the
  `pg.Pool` boundary)
- `apps/platform/src/lib/certification-levels.ts` (PBRS Certification Level / Internal
  Tier derivation — confirmed pure, no scoring logic, single source of truth)
- `apps/platform/src/components/DataStatePanel.tsx`, `LiveAssessmentsTable.tsx`,
  `Badges.tsx`, `Icons.tsx` (shared live-state UI primitives)
- `apps/backend/src/routes/passports.ts` — confirmed this is still a PHX-BACKEND-001
  **stub**: every route (`GET /workspaces/:workspaceId/passports`,
  `POST /assessments/:assessmentId/passport`, `GET /passports/:passportId`, etc.)
  returns HTTP 501 Not Implemented. There is no backend repository function to mirror.
- `apps/backend/db/migrations/0001_initial_schema.sql` — read the full `pbrs_passports`
  and `pbrs_certifications` table definitions, including constraints and indexes
- `packages/core/src/contracts/passport.ts`, `certification.ts`, `asset.ts`,
  `assessment.ts`, `enums.ts` — the `PBRSPassport`/`PBRSCertificationRecord` contract
  shapes and the `PassportStatus`/`CertificationStatus` enums

## What was changed

1. **`apps/platform/src/lib/real-api-client.ts`** — added a `BackendPassport` shared
   type, following the file's existing convention of keeping every `Backend*` shape in
   this one file even when only one runtime mode populates it.

2. **`apps/platform/src/lib/preview-api-client.server.ts`** — added
   `previewGetPassports(workspaceId)`, following the exact structure of the sibling
   `previewGetAssessments()` / `previewGetWorkspaceActivity()` functions: workspace
   existence check → permission check → parameterized SQL → row-to-camelCase mapping.

3. **`apps/platform/src/lib/platform-data-source.ts`** — added
   `loadPassportsListData()`, mirroring `loadAssessmentsListData()`'s status handling
   (`mock` / `live` / `config-missing` / the mapped error states), with one deliberate
   difference documented in code: this function only treats `vercel-supabase-preview`
   as live-capable, returning `'mock'` for every other mode (see "Deliberate deviations"
   below).

4. **`apps/platform/src/components/LivePassportCard.tsx`** (new) — renders one
   `BackendPassport` row. Deliberately not a reuse of `PassportCard.tsx` (see below).

5. **`apps/platform/src/app/(platform)/passports/page.tsx`** — branches on
   `apiConfig.mode`. For every mode except `vercel-supabase-preview`, the page is
   **byte-for-byte behaviorally unchanged** — same mock call, same JSX, same copy. For
   `vercel-supabase-preview`, the page now calls `loadPassportsListData()` and renders
   `LiveDataBadge` + `LivePassportCard` grid on `'live'`, or the shared
   `renderDataStatePanel()` for any non-data status.

## What data source `/passports` now uses

- **Every mode except `vercel-supabase-preview`**: unchanged — `getPassports()` from
  `api-client.ts`, which is unconditionally mock-backed (fixture data from
  `sample-data.ts`, via `mock-api-client.ts`'s `buildPassportListItems()`).
- **`vercel-supabase-preview` mode**: `loadPassportsListData()` →
  `previewGetPassports()` → a direct, parameterized SQL read against Supabase/Postgres
  (via the existing `pg.Pool` in `lib/db/preview-db.server.ts`). No HTTP call to the
  Express backend is made in this mode (there is no Express backend host in this
  architecture, per PHX-DEPLOY-004C).

## Which tables are queried

```sql
SELECT ...
FROM pbrs_passports p
JOIN assets ast ON ast.id = p.asset_id
LEFT JOIN LATERAL (
  SELECT c.tier, c.status
  FROM pbrs_certifications c
  WHERE c.passport_id = p.id AND c.deleted_at IS NULL
  ORDER BY c.created_at DESC
  LIMIT 1
) cert ON true
WHERE p.workspace_id = $1 AND p.deleted_at IS NULL
ORDER BY p.created_at DESC
LIMIT 100
```

- `pbrs_passports` — primary table (id, passport_id, asset_id, assessment_id, status,
  score_snapshot, grade_snapshot, valid_from, valid_until, record_hash, issued_at,
  revoked_at, created_at, updated_at)
- `assets` — joined for `name` (asset display name)
- `pbrs_certifications` — left-joined (via `LATERAL`) for the passport's most recent
  non-deleted certification row, if any (`tier`, `status`)

No `pbrs_scores`, `pbrs_dimension_scores`, or `derived_signals` tables are queried by
this endpoint — `pbrs_passports.score_snapshot` / `grade_snapshot` are themselves an
immutable snapshot taken at issuance time (per `PBRSPassport`'s own contract doc
comment: "it does not re-score, it snapshots"), so re-joining the live score tables
would not be more correct, only redundant.

## How auth/workspace scoping is enforced

Identical boundary to every other `previewGet*` function in this file:

1. `resolvePreviewUserOrThrow()` — resolves the Clerk session (server-side, via
   `@clerk/nextjs/server`'s `auth()`), then maps the Clerk user id to a Phoenix
   `users.id` via `auth_identities`. Never auto-provisions a user; an unmatched
   identity throws `AUTH_REQUIRED`, exactly like every sibling function.
2. `workspaceExists(workspaceId)` — 404s if the workspace row does not exist
   (`deleted_at IS NULL`).
3. `requirePreviewPermission(workspaceId, 'assessment.read')` — resolves the actor's
   role for that workspace from `workspace_users` and enforces the permission,
   throwing `PERMISSION_DENIED` (403) if the role lacks it or membership is not
   `Active`.

Workspace id itself is resolved the same way every other migrated section resolves
it in this mode: `NEXT_PUBLIC_PHOENIX_PRODUCTION_WORKSPACE_ID`
(`resolveLiveWorkspaceId()` in `platform-data-source.ts`, unchanged by this sprint).

## Permission choice — an explicit, documented assumption

The permission matrix in `lib/auth/preview-auth.server.ts` has no dedicated
`'passport.read'` entry — only `'passport.issue'` exists (Owner/Admin/Reviewer, a
write permission). This sprint gates the new read on **`'assessment.read'`** instead,
reasoning: a passport is a read-only artifact derived from an already-viewable
assessment, so every role that can already see an assessment
(Owner/Admin/Reviewer/Contributor/Viewer/Auditor — i.e. every role) can see its
resulting passport. This is a deliberate deviation from "wait for an exact permission
name" and is called out here, in the SQL function's own doc comment, and in the QA
report so a reviewer can confirm or override it before a real backend passports
endpoint is built. **A future sprint building a real `GET
/api/workspaces/:workspaceId/passports` endpoint should confirm this matches whatever
permission that endpoint ends up enforcing**, and this preview-mode implementation
should be updated to match if it differs.

## Why a new component instead of reusing `PassportCard.tsx`

`PassportCard.tsx` expects the mock's full `PassportListItemViewModel` — nested
`@phoenix/core` `Asset`/`Assessment`/`PBRSScoreRecord`/`PBRSCertificationRecord`
objects assembled by `api-adapters.ts`'s `buildPassportListItems()`. Constructing
those from a single flattened `previewGetPassports()` row would mean either (a)
fabricating plausible-looking values for fields the query doesn't fetch (e.g. a full
`Asset.ownerUserId`/`currentVersionId`), which risks misrepresenting live data as more
complete than it is, or (b) a much larger, out-of-scope join across
`assessments`/`pbrs_scores`/`pbrs_dimension_scores` just to satisfy a type shape the
live read doesn't need. Instead, `LivePassportCard.tsx` renders the flattened
`BackendPassport` shape directly — the same architectural choice already made for
`LiveAssessmentsTable.tsx` vs. the mock's `AssessmentTable.tsx` (see that component's
own header comment: "Deliberately NOT AssessmentTable — that component requires the
mock view model's department field, which the real list endpoint does not return").

`PassportCard.tsx`'s revoke button (`GovernanceActionButton` wired to
`revokePassport()`) was also not reused. It is not unsafe as-is — `api-client.ts`'s
`revokePassport()` only special-cases `mode === 'mock'`; every other mode (including
`vercel-supabase-preview`) already routes to `disabledRealApiCall()`, which returns a
"not enabled" result and mutates nothing. But leaving a clickable confirm-dialog
button in place, even a safely inert one, is a weaker signal than plain, non-clickable
copy stating the action is preview-only — which is what `LivePassportCard.tsx` renders
instead, per this sprint's "any unsupported action buttons must remain disabled,
preview-only, or clearly non-persistent" instruction.

## What remains preview-only

- Passport issuing (`POST /api/assessments/:assessmentId/passport` — backend stub,
  501)
- Passport revocation (`PATCH /api/passports/:passportId` — backend stub, 501;
  `LivePassportCard.tsx` shows plain copy, no button)
- Certification granting/revocation (backend has no route file for this at all yet)
- Public verification (`POST /api/passports/:passportId/verify` — backend stub, 501)
- `/certifications` and `/reports` — untouched by this sprint, still fully mock-backed
  in every mode, as before

## Schema assumptions

- `pbrs_passports.grade_snapshot` is trusted to already satisfy the DB's own
  `chk_pbrs_passports_grade` CHECK constraint (`'A'|'B'|'C'|'Hold'`).
  `LivePassportCard.tsx`'s `toSimpleGrade()` still defensively falls back to `'Hold'`
  for any unexpected string rather than crashing `GradeBadge`, since a
  constraint violation upstream (e.g. a future manual data fix) should degrade
  gracefully, not 500 the page.
- A passport with zero non-deleted `pbrs_certifications` rows is treated as "Pending
  Certification" (`certificationTier`/`certificationStatus` both `null`), mirroring
  the mock's existing `PhoenixPassport.certificationStatus` semantics.
- Only a certification row with `status = 'Certified'` is treated as "has an active
  certification" for the primary status line. `'Expiring Soon'`/`'Expired'`/`'Eligible'`/
  `'Not Eligible'` certification rows are not specially surfaced this sprint (their
  `certificationTier`/`certificationStatus` values are still returned to the caller,
  just not rendered with distinct UI treatment) — flagged as a known limitation, not
  silently dropped.
- No migration was required — `pbrs_passports` and `pbrs_certifications` already exist
  in `0001_initial_schema.sql` exactly as needed.

## Limitations

- Not tested against the real, live Supabase database or the live Vercel deployment —
  see the QA report's explicit scope.
- No pagination beyond a flat `LIMIT 100` (matches the existing `previewGetAssessments`
  precedent exactly — not a new limitation introduced by this sprint).
- `certificationLevel`/`certificationLevelLabel`/`internalTier` are derived
  client-side-equivalent (in the Server Component render, not stored) from
  `scoreSnapshot`/`certificationTier`/`certificationStatus` via
  `certification-levels.ts` — no PBRS scoring or threshold logic was duplicated or
  changed to do this.
- Real-dev and production-auth modes still have **no** live passport data source
  (the Express backend route is a 501 stub) — this was out of scope per the task
  brief, which named `vercel-supabase-preview` specifically.
