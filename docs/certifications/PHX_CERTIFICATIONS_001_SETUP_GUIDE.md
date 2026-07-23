# PHX-CERTIFICATIONS-001 — Setup Guide

No new environment variables were introduced by this sprint. Live
certifications reuse exactly the same `vercel-supabase-preview` mode
configuration Passports (PHX-PASSPORTS-001) and the dashboard/assessments/
activity/audit reads (PHX-DEPLOY-004C) already require.

## To see live certifications data

1. Set `apps/platform/.env.local` (see `.env.example` for the full list):
   ```
   NEXT_PUBLIC_PHOENIX_API_MODE=vercel-supabase-preview
   NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=<your Clerk publishable key>
   CLERK_SECRET_KEY=<your Clerk secret key>
   PHOENIX_DATABASE_URL=<your Supabase/Postgres connection string>
   NEXT_PUBLIC_PHOENIX_PRODUCTION_WORKSPACE_ID=<a real workspace id>
   ```
2. Run the app (`pnpm --filter=./apps/platform dev` or the deployed
   equivalent) and sign in via Clerk.
3. Navigate to `/certifications`. If the signed-in identity is an Active
   member of the configured workspace, the "Certified Assets" section
   renders live rows from `pbrs_certifications`. Every role sees it —
   this endpoint uses `assessment.read`, granted to all six roles.

## Every other mode

- `mock` (default) — unchanged, renders the existing mock-backed page.
- `real-dev` / `production-auth` — unchanged. These modes render the same
  mock-backed page as `mock` for `/certifications`, because
  `apps/backend/src/routes/certifications.ts` is still a 501 stub. This is
  intentional, not a bug — see the Implementation Report §1.
- `real-disabled` — unchanged, mock-backed.

## Troubleshooting

Uses the exact same `DataStatePanel` states as every other migrated
`vercel-supabase-preview` read (Passports, Dashboard, Assessments,
Activity/Audit) — see `DEPLOYMENT_GUIDE.md` and
`PHX_DEPLOY_004C_VERCEL_SUPABASE_SETUP_GUIDE.md` for the shared
`config-missing` / `auth-required` / `permission-denied` /
`backend-unavailable` troubleshooting steps. Nothing about that resolution
flow changed in this sprint.
