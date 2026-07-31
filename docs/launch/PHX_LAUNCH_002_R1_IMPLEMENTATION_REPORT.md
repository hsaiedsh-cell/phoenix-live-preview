# PHX-LAUNCH-002-R1 — Data Model and Intake Handoff Implementation Report

## Task

PHX-LAUNCH-002-R1 — Data Model and Intake Handoff Contract

## Status

**Implementation and database QA complete. Ready for final repository
verification and commit.**

## Objective

Define and implement the Backend-owned data boundary required to convert
one accepted Phoenix public-intake request into controlled tenant
provisioning records in a later revision.

R1 establishes the durable idempotency ledger and its database guarantees.
It does not implement the operator queue, provisioning endpoint, user
interface, invitation delivery, or identity-to-workspace resolution.

## Starting State

- Branch: `phx-launch-002`
- Starting commit:
  `98af3bd7f7a8a1f909f201ecbfa0c67ceebd8b5f`
- Previous completed revision:
  `PHX-LAUNCH-002-R0 — Release-State Reconciliation and Scope Baseline`
- Backend migrations present before R1: `0001` through `0006`
- No Backend tenant-provisioning implementation existed.
- Website intake and Backend tenant data remained separate bounded
  contexts.

## Implemented Changes

1. Added the approved data-model and intake-handoff contract:
   `docs/launch/PHX_LAUNCH_002_R1_DATA_MODEL_CONTRACT.md`.
2. Added Backend migration:
   `apps/backend/db/migrations/0007_intake_workspace_handoffs.sql`.
3. Added the Backend-owned `intake_workspace_handoffs` ledger.
4. Added the unique source idempotency boundary on
   `(source_system, source_reference)`.
5. Added foreign keys to Organization, Workspace, User, Membership, and
   the deferred nullable Assessment reference.
6. Added database checks for approved source system, request type,
   fingerprint format, source-reference format, lifecycle status, and
   Processing/Completed field consistency.
7. Added database-level trigger enforcement requiring every new row to
   begin as `Processing`.
8. Added one permitted atomic `Processing` to `Completed` transition.
9. Added permanent UPDATE and DELETE protection after completion.
10. Updated the Backend database schema baseline with the additive ledger,
    relationships, retention rules, and environment boundary.

## Migration 0007

- Filename: `0007_intake_workspace_handoffs.sql`
- SHA-256:
  `3999f5d8977722bf89f971c83b4807057f07b3090bd4156a46e16fc699740273`
- Columns: 15
- Registered constraints: 14
- Indexes: 6 including the primary-key index
- Trigger functions: 1
- Row-level triggers: 1
- Trigger events: `INSERT`, `UPDATE`, and `DELETE`

The migration contains schema only. It introduces no runtime API,
provisioning service, customer data, seed tenant, secret, or hosted
environment configuration.

## Database Execution Verification

Migration execution was validated against an isolated local PostgreSQL
16.14 database on a non-standard local port.

Verified results:

- migrations `0001` through `0007` applied successfully in order;
- exactly seven migration records were stored in `schema_migrations`;
- the registered Migration 0007 checksum matched the file checksum;
- the handoff table, columns, constraints, indexes, function, and trigger
  were present;
- rerunning the Backend migration runner skipped all seven migrations;
- migration replay did not create duplicate registry rows;
- the repository remained unchanged by database execution.

## Behavioral Constraint QA

The following database behaviors were proven:

- valid `Processing` insertion succeeds;
- direct `Completed` insertion is rejected;
- unsupported source system is rejected;
- unsupported request type is rejected;
- malformed or uppercase SHA-256 fingerprint is rejected;
- untrimmed and oversized source references are rejected;
- unsupported initial status is rejected;
- invalid provisioning-operator foreign key is rejected;
- a Processing row containing target identifiers is rejected;
- duplicate source identity is rejected;
- Processing-to-Processing UPDATE is rejected;
- deletion of a Processing row is rejected;
- backward `updated_at` movement is rejected;
- source identity mutation is rejected;
- incomplete completion is rejected;
- valid audited Processing-to-Completed transition succeeds;
- audit context remains valid JSON serialized into the existing TEXT
  column;
- update and deletion of a Completed row are rejected;
- referenced Membership, Workspace, and primary User deletion is
  restricted;
- failed statements leave no partial handoff rows;
- no authentication identity is created;
- no Assessment is created;
- `assessment_id` remains null and deferred.

## Concurrent Claim QA

Two PostgreSQL transactions attempted to insert the same source identity.

Observed result:

- Transaction A acquired the source claim and remained open.
- Transaction B waited approximately `4.893814` seconds on the unique-key
  owner.
- Transaction B inserted no duplicate row.
- The final database state contained exactly one source-claim row.
- Transaction A retained ownership.
- The clean migration-baseline database remained unchanged.
- The temporary concurrency-test database was removed.

This proves that concurrent duplicate claims converge through the
PostgreSQL unique source boundary without an application-memory lock.

## Data-Minimization Controls

The ledger does not store:

- first or last name;
- email address;
- company name;
- phone number or country;
- original intake message;
- consent metadata;
- IP or IP hash;
- upload credentials;
- file name, object key, MIME type, or file metadata.

The ledger stores only source identity, request classification, a
Backend-computed payload fingerprint, lifecycle state, target identifiers,
operator identifier, and timestamps.

## Scope Controls

R1 did not introduce:

- an operator request queue API;
- an operator interface;
- a tenant-provisioning endpoint;
- Organization, Workspace, User, or Membership provisioning services;
- invitation delivery or acceptance;
- Clerk or OIDC runtime changes;
- identity-to-workspace resolution;
- public registration or public Production access;
- Website database or Website runtime changes;
- cross-database foreign keys or distributed transactions;
- hosted database, deployment, DNS, secret, or provider changes;
- automated Assessment, PBRS, passport, certification, or report
  generation.

## Changed Files

- `docs/launch/PHX_LAUNCH_002_R1_DATA_MODEL_CONTRACT.md`
- `apps/backend/db/migrations/0007_intake_workspace_handoffs.sql`
- `apps/backend/db/schema/PHOENIX_DATABASE_SCHEMA_BASELINE.md`
- `docs/launch/PHX_LAUNCH_002_R1_IMPLEMENTATION_REPORT.md`

No Website, Platform UI, application runtime, dependency manifest,
environment file, or deployment file is included in the R1 change set.

## Acceptance Status

Completed before repository commit:

- contract completed and reconciled with the existing Backend schema;
- Migration 0007 implemented;
- clean PostgreSQL migration execution passed;
- migration replay passed;
- structural database verification passed;
- behavioral constraint QA passed;
- concurrent duplicate-claim QA passed;
- database schema baseline updated;
- changed-file scope remained controlled;
- no runtime provisioning route introduced;
- no Website runtime or migration changed;
- no secret or hosted-environment configuration changed.

Remaining closure actions:

- final repository allowlist and quality checks;
- commit the four approved R1 files;
- push the R1 commit to `origin/phx-launch-002`;
- confirm the branch is clean and synchronized.

## Outcome

PHX-LAUNCH-002 now has a tested Backend data boundary for controlled
private-beta tenant onboarding.

The handoff ledger provides durable source idempotency, transactional
completion evidence, referential protection, immutable completion state,
and database-level concurrent-claim serialization.

Runtime provisioning remains intentionally deferred.

## Next Revision

PHX-LAUNCH-002-R2 — Private Beta Operator Request Queue API
