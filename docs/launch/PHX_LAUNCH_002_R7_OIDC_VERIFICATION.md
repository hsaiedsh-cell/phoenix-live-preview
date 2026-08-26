# PHX-LAUNCH-002-R7 — Clerk/OIDC Verification

## Evidence Strategy

The repository's `PHX_AUTH_004_REAL_CLERK_UNIFIED_SOURCE_QA_COMPLETED.md`
records a real Clerk sign-in, `phoenix-backend` JWT template, Backend signature
verification, `auth_identities` mapping, and DB-derived authorization. The core
token verifier, actor resolver, and identity repository have not changed since
that verified source commit.

R7 adds delta E2E coverage for the new R6 endpoint using an ephemeral RS256
issuer/JWKS, a signed bearer token, disposable PostgreSQL, and the actual Express
server. The token deliberately contains forged platform-role and workspace claims;
the response must still return only the database membership and role.

## Credential State

No Clerk credentials are present in the current environment, so a new live Clerk
browser session is not claimed. Hosted execution must repeat the browser pass
with the real test app before Release Candidate authorization. Public Production
remains No-Go.
