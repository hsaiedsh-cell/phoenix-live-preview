# PHX-LAUNCH-001-R3 — Operations Runbook (Update)

Supersedes nothing in the R1/R2 runbooks — every command documented there
(redacted `find`/`list`, `--show-sensitive`, reviewing, inviting, revoking,
quoting, rejecting/closing, `cleanup` with real orphan deletion, incident
response) is unchanged and still applies exactly as written.

## What changed in R3 (behavioral, no new commands)

R3's corrections were entirely to internal transactional integrity and
failure-recovery behavior — there is no new operator-facing command or
changed CLI output in this revision. Two things worth knowing operationally:

- **A request that is rejected or closed while an upload session is
  mid-flight can no longer cause the session to become silently
  finalized.** If an operator rejects or closes a request between the
  customer completing a file and clicking "Finish uploading," the
  customer's Finish action will now correctly fail (the session stays
  `active`, not `used`) rather than the two states ever diverging.
- **A transient failure recording an operational event after a
  finalization, an intake submission, or an upload invitation no longer
  produces a false-error report to the customer.** The underlying
  database/email outcome still happened; only the internal event log entry
  for it may occasionally be missing. If Sentry is configured, such a
  failure is still reported there (as a safe category/code, never raw
  detail) for operator visibility, even though the customer never sees an
  error for it.

No runbook command changed as a result.
