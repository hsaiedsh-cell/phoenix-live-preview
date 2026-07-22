# Release Notes — PHX-PLATFORM-011-R1 (Server-Side Production Auth Token & Live Backend Verification Fix)

## What changed

**Fix 1 — production-auth live reads were completely broken and are now fixed.**
PHX-PLATFORM-011 migrated `/dashboard`, `/assessments`,
`/assessments/[id]`, and `/settings` to read live backend data from
Server Components, but the code path they used to get a production-auth
bearer token only worked in a browser (`window.Clerk.session.getToken()`).
Called from a Server Component, it always failed — meaning
**production-auth live reads never actually worked, even with a valid
signed-in session.** `real-api-client.ts` is now split into a shared
file, a server-only file (used by every migrated page, resolves the
token via a real server-side Clerk session check), and a client-only
file (for future client-side reads, unused this sprint). Real-dev is
unaffected — it never depended on the browser.

**Fix 2 — several live data field names were wrong and are now corrected.**
Standing up a real database and backend for the first time (see below)
found that PHX-PLATFORM-011 had guessed several backend response field
names from raw SQL column names instead of the backend's actual JSON
output. In particular:
- The live assessments list **does** include each assessment's score,
  grade, and risk level — PHX-PLATFORM-011 had said it did not. The
  dashboard and assessments list now show this.
- Field names across workspace, assessment, activity, and audit data
  were corrected to match the backend exactly (camelCase, correct
  names) — pages that read live data were silently rendering `undefined`
  for several fields before this fix.
- Audit records have no actor display name available live (only a raw
  user id) — the audit list now shows that id rather than a name it has
  no way to look up.

**Live backend verification — actually performed this session.**
PHX-PLATFORM-011 shipped without ever running against a real backend.
This release:
- Installed PostgreSQL, ran the approved backend's migrations and seed
  data, and started it in dev-header mode.
- Built and ran the platform in real-dev mode against that live backend.
- Confirmed by direct HTTP request that `/assessments`,
  `/assessments/[id]`, and `/dashboard` render real seeded data (not
  mock fixture names).
- Confirmed that `/settings` shows real activity/audit data for a seed
  Owner user, and a clear "permission required" message (not audit
  data) for a seed Viewer user who lacks that permission.
- Confirmed that stopping the backend produces a clear "backend
  unavailable" message on every migrated page — never mock data, never
  a blank page.

## What was preserved

- `mock` mode is unchanged.
- `real-dev` still sends only `X-Phoenix-User-Id`; `production-auth`
  still sends only `Authorization: Bearer` — confirmed by code and by
  the live verification run.
- No token is ever stored in `localStorage`/`sessionStorage`.
- Mock, real-dev, and production-auth modes all still exist; Clerk
  integration is unchanged.
- Passport/Certification/Report endpoints remain unconnected.
- No PBRS dimension, weight, or certification threshold was changed.

## What was NOT completed

- **Real Clerk end-to-end sign-in was not performed.** This requires a
  real (even free-tier) Clerk account, which remains out of scope. The
  production-auth server-side token path is verified by code review,
  type-checking, and a full build matrix (mock, real-dev,
  production-auth with fake-format config, production-auth with no
  config) — not by an actual signed-in browser session reaching a real
  backend.
- The live verification performed used a single seeded workspace and
  six seed users (one per role) — it is a correctness check, not a load
  test or a multi-workspace test.

## Limitations

- Dashboard's "Scored (this page)" stat is a count over the loaded
  page of assessments, not a true workspace-wide total — computing that
  correctly would require paging through every assessment.
- The PostgreSQL/backend/platform processes used for this session's
  live verification are not part of this deliverable and do not
  persist.

This sprint does not launch Phoenix publicly. No PBRS, scoring, or
certification-threshold change was made.
