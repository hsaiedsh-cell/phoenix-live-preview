# PHX-LAUNCH-001 — Operations Runbook

Private Beta operations for the Phoenix public request-intake and invitation-only
upload workflow. Audience: whoever is triaging incoming requests (initially, the
founder).

All commands below run from `apps/website/`:

```bash
export INTAKE_DATABASE_URL=...      # Supabase Postgres connection string
export INTAKE_HASH_SECRET=...
export RESEND_API_KEY=...
export INTAKE_INTERNAL_TO_EMAIL=hello@phoenixops.ai
export NEXT_PUBLIC_SITE_URL=https://phoenixops.ai
```

## 1. Reviewing new requests

```bash
npx tsx scripts/ops/intake-ops.ts list
```

Shows the 50 most recent requests: reference, status, type, company. To see full
detail on one request:

```bash
npx tsx scripts/ops/intake-ops.ts find PHX-REQ-XXXXXXXXXXXX
```

## 2. Moving a request to review

```bash
npx tsx scripts/ops/intake-ops.ts review PHX-REQ-XXXXXXXXXXXX
```

Transitions `received` → `under_review`. This is a prerequisite for issuing an
upload invitation.

## 3. Issuing an upload invitation

```bash
npx tsx scripts/ops/intake-ops.ts invite-upload PHX-REQ-XXXXXXXXXXXX
```

- Only valid from `under_review`.
- Creates a single-use, 24-hour upload session and emails the customer a
  `/upload/<token>` link.
- The raw token is **never printed or logged** — only its hash is stored. If the
  customer says they didn't receive the email, revoke and reissue (below) rather
  than trying to recover the original link.
- The command output includes `"emailSent": false` if the email provider failed —
  in that case, manually forward the customer a note, or reissue.

## 4. Revoking an upload session

```bash
npx tsx scripts/ops/intake-ops.ts revoke-upload PHX-REQ-XXXXXXXXXXXX
```

Immediately invalidates the outstanding link. Safe to run even if no session is
active (reports `"revoked": false`).

## 5. Scanning and reviewing uploaded files

Files land in the private Supabase Storage bucket
(`SUPABASE_INTAKE_BUCKET`, default `private-intake-uploads`) under
`intake/<uploadSessionId>/<random>`, and are recorded in `public_intake_files`
with `scan_status = 'pending_review'`.

**Before opening any downloaded file**, run it through your endpoint/antivirus
scanner. Do not rely on the MIME-type allowlist alone — it blocks known-bad
categories (archives, executables, scripts, macro-enabled Office files) but is
not a substitute for scanning actual bytes.

After review, there is currently no CLI command to flip `scan_status` to
`cleared`/`quarantined` — do this with a direct, audited SQL statement against
`public_intake_files` until a dedicated command is built in a later sprint.

## 6. Sending a quotation / payment link

Manual, outside this system. Once terms are agreed:

```bash
npx tsx scripts/ops/intake-ops.ts quote PHX-REQ-XXXXXXXXXXXX
npx tsx scripts/ops/intake-ops.ts accept PHX-REQ-XXXXXXXXXXXX   # once the customer accepts
```

## 7. Rejecting or closing a request

```bash
npx tsx scripts/ops/intake-ops.ts reject PHX-REQ-XXXXXXXXXXXX
npx tsx scripts/ops/intake-ops.ts close PHX-REQ-XXXXXXXXXXXX
```

An invalid transition (e.g. `accept` from `received`) is refused with a clear
`invalid_transition` result — nothing is silently forced.

## 8. Deleting rejected / expired data

```bash
npx tsx scripts/ops/intake-ops.ts cleanup --dry-run
npx tsx scripts/ops/intake-ops.ts cleanup --apply
```

`cleanup` currently expires stale upload sessions (past `expires_at`, still
`active`). Always run `--dry-run` first. Per the Phase 1 Charter's retention
defaults (Section 11), a scheduled/automated version of this — plus deletion of
rejected/unqualified request rows and unfinalized storage objects — is required
before Public Soft Launch; for the initial 5-customer Private Beta cohort, running
this manually on a regular cadence is an accepted interim practice.

## 9. Incident response

- **Suspected abuse (spam submissions):** check `public_intake_rate_limits` for
  the relevant IP/email hash; the fixed-window limits (5/hour/IP, 3/hour/email)
  should already be containing it. If not, lower the limits in
  `src/lib/intake/config.ts`'s `RATE_LIMITS` and redeploy.
- **Suspected malicious file:** revoke the upload session immediately (Section 4),
  do not open the file outside a scanning environment, and mark it `quarantined`
  in the database (Section 5).
- **Email provider outage:** requests still persist correctly (see Gate 5
  evidence — email failure never blocks or duplicates a request); check
  `public_intake_events` for `*_failed` events and follow up with affected
  customers manually.
- **Any exposed secret:** rotate it immediately in Vercel's environment settings
  and in the originating provider dashboard (Resend, Supabase, Cloudflare,
  Sentry). Rotating `INTAKE_HASH_SECRET` invalidates all outstanding upload
  tokens and resets rate-limit history — treat this as a last resort during
  Private Beta, since it will lock out any in-flight upload invitation.
