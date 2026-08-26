# PHX-LAUNCH-002-R4 — Workspace and Membership Provisioning Contract

## Status

Runtime implementation contract derived from the approved R1 data-model and
handoff contract. R1 migration `0007_intake_workspace_handoffs.sql` remains the
schema authority; R4 adds no migration.

## Endpoint

`POST /api/operations/intake-workspace-handoffs`

The route authenticates and requires the database-owned `SuperAdmin` platform
role before validating or provisioning. Operator identity is derived only from
the authenticated Backend actor.

## Atomic Outcome

One Backend transaction claims the source identity, creates exactly one
Organization and Workspace, resolves or creates the primary user, creates an
`Invited` Owner membership, appends the minimal audit record, and completes the
handoff ledger. Any error rolls the complete transaction back.

Same-fingerprint replay returns the stored identifiers without creating target
or audit records. A different fingerprint, ServiceAccount email, unexpected
membership conflict, or exhausted deterministic identifier attempts returns a
sanitized conflict.

## Data Derivation

Organization codes and workspace slugs follow the deterministic SHA-256
algorithms in the R1 contract. The Backend computes the fixed-order source
fingerprint. Client-supplied ids, roles, statuses, settings, fingerprints, and
operator attribution are rejected by the strict request schema.

## Exclusions

R4 does not create an Assessment, send an invitation, resolve hosted identities
to memberships, call the Website database, deploy secrets, or launch Production.
