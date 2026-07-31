# PHX-LAUNCH-002-R1 — Data Model and Intake Handoff Contract

## Status

- Contract status: Approved for implementation
- Branch: `phx-launch-002`
- Starting commit: `98af3bd7f7a8a1f909f201ecbfa0c67ceebd8b5f`
- Planned Backend migration: `0007_intake_workspace_handoffs.sql`

## Objective

Define an explicit, transactional, idempotent boundary for converting an
accepted Phoenix public-intake request into a controlled Private Beta
organization, workspace, user, and invited workspace membership.

## Bounded Context Decision

The Website intake database and the Phoenix Backend tenant database are
separate bounded contexts.

The implementation must not use:

- cross-database foreign keys;
- Backend reads from Website intake tables;
- Website writes to Backend tenant tables;
- distributed transactions;
- shared assumptions about physical database deployment.

The Website sends a minimal authenticated handoff command to the Backend.
The Backend owns all tenant provisioning and its transaction boundary.

## Source Eligibility

A handoff is eligible only when the authoritative Website request status is
`accepted`.

The handoff command contains only:

- `sourceReference`
- `sourceStatus` (`accepted` only)
- `requestType` (`assessment`, `demo`, or `general`)
- `company`
- `firstName`
- `lastName`
- `workEmail`

It must not contain the original message, phone number, IP hash, consent
metadata, upload token, storage object key, or file metadata.

## Target Ledger

The Backend will own an immutable-after-completion table named
`intake_workspace_handoffs`.

Required columns:

- `id UUID PRIMARY KEY`
- `source_system TEXT NOT NULL`
- `source_reference TEXT NOT NULL`
- `source_request_type TEXT NOT NULL`
- `source_payload_fingerprint TEXT NOT NULL`
- `status TEXT NOT NULL`
- `organization_id UUID NULL`
- `workspace_id UUID NULL`
- `primary_user_id UUID NULL`
- `membership_id UUID NULL`
- `assessment_id UUID NULL`
- `created_by_user_id UUID NOT NULL`
- `completed_at TIMESTAMPTZ NULL`
- `created_at TIMESTAMPTZ NOT NULL`
- `updated_at TIMESTAMPTZ NOT NULL`

The unique idempotency boundary is:

`UNIQUE (source_system, source_reference)`

## Required Database Constraints

The migration must enforce the following constraints:

- `source_system` is limited to the approved value
  `phoenix_public_intake`.
- `source_reference` must be non-empty and no longer than 100 characters.
- `source_request_type` permits only `assessment`, `demo`, or `general`.
- `source_payload_fingerprint` is a lowercase 64-character SHA-256 hex
  digest.
- `status` permits only `Processing` or `Completed`.
- `(source_system, source_reference)` is unique.
- `organization_id` references `organizations(id)` with `ON DELETE RESTRICT`.
- `workspace_id` references `workspaces(id)` with `ON DELETE RESTRICT`.
- `primary_user_id` references `users(id)` with `ON DELETE RESTRICT`.
- `membership_id` references `workspace_users(id)` with
  `ON DELETE RESTRICT`.
- `assessment_id` references `assessments(id)` with `ON DELETE RESTRICT`.
- `created_by_user_id` references `users(id)` with `ON DELETE RESTRICT`.

Completion consistency must be enforced:

- `Processing` requires all target identifiers and `completed_at` to be
  null.
- `Completed` requires `organization_id`, `workspace_id`,
  `primary_user_id`, `membership_id`, and `completed_at` to be non-null.
- `assessment_id` remains nullable because an Assessment requires an Asset
  and Asset Version that do not exist at initial onboarding.

Required indexes:

- unique index on `(source_system, source_reference)`;
- index on `status`;
- index on `workspace_id`;
- index on `primary_user_id`;
- index on `created_at`.

## Canonical Payload Fingerprint

The Backend computes the fingerprint. It must never trust a fingerprint
provided by the caller.

The canonical payload contains these keys in this fixed order:

1. `sourceReference`
2. `sourceStatus`
3. `requestType`
4. `company`
5. `firstName`
6. `lastName`
7. `workEmail`

Normalization rules:

- trim leading and trailing whitespace from every string;
- normalize `workEmail` to lowercase;
- preserve internal whitespace in names and company text;
- serialize the normalized object using fixed key order;
- calculate lowercase SHA-256 hexadecimal output.

The fingerprint is used only for replay and conflict detection. It is not
an authentication credential.

## Transaction and Concurrency Algorithm

1. Authenticate the internal caller and authorize the operator before
   opening a database transaction.
2. Validate that `sourceStatus` is exactly `accepted`.
3. Normalize the command and compute the Backend-owned fingerprint.
4. Start one Backend PostgreSQL transaction using `withTransaction()`.
5. Attempt to insert the handoff ledger row in `Processing` status using
   `INSERT ... ON CONFLICT DO NOTHING`.
6. When the insert does not return a row, select the existing handoff using
   `(source_system, source_reference) FOR UPDATE`.
7. PostgreSQL must serialize concurrent duplicate execution on the unique
   key; no application-memory lock is permitted.
8. When the existing fingerprint differs, return a conflict and create no
   tenant records.
9. When the existing row is `Completed` with the same fingerprint, return
   the stored target identifiers as an idempotent replay.
10. When this transaction owns the new `Processing` row, provision all
    target records using the same transaction-scoped `PoolClient`.
11. Update the ledger to `Completed` only after every target write and the
    audit record have succeeded.
12. Commit once.

Any error before commit rolls back the ledger claim and every target write.
R1 does not persist a partial tenant or a durable `Failed` handoff row.
A corrected command may therefore be retried safely.

## Organization Provisioning Rules

Each new source handoff creates one new Phoenix Organization.

The implementation must not automatically merge organizations based on:

- company-name similarity;
- email domain;
- contact email;
- normalized spelling;
- an existing workspace with a similar name.

Only replay of the same `(source_system, source_reference)` may return an
existing provisioned organization.

Organization fields:

- `name`: normalized `company` value;
- `primary_contact_email`: normalized `workEmail`;
- `industry`: null during initial handoff;
- `org_code`: generated deterministically from the source identity.

The canonical `org_code` algorithm is:

1. Build `sourceKey` as
   `phoenix_public_intake:<sourceReference>`.
2. Calculate SHA-256 over `sourceKey`.
3. Use `PHX` followed by the first nine uppercase hexadecimal characters.
4. The resulting value is exactly 12 characters.
5. If the unique organization-code constraint reports a collision with an
   unrelated record, retry using SHA-256 of `sourceKey:<attempt>`.
6. Attempts are deterministic, begin at `1`, and are bounded at `16`.
7. Exhausting all attempts aborts and rolls back the transaction.

Random or timestamp-based organization codes are not permitted.

## Workspace Provisioning Rules

Each new handoff creates one Workspace under the newly created
Organization.

Workspace fields:

- `organization_id`: the newly created Organization identifier;
- `name`: `<normalized company> Private Beta`;
- `slug`: deterministic company stem plus a source-derived suffix;
- `settings`: the existing schema default `{}`.

The canonical workspace-slug algorithm is:

1. Lowercase the normalized company value.
2. Replace every sequence outside `[a-z0-9]` with one hyphen.
3. Collapse repeated hyphens and trim leading or trailing hyphens.
4. Truncate the resulting stem to 48 characters.
5. Use `workspace` when the sanitized stem is empty.
6. Append a hyphen and the first eight lowercase hexadecimal characters
   of SHA-256 over `sourceKey`.
7. On an unrelated slug collision, derive the suffix from
   `sourceKey:<attempt>` using deterministic attempts `1` through `16`.
8. Exhausting all attempts aborts and rolls back the transaction.

The implementation must not select or reuse a workspace merely because its
name or slug resembles the requested company.

## Primary User Resolution

The primary user is resolved by normalized email inside the provisioning
transaction.

Resolution rules:

1. Normalize `workEmail` by trimming and lowercasing it.
2. Look for one active `users` row with the normalized email.
3. When an active `StandardUser` exists, reuse it without changing its
   platform role or display name.
4. When an active `SuperAdmin` exists, reuse it without downgrading it.
5. An active `ServiceAccount` must not become the customer Owner; abort the
   transaction with a conflict.
6. A soft-deleted user is not automatically restored by onboarding.
7. When no active user exists, create a `StandardUser`.

A newly created user has:

- `email`: normalized `workEmail`;
- `display_name`: normalized `<firstName> <lastName>`;
- `platform_role`: `StandardUser`;
- `avatar_url`: null;
- `last_login_at`: null.

Concurrent creation must rely on the existing active-email unique index.
A uniqueness race must be resolved inside the transaction by selecting the
winning active user and applying the same role checks.

## Initial Workspace Membership

The primary user receives one Workspace membership with:

- `role`: `Owner`;
- `status`: `Invited`;
- `invited_by_user_id`: the authenticated provisioning operator;
- `workspace_id`: the newly provisioned Workspace;
- `user_id`: the resolved primary user.

The membership is not `Active` until the controlled invitation lifecycle
is accepted in PHX-LAUNCH-002-R5.

An unexpected active membership conflict must abort the transaction. The
handoff implementation must not overwrite, reactivate, suspend, or change
the role of an existing membership.

## Provisioning Operator

The provisioning command must be executed by an authenticated active
Phoenix user whose `platform_role` is `SuperAdmin`.

The operator user identifier is stored as `created_by_user_id` and as
`workspace_users.invited_by_user_id`.

Client-supplied operator identifiers, development actor headers, and
anonymous provisioning are not permitted.

## Audit Contract

Before the ledger is marked `Completed`, the same transaction must append
one workspace-scoped audit record.

Audit record requirements:

- `workspace_id`: newly provisioned Workspace;
- `actor_user_id`: authenticated provisioning operator;
- `action`: `workspace.provisioned_from_intake`;
- `entity_type`: `Workspace`;
- `entity_id`: newly provisioned Workspace;
- `changes`: identifiers and non-sensitive state transitions only;
- `context`: a compact JSON object serialized into the existing `TEXT`
  column, containing exactly `sourceSystem`, `sourceReference`, and
  `requestType`.

The serialized audit context remains text. R1 does not alter the existing
`audit_records.context` column or any other `audit_records` schema.

The audit record must not include email, names, phone, message, consent
metadata, IP data, upload credentials, filenames, or storage keys.

## Assessment Deferral

The initial handoff does not create an Assessment.

The ledger stores `assessment_id = null` because the existing Assessment
schema requires a valid Workspace Asset, Asset Version, and requesting
user.

Creating a placeholder Asset, placeholder Asset Version, synthetic file,
or empty Assessment solely to satisfy foreign keys is prohibited.

Any later Assessment creation must use the normal workspace-scoped
Assessment workflow after a real Asset and Asset Version exist.

## Provisioning API Contract

The planned R4 transport contract is:

`POST /api/operations/intake-workspace-handoffs`

The endpoint is an authenticated internal operations endpoint. It is not a
public onboarding, registration, or customer self-service endpoint.

The request body contains exactly:

```json
{
  "sourceReference": "PHX-REQ-EXAMPLE",
  "sourceStatus": "accepted",
  "requestType": "assessment",
  "company": "Example Company",
  "firstName": "Example",
  "lastName": "Owner",
  "workEmail": "owner@example.com"
}
```

The request must not accept:

- `operatorUserId`;
- `organizationId`;
- `workspaceId`;
- `userId`;
- `membershipId`;
- `assessmentId`;
- `sourcePayloadFingerprint`;
- a requested platform role or workspace role;
- a requested membership status;
- arbitrary workspace settings.

All target identifiers, roles, statuses, codes, slugs, and fingerprints are
derived by the Backend.

## Authentication and Authorization

The Backend must:

1. verify the bearer token using the configured production OIDC/JWT path;
2. resolve the verified external identity to a Phoenix `users` row;
3. reject a missing, deleted, or unresolved Phoenix user;
4. require the resolved user to have `platform_role = SuperAdmin`;
5. derive `created_by_user_id` exclusively from the resolved identity.

Authorization happens before tenant provisioning begins.

Development actor headers, static operator identifiers, email-based operator
impersonation, and client-controlled authorization claims are prohibited.

## Success Outcomes

### Created

HTTP `201` is returned when a new handoff is provisioned and committed.

```json
{
  "outcome": "created",
  "handoffId": "uuid",
  "organizationId": "uuid",
  "workspaceId": "uuid",
  "primaryUserId": "uuid",
  "membershipId": "uuid",
  "assessmentId": null
}
```

### Idempotent Replay

HTTP `200` is returned when the same source identity and same canonical
payload were already completed.

The response uses the same target identifiers and sets:

`"outcome": "replayed"`

A replay must not create another Organization, Workspace, User, Membership,
or audit record.

## Failure Outcomes

- HTTP `400`: malformed JSON or structurally invalid request.
- HTTP `401`: missing, invalid, or unverifiable authentication.
- HTTP `403`: authenticated user is not an active Phoenix `SuperAdmin`.
- HTTP `409`: source reference exists with a different payload fingerprint.
- HTTP `409`: normalized email belongs to an active `ServiceAccount`.
- HTTP `409`: an unexpected conflicting Workspace membership exists.
- HTTP `409`: deterministic organization-code or slug attempts are
  exhausted.
- HTTP `422`: `sourceStatus` is not exactly `accepted`.
- HTTP `503`: Backend database is disabled or unavailable.
- HTTP `500`: unexpected internal failure after safe error sanitization.

Failure responses contain only a stable error code and request identifier.
They must not expose SQL, constraint names, stack traces, submitted identity
data, or existing tenant details.

## Privacy and Data Minimization

The Backend persists only the tenant data required by the approved handoff.

The handoff ledger must not persist:

- first name or last name;
- email address;
- company name;
- phone number;
- country;
- original request message;
- consent versions or timestamps;
- marketing-consent state;
- IP or IP hash;
- upload-session tokens or hashes;
- file names, object keys, MIME types, or file metadata.

Names, email, and company are written only to the existing target tenant
tables where they are operationally required.

The source payload fingerprint is not reversible and must not be treated as
a substitute identifier for the customer.

## Logging and Monitoring Contract

Application logs and monitoring may include:

- request identifier;
- route template;
- HTTP status;
- normalized outcome code;
- duration;
- handoff UUID after successful persistence.

Application logs and monitoring must not include:

- request body;
- source public reference;
- payload fingerprint;
- company or personal names;
- email address;
- Organization, Workspace, User, or Membership display data;
- bearer tokens, JWT claims, cookies, or authorization headers;
- SQL text, SQL parameters, connection strings, or constraint details.

Metrics must use bounded labels only. Tenant identifiers, source references,
emails, and handoff identifiers must not be metric labels.

Sentry events must pass through the existing privacy sanitization path and
must expose only the route template and generic operational context.

## Completed-Row Immutability

A completed handoff is permanent release evidence for one source request.

Every new ledger row must be inserted with `status = Processing`. Direct
insertion of a `Completed` row is prohibited.

After `status = Completed`:

- the row must not return to `Processing`;
- source identity and fingerprint fields must not change;
- target identifiers must not change;
- `created_by_user_id` must not change;
- `completed_at` must not change;
- the row must not be deleted or soft-deleted;
- replay must remain read-only.

The migration must enforce completed-row immutability at the database level
with a trigger that rejects UPDATE and DELETE operations after completion.

The trigger must also reject changes to these fields while a row is still
`Processing`:

- `source_system`;
- `source_reference`;
- `source_request_type`;
- `source_payload_fingerprint`;
- `created_by_user_id`;
- `created_at`.

The only approved lifecycle update is the atomic transition from
`Processing` to `Completed` that sets the target identifiers,
`completed_at`, and `updated_at` in the provisioning transaction.

`assessment_id` remains null permanently for the initial handoff row.
A later Assessment must not mutate the completed handoff ledger.

## Migration 0007 Contract

Migration `0007_intake_workspace_handoffs.sql` must:

1. create `intake_workspace_handoffs`;
2. create all approved foreign keys and check constraints;
3. create the unique source-identity index;
4. create the required operational indexes;
5. enforce Processing and Completed field consistency;
6. create the immutability trigger function and trigger;
7. use the existing UUID, timestamp, and soft-delete conventions where
   applicable;
8. contain no seed customer data;
9. contain no secrets, credentials, emails, names, or source references;
10. avoid modifying existing Organization, Workspace, User, Membership,
    Assessment, authentication, PBRS, report, passport, or certification
    columns and constraints.

The migration must be executed by the existing migration runner in one
transaction and recorded in `schema_migrations`.

No direct SQL execution against a hosted environment is authorized as part
of contract drafting.

## Migration Verification Matrix

The implementation must prove:

- a valid `Processing` row can be inserted inside a transaction;
- direct insertion of a `Completed` row is rejected;
- duplicate `(source_system, source_reference)` insertion is rejected or
  converges through `ON CONFLICT` handling;
- an unsupported source system is rejected;
- an unsupported request type is rejected;
- a malformed fingerprint is rejected;
- an unsupported status is rejected;
- `Completed` without every required target identifier is rejected;
- `Processing` with a target identifier or `completed_at` is rejected;
- valid `Processing` to `Completed` transition succeeds;
- completed-row UPDATE is rejected;
- completed-row DELETE is rejected;
- source identity mutation is rejected;
- invalid foreign-key identifiers are rejected;
- deleting referenced tenant records is restricted as specified;
- existing migrations and seeded Backend behavior remain unaffected.

Concurrency verification must include two transactions attempting the same
source identity and must demonstrate that only one provisioning owner can
proceed.

## R1 Implementation Boundary

PHX-LAUNCH-002-R1 implements only:

- this approved data-model and handoff contract;
- Backend migration `0007_intake_workspace_handoffs.sql`;
- database-level migration QA;
- the relevant database-schema baseline update;
- an R1 implementation report.

R1 does not implement:

- the operator request queue API;
- the operator interface;
- the provisioning endpoint;
- Organization or Workspace repository creation functions;
- User or Membership provisioning services;
- onboarding invitation delivery or acceptance;
- Clerk sign-in verification;
- identity-to-workspace resolution;
- public registration;
- public Production access.

The runtime provisioning endpoint remains assigned to
PHX-LAUNCH-002-R4.

## R1 Acceptance Gate

R1 is complete only when:

1. this contract is committed;
2. Migration 0007 implements this contract exactly;
3. migration and constraint QA pass against a clean PostgreSQL database;
4. all existing Backend migrations continue to apply in order;
5. the database schema baseline is updated;
6. no runtime provisioning route is introduced;
7. no Website migration or runtime file is changed;
8. no secret or hosted-environment configuration is changed;
9. the changed-file allowlist passes;
10. the branch is clean and synchronized after the R1 commit.

## Next Revision

After R1 closure, execution proceeds to:

`PHX-LAUNCH-002-R2 — Private Beta Operator Request Queue API`
