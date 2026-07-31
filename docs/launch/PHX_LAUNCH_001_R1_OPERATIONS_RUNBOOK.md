# PHX-LAUNCH-001-R1 — Operations Runbook

Supersedes `PHX-LAUNCH-001-OPERATIONS-RUNBOOK.md` for the two commands whose
output changed in R1. Everything else in the original runbook (reviewing,
inviting, revoking, quoting, rejecting/closing, incident response) is
unchanged and still applies — only the excerpts below are new or different.

All commands below run from `apps/website/`, with the same environment
variables as before:

```bash
export INTAKE_DATABASE_URL=...      # Supabase Postgres connection string
export INTAKE_HASH_SECRET=...
export RESEND_API_KEY=...
export INTAKE_INTERNAL_TO_EMAIL=hello@phoenixops.ai
export NEXT_PUBLIC_SITE_URL=https://phoenixops.ai
```

## 1. Reviewing requests (R1: redacted by default)

```bash
npx tsx scripts/ops/intake-ops.ts list
npx tsx scripts/ops/intake-ops.ts find PHX-REQ-XXXXXXXXXXXX
```

`find` now prints a **safe summary only** by default:

```json
{
  "publicReference": "PHX-REQ-XXXXXXXXXXXX",
  "status": "under_review",
  "requestType": "assessment",
  "company": "Acme",
  "createdAt": "2026-07-25T00:00:00.000Z",
  "updatedAt": "2026-07-25T00:00:00.000Z",
  "fileCount": 0,
  "uploadSessionStatus": null
}
```

It never includes the customer's message, email, phone, raw/hashed IP,
idempotency hash, upload-token hash, storage object key, or original
filename.

To see the full record — customer message, email, phone, and internal
hashes — pass `--show-sensitive`. This prints a loud warning before the
full row:

```bash
npx tsx scripts/ops/intake-ops.ts find PHX-REQ-XXXXXXXXXXXX --show-sensitive
```

Treat that output like any other export of personal data: don't paste it
into chat, tickets, or anywhere outside the immediate operational need.

## 2. Orphan cleanup (new)

`cleanup` now also finds and clears orphaned upload **reservations** — not
just stale sessions:

```bash
npx tsx scripts/ops/intake-ops.ts cleanup --dry-run
npx tsx scripts/ops/intake-ops.ts cleanup --apply
```

Dry-run output now includes a second section:

```
N orphaned file reservation(s) found (expired-still-reserved or failed).
  expired_reserved  reservation <id>  session <id>
  failed            reservation <id>  session <id>
```

- `failed` reservations are ones where the storage provider's signed-URL
  call itself failed (see the R1 Implementation Report §4).
- `expired_reserved` reservations are ones where a signed URL was issued
  but the customer's upload session expired before the file was ever
  completed.

`--apply` marks these `expired` in the database. **Completed customer
files are never touched by this command** — only rows still in the
`reserved` state, or already `failed`, are affected.

## 3. Everything else

Sections 2 (moving to review), 3 (issuing an upload invitation), 4
(revoking), 6 (quoting/accepting), 7 (rejecting/closing), and 9 (incident
response) from the original runbook are unchanged in R1 and still apply
exactly as written there.
