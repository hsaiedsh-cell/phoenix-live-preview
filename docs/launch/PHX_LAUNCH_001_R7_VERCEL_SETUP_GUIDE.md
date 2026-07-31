# PHX-LAUNCH-001-R7 — Vercel Setup Guide (Addendum)

Supersedes nothing structurally in the R2–R6 setup guide corrections. R7
introduces no new environment variable, no schema change, and no new route
— every change is to existing service functions, existing routes' response
shapes, and client-side state handling.

## 1. No new environment variable, no schema change

Confirmed: R7 touches `upload-flow.service.ts`, the existing GET/complete/
finish routes, `UploadClient.tsx`, `upload-client-state.ts`, and the fake
storage adapter test fixture only. No migration file was touched.

## 2. Response shape additions (informational, not configuration)

Three existing endpoints now return additional fields your own monitoring
or support tooling may want to know about if you build anything against
these responses directly:

- `POST /api/upload/:token/complete` → adds `replayed: boolean`
- `POST /api/upload/:token/finish` → adds `alreadyFinalized: boolean`
- `GET /api/upload/:token` → adds a `state: 'active' | 'finalized'`
  discriminator, and a used/finalized token now returns 200 with a minimal
  receipt instead of 404

None of these are breaking changes for the existing UI (which already
handles them), but note this if any external tooling parses these
responses directly.

## 3. Live-provider Go/No-Go — unchanged from R5/R6

The full list from the R5 setup guide is unchanged and still the
authoritative pre-Private-Beta-Go checklist. R7 does not add or resolve any
item on it.

## 4. Next phase after R7 approval

Unchanged from R5/R6's own framing: after independent review approves this
revision, the expected next phase is to push the task branch, open a pull
request, deploy an isolated Website Preview, configure non-production
provider credentials, and run the real browser/provider Go/No-Go checks.
No production merge or launch is authorized by R7, and none was performed.
