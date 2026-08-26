# PHX-LAUNCH-002-R8 — Private Beta Operations and Recovery Runbook

## Operating Boundary

Private Beta remains invite-only. Operators must use authenticated, role-gated
routes; customer data must not be copied into tickets, chat, or application
logs. Public registration, Production launch, DNS changes, and Production
secrets remain outside this release authorization.

## Monitoring

- Monitor health/readiness, authentication failure rate, invitation delivery
  failures, and unexpected 5xx responses by request ID.
- Treat audit records as the authoritative history for provisioning and
  invitation lifecycle actions.
- Never log bearer tokens, invitation tokens, request bodies, raw Clerk errors,
  provider secrets, or customer identity payloads.
- Investigate using request IDs and sanitized event names. Access to database
  records must follow least privilege.

## Incident Response

1. Contain: disable the affected invitation or operator account and preserve
   audit evidence. Do not delete records during triage.
2. Assess: identify affected workspace IDs, action names, and time window using
   audit records; do not export unrelated customer data.
3. Recover: revoke and reissue invitations when token exposure is suspected;
   suspend affected memberships when account access is uncertain.
4. Rotate any provider credential that may have been exposed and restart only
   after configuration validation passes.
5. Verify: test unauthorized, cross-workspace, and intended authorized access.
6. Record the incident decision and customer-notification owner outside the
   application without copying secrets or raw payloads.

## Backup and Restore

Before onboarding the first hosted Private Beta customer, the environment owner
must enable provider-managed PostgreSQL backups and perform a disposable restore
drill. The drill must record the source backup timestamp, destination isolation,
migration level, row-count checks for organizations/workspaces/memberships/
invitations/audit records, and an application readiness check.

Never restore over the active database for a drill. Restore into an isolated
non-production destination, use non-production credentials, verify access is
contained, then destroy the destination according to the provider retention
policy. A backup that has not passed a restore drill is not accepted as recovery
evidence.

## Onboarding Recovery

- Delivery failure: preserve the failed invitation record, revoke it, then issue
  a new invitation. Never resend or reveal the original token.
- Expired invitation: issue through the supported reissue flow; do not edit
  expiry timestamps manually.
- Wrong recipient or suspected token exposure: revoke immediately, confirm the
  membership has not become Active, correct the target identity, then reissue.
- Partial provisioning: retry the idempotent provisioning operation. Do not
  manually duplicate organization, workspace, or membership rows.
- Identity mismatch: do not auto-provision a new user. Verify the Clerk subject,
  verified email, `auth_identities` mapping, and Active membership separately.

## Release-Candidate Gate

The hosted Private Beta may receive Go authorization only when all of the
following have recorded evidence: real hosted Clerk sign-in and backend token
verification, cross-workspace denial, provider delivery, backup/restore drill,
monitoring visibility, secret/configuration review, and an operator walkthrough
of revoke/reissue and incident containment.

Any missing item is a No-Go. Public Production remains No-Go regardless of the
Private Beta decision.
