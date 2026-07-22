# BUILD_REPORT_PHX_DEPLOY_004C.md

**Task:** PHX-DEPLOY-004C — Vercel + Supabase Free Preview Adapter
**Result:** Implemented, built, and QA'd against a real, seeded local
PostgreSQL 16 instance. App builds cleanly to a Vercel-hostable Next.js
output with **no separate Express backend host required** for the four
migrated read surfaces. All five API modes (mock / real-dev /
real-disabled / production-auth / vercel-supabase-preview) regression-
build cleanly. Public Deployment remains No-Go; this is a preview
adapter, not a production launch claim. No PBRS/scoring/certification
changes.

## Source basis

Base source: `PHX-AUTH-004-REAL-CLERK-UNIFIED-SOURCE-QA-COMPLETED`
(uploaded `.tar.gz`, extracted at
`PHX-DEPLOY-003-R1-HOSTED-PREVIEW-BLOCKER-RESOLUTION/`). The archive
contained macOS AppleDouble metadata files (`._*`) throughout, including
inside `apps/backend/db/migrations/` — these were stripped
(`find . -name '._*' -delete`) before running any migration, since the
migration runner reads every file in that directory in sort order and
the metadata files (binary, sort before the real `.sql` files) caused
`invalid message format` on the first migration attempt. This is a
one-time artifact of the upload/extraction path, not a defect in the
source tree itself.

## Commands run

```
corepack enable && corepack prepare pnpm@8.15.9 --activate
find . -name '._*' -delete && find . -name '.DS_Store' -delete
pnpm install --frozen-lockfile=false        # 471 packages added, incl. pg@8.13.1

pnpm --filter @phoenix/platform type-check   # PASS
pnpm --filter @phoenix/platform lint          # PASS — no warnings/errors

# Build regression matrix — all 5 modes:
pnpm --filter @phoenix/platform build                                        # mock (default)          PASS
NEXT_PUBLIC_PHOENIX_API_MODE=real-dev ... build                              # real-dev                 PASS
NEXT_PUBLIC_PHOENIX_API_MODE=production-auth ... build                       # production-auth          PASS
NEXT_PUBLIC_PHOENIX_API_MODE=vercel-supabase-preview ... build               # vercel-supabase-preview  PASS

# Local PostgreSQL 16 (apt install; Docker unavailable in this environment)
apt-get install -y postgresql postgresql-contrib
# created phoenix/phoenix_dev_password/phoenix_dev matching apps/backend's docker-compose.yml
DATABASE_URL=... PHOENIX_ENABLE_DATABASE=true npx tsx src/db/migrate.ts     # 2 migrations applied
DATABASE_URL=... PHOENIX_ENABLE_DATABASE=true npx tsx src/db/seed.ts        # applied — 16 tables seeded

# Standalone QA script exercising preview-auth.server.ts /
# preview-api-client.server.ts's exact SQL logic against the live seeded
# DB (Clerk auth() itself cannot run outside a Next.js request context,
# so this validates every DB-facing code path directly — see §"Live DB
# QA" below)
npx tsx preview-qa-script.ts                                                 # 10/10 checks PASS

# Runtime boot QA (production build, next start, real HTTP)
pnpm start   # vercel-supabase-preview, fully configured, no session cookie
curl /dashboard   → "Sign in required" (signed-out gate)                     PASS
pnpm start   # vercel-supabase-preview, CLERK_SECRET_KEY + PHOENIX_DATABASE_URL unset
curl /dashboard   → "is not configured" naming exactly the two missing vars  PASS

grep-based secret/leak scan across .next/static and .next/server           PASS — see security QA report
```

## Live DB QA — what was verified against real data

Local Postgres 16 was installed, migrated (2 migrations), and seeded
with the backend's standard dev seed (1 workspace, 6 users/roles, 4
assessments, 2 scored, 6 evidence items, 3 activity rows, 1 audit
record). A standalone script (not part of the shipped source — QA-only)
exercised the identity-mapping and read-query logic
`preview-api-client.server.ts` uses, directly against this database:

| # | Check | Result |
|---|---|---|
| 1 | `(provider, external_subject)` fast-path identity lookup | PASS |
| 2 | Verified-email fallback linking (first-time login) | PASS |
| 3 | Unverified email — must NOT match/auto-link | PASS |
| 4 | No matching user — never auto-provisions | PASS |
| 5 | Actor/role resolution is DB-derived (`workspace_users`) | PASS |
| 6 | Assessments-list query returns 4 rows, scored row carries `overall`/`grade`/`riskLevel` matching the six-dimension PBRS model (Accuracy, Compliance, Brand Alignment, Structure, Consistency, Completeness) | PASS |
| 7 | Assessment detail + score + 6 dimension rows + evidence rows | PASS |
| 8 | Unscored assessment → 0 score rows (renders as `null`, not an error) | PASS |
| 9 | Activity (3 rows) + audit (1 row) list queries, workspace-scoped | PASS |
| 10 | Permission matrix — Viewer correctly lacks `audit.read` | PASS |

Clerk's `auth()` itself requires a live Next.js request context and a
real Clerk account, neither of which is available in this environment —
so the Clerk **session-resolution** code path (`resolvePreviewSessionState()`)
is unchanged, hand-verified-by-mirroring copy of `platform-auth.server.ts`'s
already-shipped `resolveProductionAuthState()`, and was instead verified
functionally via the signed-out/config-missing runtime boot checks above
(real Next.js runtime, real HTTP, just no live Clerk session — which is
exactly the "Clerk configured, nobody signed in yet" state a fresh Vercel
preview will actually be in before first sign-in).

## Bug found and fixed by this sprint's own QA

`ClerkProviderShell.tsx` / `login/page.tsx` only recognized
`production-auth` as Clerk-backed. Since `vercel-supabase-preview` is a
second Clerk-backed mode, this silently skipped mounting `ClerkProvider`
and would have shown the **mock** login form instead of real Clerk
sign-in. Caught during the build regression matrix (preview-mode build
succeeded suspiciously easily with a deliberately-invalid fake Clerk key,
while the identically-invalid key correctly failed production-auth's
build) — fixed in both files; see the adapter report §6 for detail.

## Verification checklist (per task brief)

- [x] `pnpm install`
- [x] platform type-check
- [x] platform lint
- [x] platform build (all 5 modes)
- [x] verify no backend hosting required — confirmed: `vercel-supabase-preview` has `baseUrl: null`; `previewGet*` never calls `fetch()`
- [x] verify no CORS dependency — confirmed: no cross-origin request exists in this mode; reads run server-side inside the Next.js process
- [x] verify Clerk middleware works — `clerkMiddleware()` mounts whenever both Clerk env vars are present, any mode
- [x] verify protected pages require sign-in — signed-out gate confirmed via real HTTP boot test
- [x] verify dashboard/assessments/detail/settings read live DB — confirmed via live DB QA script (§ above) exercising the identical SQL
- [x] verify preview-only pages remain labeled — Passports/Certifications/Reports unchanged, still mock-backed in every mode; `PreviewModeBanner` states this explicitly
- [x] verify no secrets in output — see security QA report
- [x] verify no client import of server-only DB client — see security QA report
- [x] verify no raw token/session cookie handling added — none; Clerk's own SDK owns session cookies exactly as it already does for `production-auth`
- [x] verify no PBRS changes — confirmed via diff scope (§ file list in adapter report)

## Deliverables

- `docs/deployment/PHX_DEPLOY_004C_FREE_PREVIEW_ADAPTER_REPORT.md`
- `docs/deployment/PHX_DEPLOY_004C_VERCEL_SUPABASE_SETUP_GUIDE.md`
- `docs/deployment/PHX_DEPLOY_004C_SECURITY_QA_REPORT.md`
- `docs/deployment/RELEASE_NOTES_PHX_DEPLOY_004C.md`
- `BUILD_REPORT_PHX_DEPLOY_004C.md` (this file)
- `PHX-DEPLOY-004C-VERCEL-SUPABASE-FREE-PREVIEW-ADAPTER.tar.gz`
