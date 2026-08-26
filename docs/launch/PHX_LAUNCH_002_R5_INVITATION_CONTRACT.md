# PHX-LAUNCH-002-R5 — Controlled Onboarding Invitation Contract

## Objective

Provide an auditable, expirable, revocable, and safely reissuable onboarding
invitation lifecycle for the `Invited` Owner membership created by R4.

## Security Model

Invitation tokens are 32-byte cryptographically random bearer credentials. Only
the SHA-256 token hash is persisted. Raw tokens must never appear in logs,
monitoring, audit records, database rows, URLs stored by Phoenix, or API response
errors. A raw token may exist only during issuance/delivery and acceptance.

Issuance, revocation, and reissue are authenticated operations restricted to the
database-owned `SuperAdmin` platform role. Acceptance requires one valid raw
token and activates only the membership bound to that invitation.

## Persistence

Migration `0008_onboarding_invitations.sql` adds:

- `onboarding_invitations`: immutable invitation identity, membership/user/
  workspace binding, token hash, lifecycle timestamps, issuer/revoker attribution,
  expiry, and a reissue chain;
- `onboarding_invitation_deliveries`: bounded delivery state and attempts without
  message bodies, email addresses, provider payloads, or raw provider errors.

At most one unexpired `Issued` invitation may exist for one active membership.
Terminal invitations are immutable. Reissue revokes the previous invitation and
creates a new invitation in one Backend transaction.

## Lifecycle

- `Issued` → `Accepted`, `Revoked`, or `Expired`;
- `Accepted`, `Revoked`, and `Expired` are terminal;
- acceptance and membership `Invited` → `Active` happen in one transaction;
- revocation does not delete or activate the membership;
- expiry is based on the database clock, not browser time;
- reissue never reuses a token or token hash.

## Delivery

Every issuance creates one `Pending` delivery row. A separately bounded delivery
adapter may mark it `Sent` or `Failed`. Delivery failure never activates a
membership and never exposes the token through logs or persisted error bodies.

## Explicit Exclusions

R5 does not resolve a signed-in hosted identity to workspace memberships (R6),
permit public registration, create a second membership, change roles, or launch
Production access.
