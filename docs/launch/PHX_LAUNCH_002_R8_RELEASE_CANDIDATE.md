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
