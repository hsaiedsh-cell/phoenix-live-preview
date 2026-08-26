# PHX-LAUNCH-002 — Private Beta Operations & Controlled Onboarding

## Status

- Phase status: Approved for execution
- Target: Protected Private Beta
- Base release: `phx-launch-001-private-beta`
- Base merge commit: `c041ba0759cb3e385758d910c590046273d9adfd`
- Working branch: `phx-launch-002`

## Objective

Establish the controlled operational layer required to onboard and manage
Private Beta customers securely, beginning with an approved public intake
request and ending with an authenticated user accessing only their authorized
Phoenix workspace.

## Scope

### 1. Release-state reconciliation

Update PHX-LAUNCH-001 documentation so that it accurately records the final
merged, tagged, deployed, provider-tested, and access-contained release state.

### 2. Protected operator access

Provide a role-gated operator experience for reviewing and managing Private
Beta requests.

### 3. Private Beta request queue

Provide searchable and filterable request records, authoritative statuses,
timestamps, and auditable operator actions.

### 4. Intake-to-workspace handoff

Convert an approved intake request into the corresponding Phoenix organization,
workspace, membership, and initial assessment context.

The conversion must be explicit, transactional, idempotent, and safe against
concurrent duplicate execution.

### 5. Controlled onboarding

Provide invitation issuance, delivery, acceptance, expiry, revocation, and
safe reissue behavior.

### 6. Identity-to-workspace resolution

Replace the static production workspace bridge with real workspace membership
resolution for the authenticated identity.

### 7. Real hosted verification

Verify a real Clerk sign-in, OIDC/JWT backend authentication, Phoenix identity
mapping, workspace membership resolution, and workspace-scoped authorization.

### 8. Operations and monitoring

Provide privacy-safe monitoring, audit records, recovery procedures, and
operator runbooks.

## Out of Scope

- Public Production launch
- Public or unrestricted registration
- Production DNS or `phoenixops.ai`
- Billing and subscriptions
- Automated PBRS scoring
- Passport issuance
- Certification granting
- Unrestricted customer onboarding
- Migration of report artifacts to cloud object storage

## Acceptance Criteria

1. Operator routes are authenticated and role-gated.
2. Unauthorized users cannot access request or customer data.
3. An approved request can be converted exactly once.
4. Workspace and membership provisioning is transactional.
5. Onboarding invitations are auditable, expirable, revocable, and reissuable.
6. An authenticated identity resolves its actual Phoenix workspace memberships.
7. Cross-workspace access attempts fail closed.
8. Real Clerk-to-Backend OIDC/JWT authentication passes end-to-end.
9. Secrets, tokens, request bodies, and private identity data do not reach logs
   or monitoring.
10. Production access remains contained until a separate launch authorization.

## Execution Sequence

- R0 — Documentation reconciliation and scope baseline
- R1 — Data model and intake handoff contract
- R2 — Operator request queue API
- R3 — Protected operator interface
- R4 — Workspace and membership provisioning
- R5 — Onboarding invitation lifecycle
- R6 — Identity-to-workspace resolution
- R7 — Real Clerk/OIDC end-to-end verification
- R8 — Security, recovery, runbooks, and Release Candidate

## Governance

All implementation must occur on `phx-launch-002`.

No merge into `main`, public Production launch, Production secrets, DNS changes,
or unrestricted onboarding is authorized without a separate reviewed Go/No-Go
decision.
