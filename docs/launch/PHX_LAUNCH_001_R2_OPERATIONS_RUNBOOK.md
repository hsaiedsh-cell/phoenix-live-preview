# PHX-LAUNCH-001-R2 — Operations Runbook (Update)

Supersedes only the `cleanup` section of
`PHX-LAUNCH-001-R1-OPERATIONS-RUNBOOK.md`. Everything else in the R1 runbook
(the redacted `find`/`list` default output, `--show-sensitive`, reviewing,
inviting, revoking, quoting, rejecting/closing, incident response) is
unchanged in R2 and still applies exactly as written there.

## Cleanup now actually deletes orphaned Storage objects

```bash
npx tsx scripts/ops/intake-ops.ts cleanup --dry-run
npx tsx scripts/ops/intake-ops.ts cleanup --apply
```

R1's `cleanup --apply` changed database status for orphaned reservations but
never removed the underlying object from the private Supabase Storage
bucket — the file itself stayed in Storage indefinitely. R2 closes that gap:

- Dry-run output is unchanged in shape (counts and reservation/session IDs
  only — never a filename or object key).
- `--apply` now calls the storage adapter's `deleteObject` for every orphan
  found, and only marks that row's reservation `expired` in the database
  **after** the deletion actually succeeds (or the object was already
  absent, which counts as success).
- A failed deletion leaves the row untouched — it is automatically
  retriable by simply running `cleanup --apply` again later. There is
  nothing else to do to "retry" a failed deletion.
- Completed customer files are never touched by this command; they are not
  even visible to the orphan scan that `cleanup` runs.

Output now looks like:

```
Deleted 3 orphaned provider object(s) and marked their reservation(s) expired.
1 deletion(s) failed and remain retriable -- re-run cleanup --apply later to retry them.
```

## New: explicit customer "Finish uploading" action

Customers on the `/upload/[token]` page now have an explicit **Finish
uploading** button, backed by `POST /api/upload/:token/finish`. This does
not change any operations command — sessions still finalize automatically
either when the customer clicks Finish or when they reach the maximum file
count, and the internal upload-complete notification is still sent exactly
once either way. No new CLI command is needed for this.
