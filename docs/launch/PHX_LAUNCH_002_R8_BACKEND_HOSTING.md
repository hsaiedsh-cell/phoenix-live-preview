# PHX-LAUNCH-002-R8 — Backend Preview Hosting Boundary

The repository now contains a Vercel serverless entry for the existing Express
Backend. It exports the application without opening a long-lived listener,
preserves the production auth and worker configuration guards, routes all hosted
paths into the single Express function, and bounds function execution to 30
seconds.

This adapter does not create a Vercel project, set credentials, change Platform
mode, or authorize Production. A separate Preview project must be created with
the Backend root set to `apps/backend` and must be configured with PostgreSQL,
Clerk OIDC/JWKS, CORS, and service-boundary secrets before hosted verification.

Required Preview configuration includes:

- `NODE_ENV=production`
- `PHOENIX_ENABLE_DATABASE=true`
- `DATABASE_URL` using the Supabase transaction pooler
- `PHOENIX_AUTH_MODE=oidc-jwt`
- `PHOENIX_AUTH_ISSUER`, `PHOENIX_AUTH_AUDIENCE`, and `PHOENIX_AUTH_JWKS_URI`
- `PHOENIX_AUTH_PROVIDER=clerk`
- `PHOENIX_ALLOWED_ORIGINS` restricted to the Platform Preview origin
- the R2 Website intake-service URL and secret when operator handoff is tested

No Production values should be reused or overwritten for this validation.
