# PHX-LAUNCH-001-R3 — Vercel Setup Guide (Addendum)

Supersedes nothing structurally in the R2 setup guide's connection-mode
correction, which remains accurate and unchanged (transaction-mode pooler
for the Vercel runtime, direct/session connection for migrations only). This
addendum adds one new required environment variable and one new deployment
verification item.

## 1. New environment variable: ALLOWED_PREVIEW_ORIGINS

```
ALLOWED_PREVIEW_ORIGINS=https://<this-project's-preview-origin>.vercel.app[,https://<another-exact-preview-origin>]
```

R2 (and the original sprint) allowed any `*.vercel.app` origin to submit to
the public intake/upload routes — broader than intended, since that
includes every OTHER Vercel project's preview URLs, not only this one's. R3
replaces that wildcard with an exact allowlist. Before deploying a preview
environment, add its actual preview origin (Vercel assigns this per branch/
PR — check the deployment's own URL) to this variable in the corresponding
Vercel environment's settings. The production origin
(`NEXT_PUBLIC_SITE_URL`) does not need to be listed here — it is always
allowed separately.

A malformed entry in this list is silently dropped (fails closed) rather
than causing a startup error or matching everything — but a dropped entry
also means that preview origin will be denied, so double-check the exact
value if a specific preview deployment's browser-based form submissions
start failing with a 403.

## 2. Migration (unchanged from R2's structural note)

The tracked migration continues to be revised in place, not appended to.
Nothing about the migration itself changed in R3. Run
`scripts/db-migrate.ts` with a direct/session connection string, as
documented in the R2 setup guide correction.

## 3. Before flipping Private Beta "Go" — one new item

In addition to every item already listed in the R1 and R2 setup guides,
verify once real infrastructure exists that a genuinely concurrent pair of
"Finish uploading" actions (e.g. two browser tabs, or a network retry after
an ambiguous response) for the SAME upload session resolves to exactly one
finalization and one upload-complete email — this sprint's QA proves this
against local Postgres with a real 20-way concurrency test, but has not
been proven against hosted Supabase's transaction-mode pooler specifically.
