# PHX-LAUNCH-002-R3 — Protected Operator Interface Contract

## Objective

Provide a private Phoenix Platform interface through which an authenticated
platform `SuperAdmin` can search, inspect, and perform approved lifecycle actions
on Private Beta intake requests through the R2 Backend API.

## Security Boundary

The interface is not an authorization boundary. Every read and action calls the
R2 Backend routes, which authenticate the identity and re-check the database-owned
`platform_role`. The browser must never send an actor id, platform role, workspace
role, service credential, or Website-internal URL.

The interface is available only in `real-dev` and `production-auth` API modes.
It must not fall back to mock intake data after configuration, authentication,
authorization, network, or service failures.

## Routes and Operations

The Platform route is `/operations/intake-requests` and uses only:

- `POST /api/operations/intake-requests/query`;
- `GET /api/operations/intake-requests/:requestId`;
- `POST /api/operations/intake-requests/:requestId/actions`.

The first implementation slice includes bounded search, status/type filters,
queue refresh, detail selection, sanitized action history, and the five R2
actions. Actions require explicit confirmation and refresh authoritative data
after success.

## Privacy and Failure Handling

Search values are sent only in POST JSON bodies. The UI never logs request or
response bodies. Errors are rendered from sanitized Backend envelopes. Service
credentials and Website internal responses never reach the Platform.

## Explicit Exclusions

- workspace provisioning and writes to `intake_workspace_handoffs` (R4);
- onboarding invitations (R5);
- identity-to-workspace resolution (R6);
- upload-session issuance or revocation;
- Production secrets, deployment, DNS, or launch authorization.

## Acceptance

- no intake mock-data path exists;
- production auth sends only a Clerk bearer token;
- real-dev sends only the configured development identity header;
- queue, detail, and actions use the R2 Backend routes;
- `401`, `403`, `404`, `409`, `502`, and `503` remain sanitized;
- action controls cannot supply actor attribution;
- type-check, lint, build, targeted QA, and final allowlist pass.
