# Release Notes — PHX-CERTIFICATIONS-001

**Live Certifications List (preview mode)**

## What changed

- `/certifications` now renders live data from `pbrs_certifications` in
  `vercel-supabase-preview` mode, read directly from Supabase/Postgres
  (no separate Express backend call). Every other mode is unchanged.
- Added `previewGetCertifications()`, `loadCertificationsListData()`, and
  `LiveCertificationsTable`, following the exact architectural pattern
  established by PHX-PASSPORTS-001's `previewGetPassports()` /
  `loadPassportsListData()` / `LivePassportCard`.

## What was preserved

- `apps/backend/src/routes/certifications.ts` — unchanged, still a
  PHX-BACKEND-001 stub. No live Express endpoint exists for certifications
  yet, same as passports.
- The mock-mode `/certifications` page content — unchanged, byte-for-byte
  the same JSX as before this sprint.
- `certification-levels.ts` and the PBRS Certification Level / Internal
  Tier threshold model — untouched. PBRS remains locked to the approved
  six-dimension model (Accuracy, Compliance, Brand Alignment, Structure,
  Consistency, Completeness).
- The permission model — no new permission was introduced;
  `assessment.read` (already granted to all six roles) is reused.
- Certification granting, revocation, and public verification remain
  preview-only in every mode, including `vercel-supabase-preview`.

## Limitations

- Live certifications are visible only in `vercel-supabase-preview` mode.
  `real-dev` and `production-auth` will keep showing the mock-backed page
  until a future sprint adds an actual backend Express route + repository.
- "Eligible Assets" and "Expiring Soon" stat cards, and per-level asset
  counts on the Certification Level cards, are not shown in live mode —
  they require assessment-score-threshold matching across the whole
  workspace, which this sprint does not migrate.
- No pagination on the live list (matches Passports' existing `LIMIT 100`).
- No live database smoke test was performed in the sandbox this was built
  in (no network path to a real Supabase instance) — see the QA Report's
  §6–§7 for what was and wasn't verified, and the recommended follow-up.

## Next recommended sprint

**PHX-BACKEND-010 — Certifications Live Endpoint (real-dev /
production-auth).** Implement the actual `GET /api/workspaces/
:workspaceId/certifications` Express route and a
`certifications.repository.ts`, matching the same read shape
`previewGetCertifications()` already returns, so `real-dev` and
`production-auth` modes stop falling back to mock data for this page —
closing the gap this sprint (and PHX-PASSPORTS-001 before it) left open by
migrating only the `vercel-supabase-preview` path.

An alternative/later sprint: real Clerk browser sign-in QA
(PHX-AUTH-003B) against a seeded `vercel-supabase-preview` database, to
perform the live verification this sprint's QA Report flags as not yet
done for `previewGetCertifications()`.
