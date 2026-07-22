# Release Notes — PHX-DEPLOY-003 — Hosted Preview Blocker Resolution

**Type:** Source-code readiness sprint. **No deployment was performed —
public or hosted.**

## What changed

- **Backend:** merged the two previously-divergent lineages
  (`PHX-AUTH-002-R1`'s full auth stack + a new `PHX-DEPLOY-003` production
  CORS middleware) into one buildable source tree. Added
  `src/middleware/cors.ts` (`PHOENIX_ALLOWED_ORIGINS` allowlist, no
  wildcard, ever). Extended `/api/readiness` with a safe `cors` status
  block. `dev-cors.ts` retained for reference, not wired into `server.ts`.
- **Platform:** no source changes — `PHX-PLATFORM-011-R1`'s
  `src/middleware.ts` (Clerk) and `platform-auth.server.ts`'s
  `getToken({ template: 'phoenix-backend' })` were already correct;
  verified, not rebuilt.
- **Env templates:** `apps/backend/.env.example` updated with
  `PHOENIX_ALLOWED_ORIGINS` and a clearly-labeled legacy dev-CORS section;
  `apps/platform/.env.local.example` reviewed and confirmed already
  complete for this sprint's needs.

## What was preserved

- No PBRS scoring, dimension weights, or certification thresholds were
  touched. The six-dimension model (Accuracy 20%, Compliance 20%, Brand
  Alignment 15%, Structure 15%, Consistency 15%, Completeness 15%) remains
  intact in `packages/pbrs` / `packages/core`.
- No customer onboarding or auto-provisioning was added.
- No unsupported passport/certification/report live endpoints were
  connected — those three pages remain explicitly preview-only, confirmed
  labeled as such in this sprint's QA.
- Existing dev-header, ownership, and audit-logging behavior is unchanged.

## Blocker status

| Blocker | Status |
|---|---|
| B1 — unified backend source tree | **Resolved** — built, migrated, seeded, and run against real Postgres this sprint |
| B2 — production CORS allowlist | **Resolved** — full curl QA matrix passed, including active wildcard rejection |
| B3 — platform Clerk middleware | **Already resolved** in the provided source; verified in place and confirmed compiled into the production build |

## Known limitation carried forward

Real Clerk sign-in was not exercised — `clerk.com` / `api.clerk.dev` are not
reachable from this sandbox's network egress (same blocker class documented
in `PHX-AUTH-003`'s build report). A real human/local QA pass with normal
network access against a real Clerk test app is still required before
Hosted Private Preview can go live. Separately, this sprint found (and
documents, without changing) that the platform's Clerk middleware requires
valid-shaped Clerk keys present **at build time** for any route — including
mock and real-dev modes — to boot at all; this is expected for a real
hosted deployment (which will always have real keys) but is a friction point
worth knowing about for anyone running local QA without a Clerk account.

## Go/No-Go

- **Hosted Private Preview: still No-Go.** B1/B2/B3 are resolved on the
  source-code side, but the human-in-the-loop steps this sprint could not
  perform from a sandboxed environment — a real Clerk sign-in QA pass, and
  actual hosting/DNS provisioning — have not happened. This sprint was
  explicitly scoped as source-readiness only ("Do not deploy hosted preview
  yet unless explicitly instructed in a future sprint").
- **Public Deployment: No-Go**, unchanged.

## Next recommended step

A follow-up sprint (or a human QA pass) to run the real-Clerk sign-in
verification from a network-unrestricted environment against this
reconciled tree, then make the actual hosted-preview Go/No-Go call.
