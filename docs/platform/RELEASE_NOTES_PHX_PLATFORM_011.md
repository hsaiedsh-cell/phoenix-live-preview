# Release Notes — PHX-PLATFORM-011 (Live Read Migration for Production Auth)

## What changed

Phoenix Platform's `/dashboard`, `/assessments`, `/assessments/[id]`,
and `/settings` (activity/audit preview) now read from the real Phoenix
backend in `real-dev` and `production-auth` modes, instead of always
rendering mock fixture data. `mock` mode is unchanged.

- **Dashboard:** total assessment count, status breakdown, and recent
  assessments now come from the live backend in real-dev/
  production-auth. Score-based stat cards (overall readiness, average
  confidence, certified assets, dimension grid) are not shown in this
  mode — the backend's assessment list endpoint doesn't return score
  data — and the page says so explicitly rather than showing fabricated
  numbers.
- **Assessments list:** renders live backend rows (title, status,
  created date) in real-dev/production-auth.
- **Assessment detail:** renders the live assessment's PBRS score (all
  six dimensions, risk/confidence/automation-readiness signals — an
  exact passthrough of the backend's already-computed score, no
  scoring logic added), evidence list, and status. Audit trail/activity
  are omitted with an explicit label — the backend only exposes
  workspace-level activity/audit today, not assessment-scoped (that's
  planned for PHX-BACKEND-009B).
- **Settings:** the Audit Preview panel now shows live workspace
  activity and audit records in real-dev/production-auth, respecting
  the backend's own `audit.read` permission — a Viewer/Contributor
  identity sees a clear "permission required" message, not empty or
  fake data.
- **Passports, Certifications, Reports:** unchanged behavior — still
  mock-backed in every mode, since no live endpoint exists for them
  yet. Each now shows a small "Preview-only" notice when running in
  real-dev/production-auth, so this is never mistaken for live data.
- The production-auth mock-data transparency banner (added in
  PHX-PLATFORM-010-R1) now names exactly which pages are live and
  which three remain preview-only, instead of a blanket "some data is
  still mock-backed" statement that would no longer be accurate.
- Fixed a bug in the real API client: it was not correctly unwrapping
  the backend's standard `{ ok, data, error, requestId }` response
  envelope. This had no visible effect before this sprint (no page was
  reading live data yet) but is corrected now that pages depend on it.
- Fixed a build correctness issue: the newly-live pages could have been
  statically generated at build time (freezing a single snapshot of
  data, or a build-time "unavailable" state, into the page forever)
  rather than fetching fresh data on every request. All four migrated
  pages are now explicitly rendered per-request.

## What was preserved

- `mock` mode's data and rendering are byte-for-byte unchanged on every
  migrated page.
- `real-dev` continues to send only the development-only
  `X-Phoenix-User-Id` header; `production-auth` continues to send only
  a Clerk-issued `Authorization: Bearer` token. Neither mode sends the
  other's header — verified by code and by grep (see QA report).
- No token is ever stored in `localStorage`/`sessionStorage`.
- Passport/Certification governance actions (issue, revoke, grant,
  revoke) remain unsupported outside mock mode — unchanged from
  PHX-PLATFORM-009/010.
- No PBRS dimension, weight, or certification threshold was changed.
  PBRS remains locked to the approved six-dimension model (Accuracy,
  Compliance, Brand Alignment, Structure, Consistency, Completeness).
- No backend source file was modified in this sprint.

## Limitations

- `production-auth` mode needs a new, explicitly interim environment
  variable — `NEXT_PUBLIC_PHOENIX_PRODUCTION_WORKSPACE_ID` — to know
  which workspace to scope live reads to. The backend does not yet
  expose a way to resolve a signed-in user's workspace membership; that
  is planned, separate future work. Until a deployment sets this var,
  every migrated live section shows a clear "not configured" state
  rather than guessing.
- Dashboard's live view is limited to what the assessment list endpoint
  returns (no live score-based stats yet).
- Assessments list has no live filter controls this sprint (status is
  the only field the live endpoint returns that could be filtered on).
- No real Clerk account or live backend/database round-trip was
  exercised this session — QA is static/type/build/code-review level,
  consistent with prior platform sprints. See the QA report for the
  exact live-verification steps a future session with a running
  backend should perform.

## Next recommended sprint

**PHX-BACKEND-009B — Assessment-Scoped Activity & Audit Read
Endpoints** remains the natural next backend sprint if assessment
detail's audit/activity gap (Task 6 above) is to be closed. On the
platform side, extending live reads to Passports/Certifications/Reports
depends on those backend endpoints existing first — there is no
platform-side follow-up item until then.

PBRS remains locked to the approved six-dimension model (Accuracy,
Compliance, Brand Alignment, Structure, Consistency, Completeness).
There is no PBRS Standard alignment sprint outstanding.

This sprint does not launch Phoenix publicly.
