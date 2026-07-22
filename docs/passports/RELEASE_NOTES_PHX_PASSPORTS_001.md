# Release Notes — PHX-PASSPORTS-001 — Live Passport Endpoint Foundation RC1

## Summary

Converts the `/passports` page from always-mock-backed to live Supabase/Postgres-read
in `vercel-supabase-preview` mode only. Every other mode (`mock`, `real-dev`,
`real-disabled`, `production-auth`) is unchanged — those modes have no live passport
data source to read from yet, since `apps/backend/src/routes/passports.ts` remains a
PHX-BACKEND-001 stub (all routes 501). This is a **read-only foundation**: passport
issuing, revocation, certification granting, report export, and public verification
are explicitly out of scope and remain preview-only, as directed.

This package was built and locally verified (install/type-check/lint/build) against
the operator-uploaded source export of `hsaiedsh-cell/phoenix-live-preview`. **It was
not deployed from this environment** — see "Deployment" below.

## Added

- `previewGetPassports(workspaceId)` in `lib/preview-api-client.server.ts` — a
  server-only, parameterized-SQL read of `pbrs_passports` (joined with `assets` for
  the asset name, and left-joined via `LATERAL` with the passport's most recent
  non-deleted `pbrs_certifications` row, if any). Gated on the `assessment.read`
  permission (see Implementation Report for why — there is no dedicated
  `passport.read` permission in the current matrix).
- `loadPassportsListData()` in `lib/platform-data-source.ts` — the same
  mock/live/config-missing/backend-unavailable/permission-denied/not-found status
  resolution every other migrated read surface uses, scoped so only
  `vercel-supabase-preview` mode is treated as live-capable for passports.
- `BackendPassport` type in `lib/real-api-client.ts`.
- `LivePassportCard.tsx` — a new component rendering a live passport row: passport
  ID, asset name, grade, score, certification status/level (derived via
  `certification-levels.ts`, no PBRS logic duplicated), valid-until date (via a safe
  `formatPreviewDate()` guard — never a raw `.slice()` on an unguarded value),
  record hash, and explicit preview-only copy for issuing/revocation/verification
  actions (no button wired to any write action for live data).

## Changed

- `app/(platform)/passports/page.tsx` — now branches on API mode. For
  `vercel-supabase-preview`, shows a `Live backend data` badge, a total count, the
  existing PBRS certification safe-disclaimer (when at least one passport is
  certified), and a graceful empty state when the live query returns zero rows. For
  every other mode, the page's mock-backed rendering is unchanged.

## Preserved

- Mock mode's passport page: identical data, identical JSX, identical copy.
- `real-dev`, `real-disabled`, `production-auth` modes: still render the existing
  mock-backed passport page (no live source available for those modes this sprint).
- `/certifications` and `/reports`: untouched, still fully mock-backed in every mode.
- `/dashboard`, `/assessments`, `/assessments/[id]`, `/settings`: untouched — confirmed
  via a full source-tree diff scoped to exactly the five files this sprint changed.
- PBRS model: still locked to the approved six scored dimensions (Accuracy 20%,
  Compliance 20%, Brand Alignment 15%, Structure 15%, Consistency 15%,
  Completeness 15%); Business Logic and Clarity remain deprecated and do not appear
  anywhere in this change. No scoring logic, dimension weights, or certification
  thresholds were touched.

## Known limitations

- **Not deployed.** This build was produced and verified in a sandboxed local
  environment with no access to the operator's GitHub repo, Vercel project, Supabase
  database, or Clerk application. The operator must apply the included patch (or copy
  `updated-files/` over the repo), commit, and push to
  `hsaiedsh-cell/phoenix-live-preview` (`main`) to trigger the Vercel redeploy.
- **Not tested against live data.** All QA in this package is source-level
  (type-check/lint/build/static review) — see
  `PHX_PASSPORTS_001_QA_REPORT.md` for the explicit list of what still needs a live
  pass after deployment (in particular: a real signed-in Clerk session resolving to
  the one seeded `pbrs_passports` row the task brief describes).
- Passport list is capped at a flat `LIMIT 100`, matching the existing
  `previewGetAssessments` precedent — no cursor-based pagination yet.
- The `assessment.read` permission gate for passport reads is a documented assumption,
  not a confirmed match to any real backend endpoint (none exists yet).
- Certification statuses other than `'Certified'` (e.g. `'Expiring Soon'`,
  `'Expired'`) are returned by the query but not given distinct UI treatment this
  sprint.

## Production launch status

**No-Go.** This remains a controlled hosted preview. No production-readiness claim is
made by this release. Public verification, passport issuing/revocation, and
certification granting are all still preview-only or unimplemented.

## Recommended next sprint

**PHX-CERTIFICATIONS-001 — Live Certification Read Foundation**, following the same
pattern established here: a `previewGetCertifications()` read against
`pbrs_certifications` (already queried indirectly by this sprint's `LATERAL` join, but
not yet exposed as its own `/certifications` list), gated by whatever permission that
page's reviewer confirms is appropriate, with the same explicit non-data states.
