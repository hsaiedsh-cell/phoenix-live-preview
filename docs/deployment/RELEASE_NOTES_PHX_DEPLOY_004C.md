# Release Notes — PHX-DEPLOY-004C: Vercel + Supabase Free Preview Adapter

## Summary

Adds a fifth Phoenix Platform API runtime mode,
`vercel-supabase-preview`, that lets `apps/platform` be hosted on
Vercel's free tier with PostgreSQL on Supabase's free tier, with **no
separate Express backend host required**. Clerk remains the sign-in
provider. This is a preview adapter for quickly getting the platform
live to review, not a production backend replacement — Public
Deployment remains No-Go.

## What changed

- New mode `NEXT_PUBLIC_PHOENIX_API_MODE=vercel-supabase-preview`.
- `/dashboard`, `/assessments`, `/assessments/[assessmentId]`, and
  Settings' activity/audit preview now read Supabase/Postgres directly
  from server-side Next.js code in this mode — the same four surfaces
  `production-auth` already reads live, just via direct SQL instead of
  an HTTP call to the Express backend.
- Clerk identity → Phoenix user mapping and workspace role resolution
  are fully DB-derived, mirroring the backend's own logic exactly (see
  the implementation report for the mapping rules). No role or
  workspace membership is ever trusted from a Clerk claim.
- No user is ever auto-provisioned. An unmatched Clerk identity gets a
  clear "no Phoenix user is linked to this identity" message, not a
  silently-created account.
- Passports, Certifications, and Reports remain preview-only
  (mock-backed) in this mode, exactly as they already are in every
  other non-mock mode — no change here.

## What was preserved

- `mock`, `real-dev`, `real-disabled`, and `production-auth` modes are
  functionally unchanged — verified via a full build regression matrix
  across all five modes.
- `apps/backend` (the Express backend) was not modified, removed, or
  bypassed for any existing mode.
- PBRS remains locked to the approved six-dimension model (Accuracy
  20%, Compliance 20%, Brand Alignment 15%, Structure 15%, Consistency
  15%, Completeness 15%). No PBRS scoring, dimension, or
  certification/tier-threshold code was touched by this sprint.

## Fixed during this sprint

`ClerkProviderShell.tsx` and `login/page.tsx` originally recognized only
`production-auth` as a Clerk-backed mode. Since `vercel-supabase-preview`
is a second Clerk-backed mode, this would have silently skipped
`ClerkProvider` and shown the mock login form instead of real Clerk
sign-in. Caught by this sprint's own build QA and fixed in both files —
see the implementation report §6 for detail. This is a fix to code this
sprint introduced context for, not a regression in prior work.

## Limitations

- Read-only preview: no write/create/submit endpoint is reachable from
  this mode.
- Single-workspace scoping via an env var
  (`NEXT_PUBLIC_PHOENIX_PRODUCTION_WORKSPACE_ID`) — same interim bridge
  `production-auth` already uses; per-identity workspace resolution
  remains future work.
- Not a production launch claim. Public Deployment remains No-Go.

## Next recommended sprint

**PHX-AUTH-001 — Workspace Membership Resolution from Authenticated
Identity.** Both `production-auth` and this sprint's
`vercel-supabase-preview` mode currently resolve which workspace to
scope reads to from a single env var, because neither the backend nor
this adapter has a "workspaces for the authenticated identity" lookup
yet. Implementing that lookup (and reusing it in both modes) removes
the last hand-configured piece from both Clerk-backed live-read paths.

PBRS remains locked to the approved six-dimension model (Accuracy,
Compliance, Brand Alignment, Structure, Consistency, Completeness).
