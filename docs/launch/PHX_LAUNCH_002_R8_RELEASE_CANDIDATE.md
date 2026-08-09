# PHX-LAUNCH-002-R8 — Release Candidate Decision

## Local Candidate

R0–R7 implementation is present on `phx-launch-002`. Local type-check, lint,
build, database lifecycle QA, and signed OIDC/JWKS delta verification are the
candidate evidence set. R8 removes raw Clerk SDK errors from Platform logs and
adds the operational, incident, and recovery gate.

## Decision

- Local implementation candidate: **Ready for hosted validation**.
- Hosted Private Beta: **No-Go pending external evidence**.
- Public Production: **No-Go; outside scope**.

The hosted No-Go is not a code-test failure. Current execution lacks fresh Clerk
credentials and provider access, so it cannot honestly claim the required live
Clerk browser rerun, invitation-provider delivery, monitoring ingestion, or a
provider-managed backup/restore drill.

## Evidence Required to Change Hosted Status

1. Real Clerk browser sign-in and Phoenix backend JWT verification.
2. Identity mapping to the intended user and Active workspace membership.
3. Authorized workspace access succeeds and cross-workspace access fails.
4. Invitation delivery, acceptance, expiry, revocation, and reissue are observed
   against the hosted providers without exposing a token.
5. Privacy-safe monitoring receives test failures using request IDs only.
6. A provider-managed backup is restored into an isolated environment and the
   application readiness and critical row-count checks pass.
7. The operator runbook walkthrough is recorded and a named release owner makes
   the separate Go/No-Go decision.

Until every item is evidenced, keep registration closed and access invite-only.

## Hosted Validation — 2026-08-09

The PR #6 Vercel deployments for Website and Platform both reached `READY` and
were protected by Vercel Authentication. Browser verification established:

- the Website home and contact form rendered without console errors;
- the Platform rejected an anonymous request to the operator route;
- the Clerk sign-in UI loaded and public sign-up did not open a registration
  flow;
- a real Clerk session reached `/dashboard` and resolved the configured
  `Acme Enterprise Workspace` preview identity.

The hosted pass also found two remaining blockers. The Supabase connection
failed with a tenant/host lookup error, so live database reads did not pass.
Before this correction the raw provider error was rendered in the UI; the R8
privacy regression now forces a stable generic customer message instead. Also,
the operator page correctly reports that its API is unavailable in
`vercel-supabase-preview`; a hosted `production-auth` Platform plus Backend is
still required for the R2/R3/R6/R7 end-to-end path.

Accordingly, the Hosted Private Beta decision remains **No-Go**. This validation
does not claim successful Supabase reads, hosted Backend OIDC, operator actions,
invitation-provider delivery, monitoring ingestion, or backup/restore.

### Supabase follow-up — 2026-08-09

The referenced `phoenix-free-live-preview` project was found paused and was
resumed. Its database credential was then rotated, the Platform
`PHOENIX_DATABASE_URL` was updated for **Preview only** to the Supabase
transaction pooler, and the Platform Preview was redeployed. No Production
environment value was changed.

The fresh hosted deployment passed authenticated live reads for:

- `/dashboard` — four database-backed assessments and derived summary counts;
- `/assessments` — four database-backed assessment rows; and
- `/settings` — three activity records and one immutable audit record.

No browser console errors or raw provider/database details were present. This
closes the Supabase live-read blocker recorded above. Hosted Private Beta remains
**No-Go** because the hosted `production-auth` Backend/OIDC/operator path,
invitation-provider delivery, monitoring ingestion, and backup/restore drill are
still not evidenced.
