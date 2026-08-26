# PHX-LAUNCH-002-R2 — Private Beta Operator Request Queue API Contract

## Status

Approved implementation contract for PHX-LAUNCH-002-R2.

This revision implements the protected operator request queue API.
It does not implement the operator interface, tenant provisioning,
onboarding invitations, identity-to-workspace resolution, or public
Production access.

## Objective

Provide an authenticated and role-gated API through which a Phoenix
operator can:

- search and filter Private Beta intake requests;
- read an authoritative request detail;
- read current status and timestamps;
- perform approved request-status actions;
- obtain an auditable record of each operator action.

## Bounded Context Decision

The Website intake database remains the authoritative source for:

- `public_intake_requests`;
- request lifecycle status;
- upload-session summary state;
- intake request events.

The Backend database remains the authoritative source for:

- Phoenix users;
- external identity mapping;
- `platform_role` authorization;
- future tenant provisioning and handoff records.

The Backend must not connect to `INTAKE_DATABASE_URL`, query Website
intake tables, create a cross-database foreign key, or attempt a
distributed transaction.

## Operator-Facing Trust Boundary

All operator-facing routes are implemented by the Phoenix Backend.

The Backend must perform the following sequence before returning or
mutating any intake-request data:

1. Resolve the request identity through the configured ActorResolver.
2. Verify the bearer token when `PHOENIX_AUTH_MODE=oidc-jwt`.
3. Require the Backend database to be available.
4. Resolve a non-deleted Phoenix `users` row.
5. Read `users.platform_role` from the Backend database.
6. Require `platform_role = SuperAdmin`.
7. Reject every other platform role with HTTP `403`.
8. Only then validate or forward the intake operation.

Workspace membership is not required for these global operations.
The queue exists before a customer Workspace may exist.

Client-supplied user identifiers, platform roles, workspace roles,
authorization claims, and development impersonation fields are not
accepted in request bodies.

## Global SuperAdmin Guard

R2 adds a global operations guard separate from the existing
workspace-scoped `requirePermission` path.

The guard must:

- resolve the actor source exactly once;
- fail closed when authentication is missing or invalid;
- call the existing Backend database availability guard;
- load `id`, `email`, `display_name`, and `platform_role` from `users`;
- ignore soft-deleted users;
- return HTTP `401` for an unresolved or deleted Phoenix user;
- return HTTP `403` for every role other than `SuperAdmin`;
- return only the authenticated database-derived operator identity.

The implementation may be named `requirePlatformSuperAdmin`.

## Service-to-Service Boundary

After operator authorization, the Backend communicates with dedicated
Website internal endpoints over HTTPS.

R2 introduces a dedicated service credential.

Website environment name:

- `INTAKE_SERVICE_SECRET`

Backend environment names:

- `PHOENIX_INTAKE_SERVICE_BASE_URL`
- `PHOENIX_INTAKE_SERVICE_SECRET`
- `PHOENIX_INTAKE_SERVICE_TIMEOUT_MS`

The Website and Backend secret values must match, but no secret value is
committed to the repository.

The existing `INTAKE_OPS_SECRET` must not be reused, aliased, accepted as
a fallback, or replaced. Existing CLI finalize and upload-session routes
remain unchanged.

## Internal Authentication Contract

Backend requests to the Website internal API use:

`Authorization: Bearer <PHOENIX_INTAKE_SERVICE_SECRET>`

Requirements:

- exact Bearer scheme;
- one authorization value only;
- non-empty configured secret;
- constant-time secret comparison;
- generic HTTP `401` response on failure;
- no secret value in logs, monitoring, errors, URLs, or response bodies;
- no fallback to `INTAKE_OPS_SECRET`.

The Backend forwards its correlation identifier through:

`X-Phoenix-Request-Id: <requestId>`

The Website may use the value only when it satisfies the bounded request-id
format; otherwise it generates a new identifier.

## Service Actor Attribution Header

For the internal status-action route only, the Backend forwards the
database-derived authorized operator UUID through:

`X-Phoenix-Actor-User-Id: <actorUserId>`

This header is service-to-service attribution data, not an authentication,
authorization, workspace, organization, or role claim.

The Website accepts the header only after the dedicated Bearer service
credential has been validated. The value must be one exact UUID header value.
Missing, malformed, whitespace-bearing, comma-joined, or duplicated values
fail closed with a generic internal HTTP `400` response.

The actor UUID:

- is derived only from the Backend `requirePlatformSuperAdmin` result;
- is attached only to internal status-action requests;
- is never accepted from public or browser routes;
- is never included in the strict JSON action body;
- is never used by the Website to infer a role or permission;
- may be included in Website logs only after service authentication succeeds;
- is written only to the minimal transactional operator event detail.

A Website actor-attribution failure is an internal service-contract failure.
The Backend maps it to generic `INTAKE_SERVICE_ERROR` / HTTP `502` and never
forwards the Website response body to the operator client.

## Public Backend Routes

R2 implements these Backend routes:

1. `POST /api/operations/intake-requests/query`
2. `GET /api/operations/intake-requests/:requestId`
3. `POST /api/operations/intake-requests/:requestId/actions`

Every route uses the shared Backend success or failure envelope and always
returns a request identifier.

## Internal Website Routes

R2 implements these Website service routes:

1. `POST /api/internal/operations/intake-requests/query`
2. `GET /api/internal/operations/intake-requests/:requestId`
3. `POST /api/internal/operations/intake-requests/:requestId/actions`

These routes are never called directly by browser code and never accept a
Phoenix user bearer token. They accept only the dedicated Backend service
credential.

## Query Route Contract

The operator-facing and internal query routes use HTTP POST so search terms
and customer identifiers do not appear in URLs, reverse-proxy access logs,
or browser history.

The request body is strict and accepts only:

```json
{
  "search": "optional text",
  "statuses": ["received", "under_review"],
  "requestTypes": ["assessment", "demo"],
  "createdFrom": "optional ISO-8601 timestamp",
  "createdTo": "optional ISO-8601 timestamp",
  "limit": 25,
  "cursor": "optional opaque cursor"
}
```

Validation rules:

- unknown properties are rejected;
- `search` is trimmed and limited to 200 characters;
- `statuses` contains unique approved intake statuses only;
- `requestTypes` contains unique approved request types only;
- `createdFrom` and `createdTo` are valid timestamps;
- `createdFrom` must not be later than `createdTo`;
- `limit` defaults to 25 and permits values from 1 through 100;
- `cursor` is bounded and structurally validated;
- an empty body is equivalent to the default newest-first queue.

## Search Semantics

The normalized search term may match:

- public reference;
- company;
- first name plus last name;
- normalized work email.

SQL is fully parameterized.

The implementation must escape `%`, `_`, and the chosen LIKE escape
character before constructing an `ILIKE` pattern. Client wildcard syntax
must not alter search semantics.

Search values and complete request bodies must not be logged.

## Filter Semantics

Approved statuses are:

- `received`
- `under_review`
- `upload_invited`
- `files_received`
- `quoted`
- `accepted`
- `rejected`
- `closed`

Approved request types are:

- `assessment`
- `demo`
- `general`

Multiple values within one filter are combined with OR.
Different filter categories are combined with AND.

## Ordering and Cursor Contract

Queue order is fixed:

1. `created_at DESC`
2. `id DESC`

Arbitrary client sorting is not supported in R2.

The cursor contains only the final row `createdAt` and request UUID in an
opaque base64url representation.

The decoded cursor must be validated as one timestamp and one UUID before
it is used in a parameterized keyset-pagination predicate.

The response contains:

```json
{
  "items": [],
  "total": 0,
  "nextCursor": null
}
```

## Queue Summary Projection

Each query result item contains only:

- `requestId`;
- `publicReference`;
- `status`;
- `requestType`;
- `company`;
- `createdAt`;
- `updatedAt`;
- `fileCount`;
- `uploadSessionStatus`.

The queue response must not contain:

- message;
- email;
- phone;
- country;
- consent fields;
- idempotency hashes;
- IP or IP hashes;
- upload tokens or token hashes;
- storage object keys;
- original file names;
- service credentials.

## Request Detail Contract

The `:requestId` parameter is the internal request UUID, never the public
reference.

The protected detail response may contain:

- request UUID and public reference;
- request type and authoritative status;
- first name and last name;
- normalized work email;
- company and role;
- optional phone, country, and estimated timeline;
- original intake message;
- created and updated timestamps;
- file count and upload-session status;
- structured operator-action history.

The detail response must not contain:

- privacy or terms consent versions;
- marketing-consent state;
- consent timestamp;
- idempotency-key hash;
- IP hash;
- upload token or token hash;
- reservation-key hash;
- storage object key;
- provider credentials;
- SQL or constraint details.

## Operator Action Route

The strict request body contains exactly:

```json
{
  "action": "under_review"
}
```

Approved action values are:

- `under_review`
- `reject`
- `quote`
- `accept`
- `close`

R2 does not accept:

- arbitrary target status;
- free-text notes;
- invitation issuance or revocation;
- provisioning commands;
- operator user identifiers from the browser;
- customer or tenant identifiers other than the request UUID path value.

## Authoritative Transition Rules

The existing Website lifecycle remains authoritative:

- `received` to `under_review`, `rejected`, or `closed`;
- `under_review` to `upload_invited`, `rejected`, `quoted`, or `closed`;
- `upload_invited` to `files_received`, `rejected`, or `closed`;
- `files_received` to `quoted`, `rejected`, or `closed`;
- `quoted` to `accepted`, `rejected`, or `closed`;
- `accepted` to `closed`;
- `rejected` to `closed`;
- `closed` to no later state.

R2 actions cannot create `upload_invited` or `files_received`. Those states
remain owned by the existing upload-session and upload-finalization flows.

## Transactional Operator Audit

An R2 status action runs inside one Website database transaction:

1. Lock the request row using `SELECT ... FOR UPDATE`.
2. Confirm the row exists.
3. Validate the current status and requested action.
4. Update the status with the locked current status predicate.
5. Insert `request.status_changed` into `public_intake_events`.
6. Commit once.

The event detail contains only:

```json
{
  "actorUserId": "uuid",
  "source": "phoenix_backend",
  "from": "quoted",
  "to": "accepted"
}
```

For `reject` and `close`, the existing specific event may also be inserted
in the same transaction using the same minimal actor context.

The Backend supplies `actorUserId` to the Website only after authenticating
the operator, requiring the database-derived `SuperAdmin` platform role, and
placing that UUID in `X-Phoenix-Actor-User-Id` on the dedicated internal
status-action request. The action JSON body remains exactly action-only.

The pre-provisioning action audit belongs in `public_intake_events`.
Backend `audit_records` is workspace-scoped and must not be used before a
Workspace exists.

No external email, storage, monitoring, or network call may execute while
the Website database transaction is open.

## Concurrency Contract

Concurrent actions against the same request serialize on the locked request
row.

Exactly one transition may commit from a given starting status.
A competing action that observes a later status returns HTTP `409` and does
not append a false action event.

No application-memory lock is permitted.

## Backend Service Client

The Backend service client must:

- use the configured fixed base URL;
- build only fixed internal route templates;
- attach the dedicated Bearer service credential;
- attach the Backend request identifier;
- attach `X-Phoenix-Actor-User-Id` from the database-derived authorized
  operator only for status-action requests;
- use an AbortController timeout;
- default the timeout to 5000 milliseconds;
- validate every Website response before forwarding data;
- never log request bodies, response bodies, URLs with customer data,
  authorization headers, or service configuration;
- perform no automatic retry for status-action requests.

The Backend must not forward an arbitrary Website response body directly to
the operator client.

## Failure Mapping

Backend operator routes use these outcomes:

- HTTP `400`: malformed body, query, cursor, or request UUID;
- HTTP `401`: missing, invalid, or unresolved authentication;
- HTTP `403`: authenticated Phoenix user is not a `SuperAdmin`;
- HTTP `404`: authorized lookup targets no intake request;
- HTTP `409`: invalid or concurrently lost status transition;
- HTTP `422`: structurally valid but unsupported operation value;
- HTTP `503`: Backend database or Website intake service unavailable;
- HTTP `502`: Website service returned an invalid or unexpected response;
- HTTP `500`: sanitized unexpected Backend failure.

A Website internal-authentication failure is an internal service
misconfiguration. The Backend maps it to a generic service-unavailable
failure and never returns the internal authentication response verbatim.

Failure responses must not expose:

- whether a request exists before authorization;
- service URLs or secrets;
- SQL, constraint names, or stack traces;
- submitted search values;
- customer identity data;
- Website internal response bodies.

## Stable Backend Error Codes

R2 adds stable codes for:

- `INTAKE_SERVICE_UNAVAILABLE`
- `INTAKE_SERVICE_ERROR`

Existing `AUTH_REQUIRED`, `AUTH_INVALID`, `FORBIDDEN`,
`VALIDATION_ERROR`, `NOT_FOUND`, `CONFLICT`, `DATABASE_UNAVAILABLE`, and
`INTERNAL_ERROR` codes remain unchanged.

## Privacy-Safe Logging

Backend and Website logs may include only:

- request identifier;
- fixed route template;
- HTTP status;
- bounded outcome code;
- duration;
- operator user UUID after successful authorization;
- request UUID after an authorized operation.

Logs and monitoring must not include:

- request body;
- search text;
- public reference;
- company, name, email, phone, country, role, or message;
- cursor contents;
- event detail;
- tokens, cookies, authorization headers, or secrets;
- full outbound URL;
- SQL text or parameters.

Metrics use bounded labels only. User, request, customer, and tenant
identifiers are not metric labels.

## R2 Implementation Surface

Expected Website implementation files include:

- internal query, detail, and action route handlers;
- strict R2 validation schemas;
- dedicated service-auth helper;
- queue repository projections and keyset pagination;
- transactional operator-action service.

Expected Backend implementation files include:

- global SuperAdmin authorization guard;
- platform-role repository projection;
- intake service configuration;
- intake service client;
- operations intake route module;
- route registration;
- stable service error codes.

R2 may add environment-variable names with empty example values.
No real value is committed.

## R2 Explicit Exclusions

R2 does not implement:

- the R3 operator user interface;
- the R4 intake-to-workspace provisioning endpoint;
- Organization, Workspace, User, or Membership creation;
- writes to `intake_workspace_handoffs`;
- upload invitation issuance or revocation through the new API;
- the R5 onboarding invitation lifecycle;
- the R6 identity-to-workspace resolver;
- public registration;
- a direct Backend connection to the Website database;
- a cross-database transaction;
- Production secrets, DNS, or public launch.

## Required QA

R2 acceptance requires proof that:

1. missing operator authentication returns `401`;
2. invalid bearer authentication returns `401`;
3. an unresolved or deleted Phoenix user returns `401`;
4. `StandardUser` and `ServiceAccount` return `403`;
5. `SuperAdmin` can query and read the queue;
6. Backend database unavailability returns `503`;
7. missing service configuration returns `503`;
8. direct Website internal calls without the service secret return `401`;
9. `INTAKE_OPS_SECRET` is not accepted by the new service routes;
10. search and filter validation fail closed;
11. queue responses exclude sensitive fields;
12. detail responses exclude hashes, tokens, storage keys, and consent data;
13. an approved status action commits its audit event atomically;
14. an invalid transition returns `409` with no event;
15. concurrent competing actions permit exactly one committed transition;
16. outbound timeout and malformed-service-response paths are sanitized;
17. no secret, body, customer data, or search term reaches logs;
18. all existing Website intake and Backend route behavior remains valid;
19. root type-check, lint, and build pass;
20. the final changed-file allowlist is reviewed before commit.

## R2 Acceptance Gate

R2 is complete only when:

1. this contract is implemented;
2. the Backend operator routes are authenticated and SuperAdmin-gated;
3. the Website remains the authoritative request-status owner;
4. the dedicated service credential is enforced without fallback;
5. queue search, filters, detail, and approved actions work;
6. operator actions are transactionally auditable;
7. unauthorized users cannot infer or read request data;
8. no direct cross-database access is introduced;
9. required QA and repository quality checks pass;
10. the branch is clean and synchronized after the R2 commit.

## Next Revision

After R2 closure, execution proceeds to:

`PHX-LAUNCH-002-R3 — Protected Operator Interface`
