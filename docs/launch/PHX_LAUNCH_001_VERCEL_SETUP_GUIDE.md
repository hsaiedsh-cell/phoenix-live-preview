# PHX-LAUNCH-001 — Vercel Setup Guide

Deployment is NOT performed by this sprint (no push, no Vercel project creation,
no DNS change — see mandatory stop conditions). This guide documents the steps an
owner with Vercel/Supabase/Resend/Cloudflare/Sentry access should follow next.

## 1. Create the independent Vercel project

- Import `hsaiedsh-cell/phoenix-live-preview`.
- Project name: `phoenix-live-preview-website`.
- Root directory: `apps/website`.
- Framework preset: Next.js.
- Production branch: `main` (after `phx-launch-001` is reviewed and merged —
  this sprint does not merge it).
- Leave `apps/platform` and `apps/dashboard` as separate, non-indexed Vercel
  projects, unchanged by this sprint.

## 2. Environment variables

Set these in the Vercel project's Environment Variables settings (Preview and
Production separately, using different values where noted). Never commit real
values to `.env` — see `.env.example` at the repo root for the full annotated
list. Summary:

**Public (safe for the browser):**

| Variable | Notes |
|---|---|
| `NEXT_PUBLIC_SITE_URL` | `https://phoenixops.ai` in Production; the Vercel preview URL in Preview. |
| `NEXT_PUBLIC_CONTACT_EMAIL` | `hello@phoenixops.ai` |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | From the Cloudflare Turnstile dashboard. |

**Server-only (never expose to the browser):**

| Variable | Notes |
|---|---|
| `INTAKE_DATABASE_URL` | Supabase Postgres connection string (use the pooled/transaction connection string Supabase provides for serverless). |
| `INTAKE_HASH_SECRET` | Generate with `openssl rand -hex 32`. Rotating this invalidates outstanding upload tokens. |
| `TURNSTILE_SECRET_KEY` | From Cloudflare Turnstile. |
| `RESEND_API_KEY` | From Resend, scoped to the verified sending domain. |
| `INTAKE_FROM_EMAIL` | Must be on a domain verified in Resend. |
| `INTAKE_INTERNAL_TO_EMAIL` | Where new-request notifications land. |
| `SUPABASE_URL` | Supabase project URL. |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service-role key — bypasses RLS, server-only, never in browser code. |
| `SUPABASE_INTAKE_BUCKET` | Default `private-intake-uploads`; must be a **private** bucket. |
| `SENTRY_DSN` | Optional — monitoring adapter is a documented no-op without it. |
| `INTAKE_OPS_SECRET` | Shared secret for the two internal-only HTTP routes (not required by the CLI, which calls the database directly). |

## 3. Supabase project setup

1. Create (or reuse) a Supabase project.
2. Run the migration:
   ```bash
   cd apps/website
   INTAKE_DATABASE_URL=<supabase-connection-string> npx tsx scripts/db-migrate.ts
   ```
   This applies `db/migrations/0001_public_intake_schema.sql`, which creates 5
   tables, all with Row Level Security enabled and **zero policies** (default-deny
   for `anon`/`authenticated`; `service_role` bypasses RLS by design — see the
   migration file's own header comment).
3. Create a **private** Storage bucket named to match `SUPABASE_INTAKE_BUCKET`
   (default `private-intake-uploads`). Do not enable public access on it.
4. This sprint has NOT applied this migration to any hosted Supabase project —
   that is an explicit next step for whoever holds the Supabase credentials.

## 4. Resend domain verification

1. Add and verify the sending domain in Resend (SPF/DKIM records on
   `phoenixops.ai` DNS).
2. Confirm `hello@phoenixops.ai` (or a subaddress) is a valid, monitored inbox
   before Private Beta starts — Phase 1 Charter Section 16 lists this as an
   owner decision to confirm.

## 5. Cloudflare Turnstile

1. Create a Turnstile site for `phoenixops.ai` (and the Vercel preview domain,
   as a separate site or with wildcard host matching, per Cloudflare's UI).
2. Use the managed challenge widget type for the lowest customer friction.

## 6. Sentry (optional but recommended)

1. Create a Sentry project for `phoenix-live-preview-website`.
2. Set `SENTRY_DSN`. No other code change is required — the monitoring adapter
   already initializes lazily on first use (see
   `src/lib/intake/adapters/monitoring.adapter.ts`).

## 7. DNS / domain cutover

Not performed by this sprint. When ready: point `phoenixops.ai` at the new
Vercel project per Vercel's domain instructions, and confirm the existing
`apps/platform`/`apps/dashboard` deployments (if they also currently sit on this
domain) are moved to their own subdomains first, so this cutover doesn't disrupt
them.

## 8. Before flipping Private Beta "Go"

Re-run this sprint's Go/No-Go checklist (Phase 1 Charter Section 15) against the
**real, deployed** environment — every item in this sprint's own gates was
verified locally/with fakes and still needs a real end-to-end pass once secrets
and hosted services exist. In particular: a real Turnstile challenge, a real
Resend delivery, a real Supabase Storage upload, and a real Sentry-captured
error.
