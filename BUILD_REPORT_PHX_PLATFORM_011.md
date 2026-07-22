# Build Report — PHX-PLATFORM-011

**Task:** Live Read Migration for Production Auth
**Environment:** Node v22.22.2, pnpm 8.15.9 (via corepack), Next.js 14.2.35

## Commands run, in order

```
corepack enable
corepack prepare pnpm@8.15.9 --activate
pnpm install --frozen-lockfile                     # exit 0, +394 packages
cd apps/platform
pnpm exec tsc --noEmit                              # exit 0
pnpm exec next lint                                 # 3 errors found, fixed, re-run: exit 0
rm -rf .next && pnpm exec next build                # mock — exit 0
rm -rf .next && <real-dev env> pnpm exec next build  # exit 0
rm -rf .next && <prod-auth+fake-config env> pnpm exec next build  # exit 0
rm -rf .next && <prod-auth, no config env> pnpm exec next build   # exit 0
```

Full output/transcripts for each step are in
`docs/platform/PHX_PLATFORM_011_QA_REPORT.md`.

## Result

| Step | Result |
|---|---|
| Install | ✅ |
| Type-check | ✅ |
| Lint | ✅ (after fixing 3 unescaped-apostrophe errors) |
| Build — mock | ✅ |
| Build — real-dev | ✅ |
| Build — production-auth (fake config) | ✅ |
| Build — production-auth (no config) | ✅ |

## Issues found and fixed during this build pass

1. **`realFetch<T>()` envelope bug** (pre-existing, from
   PHX-PLATFORM-009/010/PHX-LIVE-001) — was returning the raw JSON body
   as the payload instead of unwrapping the backend's
   `{ ok, data, error, requestId }` envelope. Fixed in
   `real-api-client.ts`.
2. **Static-generation correctness bug** (introduced by this sprint's
   own first draft) — `/dashboard`, `/assessments`, and `/settings`
   were initially generated as static pages (`○`) despite calling
   `fetch()` at request time, which would have frozen a single
   build-time snapshot into the page. Fixed by adding `export const
   dynamic = 'force-dynamic'` to those three pages and `cache:
   'no-store'` to the real client's `fetch()` call. Verified via a
   second mock build showing all four migrated routes as `ƒ`
   (dynamic).
3. Three ESLint `react/no-unescaped-entities` errors from raw
   apostrophes in new copy — fixed with `&apos;`.

## Files changed vs. PHX-PLATFORM-010-R1 (confirmed via full-tree diff)

**Modified:**
- `apps/platform/.env.example`, `.env.local.example`
- `apps/platform/src/lib/api-config.ts`
- `apps/platform/src/lib/real-api-client.ts`
- `apps/platform/src/components/MockDataTransparencyBanner.tsx`
- `apps/platform/src/app/(platform)/dashboard/page.tsx`
- `apps/platform/src/app/(platform)/assessments/page.tsx`
- `apps/platform/src/app/(platform)/assessments/[assessmentId]/page.tsx`
- `apps/platform/src/app/(platform)/settings/page.tsx`
- `apps/platform/src/app/(platform)/passports/page.tsx`
- `apps/platform/src/app/(platform)/certifications/page.tsx`
- `apps/platform/src/app/(platform)/reports/page.tsx`

**Added:**
- `apps/platform/src/lib/platform-data-source.ts`
- `apps/platform/src/components/DataStatePanel.tsx`
- `apps/platform/src/components/LiveAssessmentsTable.tsx`
- `apps/platform/src/components/LiveScorePanel.tsx`
- `apps/platform/src/components/LiveEvidenceList.tsx`
- `apps/platform/src/components/LiveActivityAuditLists.tsx`

No file under `apps/backend/`, `apps/website/`, `apps/dashboard/`, or
any PBRS/scoring/certification-threshold file was touched. No file
under `packages/` was touched (read-only, for type reference).

## No-regression / no-launch confirmation

- No public deployment performed or claimed.
- No customer onboarding or auto-provisioning added.
- No backend auth logic changed (no file under `apps/backend/`
  modified — this tar contains no backend source).
- No Clerk secret committed (build env vars used above are
  syntactically-valid-format placeholders, not real credentials).
- No token `localStorage` usage introduced.
- No `dev-header` behavior in `production-auth` (unchanged from
  PHX-PLATFORM-010 — verified again by grep, see QA report).
- No silent mock fallback in any migrated real-dev/production-auth
  page.
- `mock` remains the default and is unchanged.
- `real-dev` remains a dev-header-only local preview mode.
- `production-auth` remains an explicit opt-in mode.
- Passports/Certifications/Reports clearly labeled preview-only in
  non-mock modes.
- No PBRS/scoring/certification-threshold change.

This sprint migrates read data paths only. It does not launch Phoenix
publicly.
