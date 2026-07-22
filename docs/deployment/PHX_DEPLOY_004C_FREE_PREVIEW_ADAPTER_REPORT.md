# PHX-DEPLOY-004C — Vercel + Supabase Free Preview Adapter
## Implementation Report

**Base:** PHX-AUTH-004-REAL-CLERK-UNIFIED-SOURCE-QA-COMPLETED
**Type:** New sprint. Adds a fifth Phoenix Platform API runtime mode,
`vercel-supabase-preview`, alongside the existing `mock` / `real-dev` /
`real-disabled` / `production-auth` modes. No source file outside
`apps/platform` was touched. No PBRS scoring, dimensions, or
certification/tier thresholds were touched.

---

## 1. Why this sprint exists

Railway/Render paid hosting for the Express backend is not currently
preferred. This sprint adds the simplest free-tier path to a hosted,
Clerk-authenticated preview: Vercel Hobby for `apps/platform` (Next.js),
Supabase Free for PostgreSQL, and **no separate backend host at all** —
the four already-migrated read surfaces (`/dashboard`, `/assessments`,
`/assessments/[assessmentId]`, and Settings' activity/audit preview)
read Supabase/Postgres directly from server-side Next.js code instead of
calling the Express backend over HTTP.

This is a **preview adapter**, not a production backend replacement.
Public deployment remains No-Go; nothing in this sprint changes that.

## 2. What was read before anything was written

Per standing discipline, the following were fully read before any code
was written:

- `lib/api-config.ts`, `lib/platform-data-source.ts`,
  `lib/real-api-client.ts` / `.server.ts`, `lib/auth/platform-auth.ts` /
  `.server.ts`, `middleware.ts`, `(platform)/layout.tsx`,
  `ProductionAuthGate.tsx`, `ClerkProviderShell.tsx`, `login/page.tsx`,
  `ClerkSignInPanel.tsx` — the entire existing mode/auth seam.
- `apps/backend/src/repositories/{auth,auth-identity,assessments,
  activity,audit}.repository.ts`, `src/auth/{request-actor,
  permissions,auth-types}.ts`, and the two migrations
  (`0001_initial_schema.sql`, `0002_auth_identities.sql`) — the exact
  identity-mapping, role-resolution, and SQL shapes this sprint had to
  reproduce without a backend process in front of them.
- `apps/backend/src/routes/{assessments,activity,audit}.ts` — to
  confirm which permission each read endpoint enforces
  (`assessment.read`, `evidence.read`, `audit.read`) and in what order
  (existence → auth → permission), so the preview adapter enforces the
  identical order and identical permissions.

This is why the new mode reuses the backend's exact mapping rules,
permission matrix, and column-for-column SQL shapes rather than
inventing a parallel design.

## 3. New files

| File | Purpose |
|---|---|
| `lib/db/preview-db.server.ts` | Server-only lazy `pg.Pool` reading `PHOENIX_DATABASE_URL`. Throws if evaluated in a browser context (defense in depth). |
| `lib/auth/preview-auth.server.ts` | Config-status gate (Clerk keys + DB URL + workspace id), Clerk session resolution (mirrors `platform-auth.server.ts`'s `resolveProductionAuthState()`), Clerk→Phoenix identity mapping via `auth_identities` (mirrors the backend's `resolveUserIdForIdentity()` mapping rules exactly — see §5), DB-derived actor/role resolution, and a permission matrix copied verbatim from `apps/backend/src/auth/permissions.ts`. |
| `lib/preview-api-client.server.ts` | `previewGetAssessments`, `previewGetAssessmentDetail`, `previewGetAssessmentEvidence`, `previewGetAssessmentScore`, `previewGetWorkspaceActivity`, `previewGetWorkspaceAuditRecords` — direct parameterized SQL reads, each enforcing the same permission the matching backend route enforces, throwing the same typed errors (`RealApiError` / `RealApiConfigError` / `RealApiAuthRequiredError`) `real-api-client.server.ts` already throws. |
| `components/PreviewModeBanner.tsx` | Sticky banner labeling the deployment as a free-tier preview; states that Passports/Certifications/Reports remain preview-only. |
| `components/PreviewAuthGate.tsx` | Fail-closed gate mirroring `ProductionAuthGate.tsx` — config-missing / signed-out / signed-in, never falls through to mock data. |

## 4. Modified files

| File | Change |
|---|---|
| `lib/api-config.ts` | Added `'vercel-supabase-preview'` to `PhoenixApiMode`. New mode has no `baseUrl` (no Express host); reuses `clerkPublishableKey`/`clerkConfigured` and `productionWorkspaceId` unchanged. Client-safe `isMisconfigured` checks only the publishable key — `CLERK_SECRET_KEY` and `PHOENIX_DATABASE_URL` are server-only checks, done in `preview-auth.server.ts`, exactly mirroring how `production-auth` already splits its client-safe vs. server-only config checks. |
| `lib/platform-data-source.ts` | Added a mode branch in each `load*` function: `vercel-supabase-preview` calls the new `previewGet*` functions instead of `realGet*`. Workspace-id resolution reuses the same `productionWorkspaceId` bridge `production-auth` already uses. No page (`dashboard`, `assessments`, `assessments/[id]`, `settings`) needed any change — they all branch only on `apiConfig.mode === 'mock'` already. |
| `(platform)/layout.tsx` | Gate selection now three-way: `production-auth` → `ProductionAuthGate`, `vercel-supabase-preview` → `PreviewAuthGate`, else → `AuthGate` (unchanged for mock/real-dev). |
| `middleware.ts` | Comment-only. `clerkMiddleware()` is invoked whenever both Clerk env vars are present, regardless of which mode requested them — no functional change was needed for the new mode to get Clerk session detection. |
| `components/ClerkProviderShell.tsx` | **Bug found and fixed during QA** (see §6). `ClerkProvider` now mounts for `production-auth` **or** `vercel-supabase-preview`, not `production-auth` only. |
| `app/login/page.tsx` | Same fix: renders `ClerkSignInPanel` for either Clerk-backed mode. |
| `components/ClerkSignInPanel.tsx` | Copy made mode-generic (`{apiConfig.mode}` instead of hardcoded "production-auth"); config-missing text now names `PHOENIX_DATABASE_URL` for the preview mode instead of `NEXT_PUBLIC_PHOENIX_BACKEND_URL`. |
| `package.json` (platform) | Added `pg@^8.13.1` (dependency) and `@types/pg@^8.11.10` (devDependency) — same versions the backend already pins, for easy comparison. |
| `.env.example`, `.env.local.example` | Documented the new mode and its four required vars (`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `PHOENIX_DATABASE_URL`, `NEXT_PUBLIC_PHOENIX_PRODUCTION_WORKSPACE_ID`). |

## 5. Identity mapping — same rules, direct SQL instead of HTTP

`preview-auth.server.ts`'s `resolvePreviewUserId()` reproduces
`apps/backend/src/repositories/auth-identity.repository.ts`'s mapping
rules exactly:

1. Try `(provider='clerk', external_subject=<Clerk user id>)` first —
   the durable key.
2. If unlinked, match an existing `users.email` — **only** when the
   Clerk email is verified — and link it (`INSERT auth_identities`).
3. **Never** auto-creates a new Phoenix user. An unmatched identity
   returns `no_matching_user` and surfaces as `401 AUTH_REQUIRED`
   (task brief: "Do not auto-provision users").
4. **Never** infers workspace membership or role from any Clerk claim.
   `resolvePreviewActor()` always re-derives role + membership status
   from `workspace_users`, per request.
5. A first-login race is handled the same way the backend handles it:
   `ON CONFLICT (provider, external_subject) ... DO NOTHING`, relying
   on the same unique index the migration already created — no
   application-level locking invented.

## 6. Bug found and fixed during this sprint's own QA

`ClerkProviderShell.tsx` and `app/login/page.tsx` originally checked
`config.mode === 'production-auth'` specifically to decide whether to
mount `ClerkProvider` / render the real Clerk sign-in form. Because
`vercel-supabase-preview` is a *second* Clerk-backed mode, that check
silently skipped Clerk entirely for the new mode — the login page would
have shown the **mock** login form instead of a real sign-in, and no
`ClerkProvider` would have wrapped the app for the client-side session.
This was caught by this sprint's own build-matrix QA (§8), not
inherited from a prior sprint, and is fixed in both files (now checks
"is this a Clerk-backed mode" rather than "is this production-auth
specifically").

## 7. What was explicitly NOT done

- No `.env` or `.env.local` file was created inside the deliverable —
  only the `.example` templates were updated.
- No secrets were fabricated into any committed file.
- No PBRS scoring, dimension, or certification-threshold code was
  touched.
- No auto-provisioning, no public signup, no relaxation of any
  existing permission check.
- The Express backend source (`apps/backend`) was not modified,
  removed, or bypassed for any mode other than the new one — `real-dev`
  and `production-auth` still call it over HTTP exactly as before.
- Passports, Certifications, and Reports remain mock-backed/preview-only
  in every mode, including this one (unchanged — no live endpoint exists
  for them in any mode yet).
