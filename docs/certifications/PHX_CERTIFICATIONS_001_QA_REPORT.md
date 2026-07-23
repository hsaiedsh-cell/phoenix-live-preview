# PHX-CERTIFICATIONS-001 — QA & Security Report

All commands below were actually executed against the archive in this
sandbox. No result in this report is simulated or assumed.

## 1. Environment

- `pnpm@8.15.9` via `corepack enable && corepack prepare pnpm@8.15.9 --activate`
- `pnpm install --frozen-lockfile` — resolved 471 packages, lockfile
  unchanged, no dependency added or removed
- Node v22.22.2

## 2. Baseline verification (before any code change)

| Check | Command | Result |
|---|---|---|
| Backend type-check | `pnpm --filter=./apps/backend type-check` | Clean |
| Backend build | `pnpm --filter=./apps/backend build` | Clean |
| Platform type-check | `pnpm --filter=./apps/platform type-check` | Clean |
| Passports live-read symbol presence | `grep -rl` for `LivePassportCard`, `previewGetPassports`, `loadPassportsListData` | All three found, exactly as the task asked to confirm |
| Passports backend route | manual read of `routes/passports.ts` | Confirmed still the PHX-BACKEND-001 501 stub |
| Certifications baseline | manual read + `find`/`grep` across the tree | Confirmed stub route only; no `certifications.repository.ts`; mock-only page; no forward-references to work not yet done |

## 3. Post-implementation verification

| Check | Command | Result |
|---|---|---|
| Backend type-check | `pnpm --filter=./apps/backend type-check` | Clean — unaffected, as expected (no backend files touched) |
| Backend build | `pnpm --filter=./apps/backend build` | Clean |
| Platform type-check | `pnpm --filter=./apps/platform type-check` | Clean |
| Platform lint | `pnpm --filter=./apps/platform lint` (`next lint`) | `✔ No ESLint warnings or errors` |
| Platform build | `pnpm --filter=./apps/platform build` (`next build`, default `mock` mode) | Clean. `/certifications` compiles as a dynamic route (`ƒ`), same shape as `/passports`. 12/12 static pages generated. |

## 4. Scope-boundary verification

- `apps/backend/src/routes/certifications.ts` — MD5 checksum compared
  before/after: **unchanged**.
- No `apps/backend/src/repositories/certifications.repository.ts` exists —
  confirmed not created.
- `apps/backend/src/auth/permissions.ts` — unchanged; no new permission
  added (`assessment.read`, an existing permission already granted to all
  six roles, is reused).
- `apps/platform/src/lib/certification-levels.ts` and
  `docs/certification/PBRS_CERTIFICATION_THRESHOLD_ADDENDUM_PHX_CERT_003.md`
  — unchanged; no PBRS Certification Level / Internal Tier derivation
  logic was added or duplicated in the new code.
- Diffed the mock-mode branch of `certifications/page.tsx` against the
  original file's JSX: content is unchanged (only re-indented under the
  new `if (apiConfig.mode !== 'vercel-supabase-preview')` guard).

## 5. Security review — `previewGetCertifications()`

- **SQL injection:** parameterized query only (`$1`), no string
  concatenation. Matches the existing style of every other
  `preview-api-client.server.ts` function.
- **Authorization ordering:** matches `previewGetPassports()` exactly —
  workspace existence is checked (404) *before* permission is checked
  (403), so a non-existent workspace never leaks a permission-denied vs.
  not-found distinction to an unauthorized caller. Permission
  (`assessment.read`) is checked *before* the certifications query runs.
- **Data exposure:** the query joins `pbrs_certifications` →
  `pbrs_passports` → `assets`, scoped by `WHERE c.workspace_id = $1`, and
  excludes `deleted_at IS NOT NULL` rows — identical workspace-scoping and
  soft-delete handling to every other live read in this file. No
  cross-workspace data can be returned.
- **No new attack surface on the write side:** no route, no repository
  function, no mutation path was added. `certification.grant` remains
  reserved and unused.

## 6. What was NOT verified (honestly reported, not fabricated)

- **No live Supabase/Postgres smoke test.** This sandbox's network egress
  is restricted to a fixed allowlist (npm/pip/GitHub registries) and does
  not include Supabase or any Postgres host, so `previewGetCertifications()`
  has not been executed against a real, seeded `vercel-supabase-preview`
  database. It has been verified by:
  - Type-checking cleanly against the exact same `pg`/`BackendPaginatedResult`
    types `previewGetPassports()` uses.
  - Structural line-by-line comparison against `previewGetPassports()`,
    which the task confirmed already exists and (per its own header
    comments) has been through this exact live-verification process in a
    prior sprint.
  - Manual column-by-column check of the SQL against the
    `pbrs_certifications` / `pbrs_passports` / `assets` migration schema
    in `apps/backend/db/migrations/0001_initial_schema.sql`.
- No deployment was performed or claimed. No screenshot or browser-based
  visual QA was performed — this was a backend/data-layer and type-level
  verification only, consistent with the tools available in this sandbox.

## 7. Recommended follow-up verification (not performed here)

Before this is considered fully production-verified, someone with
Supabase/Clerk credentials and network access should:
1. Seed a `pbrs_certifications` row (with its parent `pbrs_passports` and
   `assets` rows) in a real preview database.
2. Load `/certifications` in `vercel-supabase-preview` mode as each of the
   six roles and confirm the row renders (all roles have `assessment.read`,
   so all six should see it).
3. Confirm the empty-state renders correctly for a workspace with zero
   certifications.
