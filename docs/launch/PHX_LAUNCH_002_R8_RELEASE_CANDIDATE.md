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

### Backend/OIDC/operator follow-up — 2026-08-09

The isolated Preview environment was subsequently completed with a dedicated
hosted Backend, a `production-auth` Platform, Clerk's audience-bound
`phoenix-backend` JWT template, Supabase transaction-pooler access, and the
bounded Website intake service connection. Production configuration was not
changed.

Fresh hosted browser evidence now confirms:

- a real Clerk session reaches the hosted Backend and resolves the database-owned
  `Acme Enterprise Workspace` Active membership through `GET /api/me/workspaces`;
- `/dashboard` reads four assessments from that resolved workspace without a
  browser-supplied workspace, membership, user, or role claim;
- the protected operator queue reads a real Preview intake request and records
  the `received -> under_review -> quoted -> accepted` lifecycle;
- the accepted request provisions one organization, workspace, StandardUser,
  invited Owner membership, and audit record; an immediate replay returns the
  same workspace rather than duplicating resources;
- migrations `0007_intake_workspace_handoffs.sql` and
  `0008_onboarding_invitations.sql` are present in the Preview database;
- invitation issuance, revocation, and reissue execute through the protected
  hosted routes without returning or rendering a raw token; and
- the undeliverable fake-recipient test invitation was revoked after the test,
  leaving no live invitation from the walkthrough.

The invitation delivery rows correctly recorded `Failed`: no R5 email provider
credentials were configured and the recipient was deliberately non-deliverable.
This is failure-path evidence only, not provider-delivery approval.

Hosted Private Beta therefore remains **No-Go**. The still-open evidence is:

1. an explicit authenticated cross-workspace denial check;
2. successful provider delivery followed by hosted acceptance and an observed
   expiry case, without token exposure;
3. privacy-safe monitoring ingestion keyed only by request IDs;
4. a provider-managed backup restored into an isolated environment with
   readiness and critical row-count checks; and
5. a recorded operator walkthrough plus a named release owner's separate
   Go/No-Go decision.

### Invitation-provider delivery and acceptance follow-up — 2026-08-09

A dedicated Resend sending credential, restricted to the verified
`send.phoenixops.ai` domain, was configured on the hosted Backend for the
`phx-launch-002` Preview branch only. Production configuration was not changed.

Fresh hosted browser evidence for request `PHX-REQ-FRR7UV7S7U8Y` confirms:

- the operator recorded the `received -> under_review -> quoted -> accepted`
  lifecycle and provisioned workspace `b33e42aa-cff6-4a19-8207-d93bc827b915`;
- the Backend issued an onboarding invitation and recorded its provider
  delivery as `Sent` without returning or rendering the raw token;
- the message arrived in the authorized recipient mailbox and its invitation
  link opened the hosted Preview acceptance route; and
- the acceptance route displayed `Invitation accepted`, activated the bound
  workspace membership, and removed the consumed invitation controls from the
  refreshed operator detail.

This closes the successful provider-delivery and hosted-acceptance portions of
evidence item 4. The expiry case remains open; no expiry was simulated by
editing provider or database state.

Hosted Private Beta remains **No-Go**. The still-open evidence is now:

1. an explicit authenticated cross-workspace denial check;
2. an observed hosted invitation-expiry case without token exposure;
3. privacy-safe monitoring ingestion keyed only by request IDs;
4. a provider-managed backup restored into an isolated environment with
   readiness and critical row-count checks; and
5. a recorded operator walkthrough plus a named release owner's separate
   Go/No-Go decision.

### Hosted invitation-expiry follow-up — 2026-08-09

An isolated expired invitation row was created in the Supabase Preview database
for the already-active delivery-validation membership. Its timestamps were set
in the past at insert time, preserving the database rule that expiry must be
later than creation. No Production data was changed and the raw token was not
printed, stored in the database, or exposed in browser output.

Fresh hosted acceptance evidence confirms:

- the acceptance page removed the token fragment from the browser URL before
  completing validation;
- the hosted Backend rejected the expired invitation and the Platform rendered
  the privacy-safe `Invitation unavailable` response rather than provider,
  token, or database detail;
- the invitation transitioned atomically from `Issued` to `Expired`; and
- the already-active workspace membership remained `Active`.

This closes the hosted expiry portion of evidence item 4. Provider delivery,
acceptance, expiry, revocation, and reissue have now all been observed in the
isolated Preview environment without raw-token exposure.

Hosted Private Beta remains **No-Go**. The still-open evidence is now:

1. an explicit authenticated cross-workspace denial check;
2. privacy-safe monitoring ingestion keyed only by request IDs;
3. a provider-managed backup restored into an isolated environment with
   readiness and critical row-count checks; and
4. a recorded operator walkthrough plus a named release owner's separate
   Go/No-Go decision.

### Hosted cross-workspace denial follow-up — 2026-08-09

A temporary Clerk development-instance secret key was created solely to mint a
short-lived `phoenix-backend` JWT for the already-authenticated Preview user.
The key was held in a mode-`0600` temporary file, the file was removed
automatically after the request pair, and the Clerk key itself was deleted
immediately after verification. No key or JWT was printed or committed, and no
Production configuration was changed.

The same JWT produced the following hosted Backend results:

- `GET /api/workspaces/00000003-1111-4111-8111-000000000001/assessments`
  returned `200` with the four assessments belonging to the user's Active
  `Acme Enterprise Workspace` membership; and
- `GET /api/workspaces/b33e42aa-cff6-4a19-8207-d93bc827b915/assessments`
  returned `403 FORBIDDEN` for the separate onboarding-delivery workspace.

This closes the explicit authenticated cross-workspace denial evidence item.
The Backend derived authorization from the verified Clerk identity and its
database-owned membership; changing only the workspace path did not widen
access.

Hosted Private Beta remains **No-Go**. The still-open evidence is now:

1. privacy-safe monitoring ingestion keyed only by request IDs;
2. a provider-managed backup restored into an isolated environment with
   readiness and critical row-count checks; and
3. a recorded operator walkthrough plus a named release owner's separate
   Go/No-Go decision.

### Privacy-safe monitoring follow-up — 2026-08-09

The hosted Website Preview branch was connected to the dedicated Sentry project
`phoenix-website-preview` using a sensitive `SENTRY_DSN` override scoped only to
`phx-launch-002`. Production configuration was not changed. The Website Preview
was rebuilt after the configuration change.

A temporary branch-only operations credential was used to exercise the hosted
error path without creating or modifying an intake row. The test supplied an
invalid non-record identifier to the internal finalize route, which produced the
expected generic `500` response and request ID
`5a6d15fd-11c4-4523-a641-f539482c0539`. Sentry received the grouped
`SanitizedInternalError` event in environment `vercel-preview` with the same
request ID and only the expected privacy-safe custom tags:

- `errorCategory=intake_persistence`;
- `safeErrorCode=DatabaseError`; and
- the sanitized route template.

The Sentry event did not contain the request body, customer identity, database
message, credential, or raw intake identifier. The temporary operations
credential was then removed from the branch, all local secret files were
deleted, and the Website Preview was rebuilt again with the inherited operations
configuration. Both temporary read-only Sentry personal tokens were revoked.
The branch-specific `SENTRY_DSN` remains configured.

This closes the privacy-safe monitoring-ingestion evidence item. Hosted Private
Beta remains **No-Go**. The still-open evidence is now:

1. a provider-managed backup restored into an isolated environment with
   readiness and critical row-count checks; and
2. a recorded operator walkthrough plus a named release owner's separate
   Go/No-Go decision.

### Provider-managed backup limitation — 2026-08-09

The Supabase dashboard confirmed that `phoenix-free-live-preview` is on the Free
Plan and has no provider-managed backups. Supabase's isolated
`Restore to new project` workflow requires a Pro Plan with physical backups;
the displayed Pro price starts at USD 25 per month, before any applicable
project-compute charges.

The environment owner elected to continue on the Free Plan without upgrading.
No subscription, billing, Production configuration, database, or project was
changed. A manual export/restore is not claimed as equivalent evidence because
R8 explicitly requires a provider-managed backup restored into an isolated
environment.

This gate therefore remains unmet and the Hosted Private Beta decision remains
**No-Go**. The remaining release-governance action is to record the operator
walkthrough and name the release owner who accepts this No-Go decision. A future
Go decision still requires upgrading or moving to a provider configuration that
supports managed backups, waiting for a real backup, and completing the isolated
restore drill defined in the operations runbook.

### Operator walkthrough and release-owner decision — 2026-08-09

The hosted Preview walkthrough recorded the following operator and containment
paths without changing Production configuration or opening public registration:

- authenticated, role-gated access to the intake request queue;
- request lifecycle handling from `received` through provisioning;
- invitation delivery, acceptance, expiry, revocation, and reissue without raw
  token exposure;
- idempotent provisioning and duplicate-operation containment;
- authorized workspace access and explicit cross-workspace denial;
- investigation of a sanitized hosted failure by request ID in Sentry; and
- cleanup of temporary credentials, test-only branch configuration, and local
  secret files.

The incident-response walkthrough applies the runbook sequence: contain the
affected invitation or operator identity, preserve audit evidence, assess the
bounded workspace/action/time window, revoke and reissue exposed invitations,
rotate affected provider credentials, and reverify unauthorized,
cross-workspace, and intended authorized access before resuming operations.

**Release owner:** Hossam Said — Phoenix Release Owner

**Hosted Private Beta decision:** **No-Go**

**Public Production decision:** **No-Go; outside this release scope**

The named release owner accepts the current No-Go because the Free Plan has no
provider-managed backup and the required isolated restore drill has not been
performed. Reconsideration requires recorded evidence of a real managed backup,
an isolated restore, migration-level and critical row-count checks, application
readiness, and destruction or approved retention of the disposable destination.

This completes the operator-walkthrough and named-owner governance record. R8
remains incomplete only on the provider-managed backup/restore gate; no Hosted
Private Beta Go authorization is granted.

### First provider-managed restore drill — 2026-08-09

After the organization was upgraded to Supabase Pro, the dashboard exposed a
completed physical backup with source timestamp `2026-08-08 22:26:54 UTC`.
Supabase restored that provider-managed backup into the isolated Tokyo-region
project `phoenix-r8-restore-drill-20260809` (project reference
`qujxhhrqgdrfcsndrgaq`). The confirmation screen reported zero additional
monthly compute and disk cost for the restored Nano project. A generated
database password that appeared in automation output was rejected before use
and rotated; only the replacement credential was submitted to create the
project.

The provider restore completed and the destination returned online. Read-only
SQL checks found the following restored baseline row counts:

- organizations: 1;
- workspaces: 1;
- workspace users: 6;
- audit records: 1;
- auth identities: 1; and
- assessments: 4.

The restore mechanism therefore worked, but the available backup predates the
current PHX-LAUNCH-002 schema and data. The restored destination had no Website
migration table, public intake tables, intake workspace handoffs, onboarding
invitations, or onboarding invitation deliveries. By comparison, the active
source contained two Website migrations, two public intake requests, three
organizations, three workspaces, eight workspace users, four onboarding
invitations, ten audit records, and four assessments at verification time.

Application readiness for the current release consequently failed at the
migration/schema gate; this drill is **not** accepted as recovery evidence and
does not change the No-Go decision. The isolated destination was permanently
deleted after verification, leaving the active source project unchanged.

The next drill must use a provider-managed backup created after the current
schema and data were present, then repeat migration-level, critical row-count,
and application-readiness checks before a new release-owner decision.

### Preview PostgREST hardening — 2026-08-09

The Supabase Security Advisor review found that the Backend-owned public-schema
tables inherited Data API grants for `anon` and `authenticated` and did not have
RLS enabled. Migration `0009_postgrest_security_hardening.sql` now fails those
tables closed by enabling RLS, revoking both roles' table privileges, revoking
their default privileges on future tables, and fixing the two trigger
functions' mutable `search_path` settings. The `citext` extension remains in
`public`; moving it is tracked as a separate compatibility change.

The hosted Preview schema predates two report-worker tables, so the migration
secures every listed table that exists and relies on the default-privilege
revocation for tables created later. Hosted verification returned 25 existing
Backend tables, 25 with RLS enabled, zero grants for `anon` or `authenticated`,
and both trigger functions with the fixed search path. Backend `/health` and
`/api/readiness` both returned HTTP 200 after the change, and the Website
contact page continued to render its intake form. The Platform preview remains
behind Vercel deployment protection for anonymous HTTP checks.

This hardening closes the direct PostgREST exposure but does not change the R8
No-Go decision: an accepted provider-managed restore drill from a current
backup is still required.
