# Release Notes — PHX-LAUNCH-001

Phoenix Private Beta & Request Intake Launch (code-complete foundation).

## What changed

- Added a public, unauthenticated request-intake system to `apps/website`:
  real Request Assessment / Book a Demo / General Inquiry form (replacing the
  non-submitting UI shell), 6 server-side Route Handlers, 5 new Postgres tables
  (with Row Level Security enabled and zero policies), HMAC-based rate limiting
  and idempotency, and adapters for Cloudflare Turnstile, Resend, Supabase
  Storage, and Sentry.
- Added an invitation-only, single-use private file-upload flow
  (`/upload/[token]`), enforcing a 5-file / 20MB-per-file / 60MB-total budget and
  a MIME allowlist, with server-generated storage object keys and no public file
  URLs.
- Added Privacy Policy and Terms draft pages (`/privacy`, `/terms`), each
  carrying a visible draft notice and requiring owner/legal confirmation before
  publication (see `PHX_LAUNCH_001_LEGAL_DRAFT_REVIEW_NOTES.md`).
- Added an operations CLI (`scripts/ops/intake-ops.ts`) for listing, reviewing,
  inviting/revoking uploads, transitioning status, and cleanup.
- Made `NEXT_PUBLIC_SITE_URL` / `NEXT_PUBLIC_CONTACT_EMAIL` environment-driven in
  `@phoenix/config`, with unchanged defaults for every other app.
- Patched a High-severity PostCSS advisory (GHSA-r28c-9q8g-f849) via the
  repo-wide `pnpm.overrides` pin (8.5.16 → 8.5.18), restoring a clean
  `pnpm audit --audit-level=high`.

## What was preserved

- `apps/backend`, `apps/platform`, `apps/dashboard`, and every package under
  `packages/` (including `@phoenix/pbrs` and `@phoenix/core`) are byte-for-byte
  unchanged except for the shared `postcss` version bump above, which is a
  build-tool dependency pin, not application logic.
- No existing authentication architecture, PBRS scoring, Reports, or
  Certification/Passport logic was touched.
- The pre-existing `mailto:` links remain as a secondary fallback on `/contact`.

## Limitations

- This is a code-complete, locally-and-fake-adapter-verified foundation, not a
  deployed system. Nothing was pushed, merged, or deployed; the new database
  migration was verified only against a local, isolated PostgreSQL instance, not
  any hosted Supabase project.
- Live provider verification (real Cloudflare Turnstile challenge, real Resend
  delivery, real Supabase Storage upload, real Sentry ingestion) has not been
  performed and is explicitly called out as unavailable in
  `PHX-LAUNCH-001-FINAL-IMPLEMENTATION-REPORT.md`.
- The Privacy Policy and Terms are drafts pending owner and qualified UAE legal
  review — see `PHX_LAUNCH_001_LEGAL_DRAFT_REVIEW_NOTES.md`.
- No admin UI exists for operations; the CLI is the only operational surface for
  this Private Beta.

## Next recommended sprint

**PHX-LAUNCH-002 — Hosted Provider Wiring & Real-Credential QA**: provision the
Supabase project (apply the migration, create the private Storage bucket),
verify the Resend sending domain, create the Cloudflare Turnstile site, wire
Sentry, and re-run this sprint's full Gate 4–9 QA suite against those real,
hosted credentials before any Private Beta customer is invited.
