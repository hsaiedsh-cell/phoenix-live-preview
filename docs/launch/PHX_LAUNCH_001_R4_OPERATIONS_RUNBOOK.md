# PHX-LAUNCH-001-R4 — Operations Runbook (Update)

Supersedes nothing in the R1/R2/R3 runbooks — every command documented
there is unchanged and still applies exactly as written.

## New: cancelled reservations in cleanup output

`cleanup --dry-run` / `cleanup --apply` (documented in the R2 runbook) now
also finds reservations customers themselves cancelled via the new
"Cancel" action, wherever the best-effort provider deletion attempted at
cancel time didn't succeed. These appear in the same orphan listing as
before, tagged with reason `cancelled` alongside the existing
`expired_reserved` and `failed` reasons:

```
3 orphaned file reservation(s) found (expired-still-reserved or failed).
  cancelled          reservation <id>  session <id>
  expired_reserved   reservation <id>  session <id>
  failed             reservation <id>  session <id>
```

`--apply` handles them identically to any other orphan — attempts provider
deletion, marks the row `expired` only on success, leaves a failed deletion
retriable. No new flag or command is needed.

## Customers can now recover from failed uploads themselves

Before R4, a failed PUT, a failed completion, or a page reload during
upload could leave a customer stuck consuming one of their five file
slots with no way to free it themselves — the only recourse was contacting
Phoenix, or waiting for the whole session to expire. Customers can now
retry or cancel these themselves directly on the upload page; this should
reduce (but does not eliminate) support requests of the form "I can't
upload my last file."

## Internal upload-session route is now strict

`POST /api/intake/:requestId/upload-session` (used only by the ops CLI,
never by browser code) now rejects a malformed or invalid body outright
rather than silently treating it as a plain invite request. If an ops
script or manual `curl` call to this route starts returning 413/422 where
it previously succeeded, check that the request body is well-formed JSON
matching `{ revoke?: boolean }` — this is not a regression, it is the
strict validation this revision added.
