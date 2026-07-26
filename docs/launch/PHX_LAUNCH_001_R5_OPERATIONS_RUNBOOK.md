# PHX-LAUNCH-001-R5 — Operations Runbook (Update)

Supersedes the revoke-and-reissue instructions implied by the original
runbook — those instructions assumed a workflow the code could not
actually perform before this revision. Every other command documented in
the R1–R4 runbooks is unchanged and still applies exactly as written.

## Revoke-and-reissue now actually works (Section 1)

If an upload invitation email fails to deliver, or the customer can no
longer use the original link, you can now safely revoke and reissue it —
the underlying service calls are `revokeUploadSession` and
`issueUploadSession`, invoked via whichever ops CLI subcommand wraps them.

Before this revision, reissuing after a revoke or expiry would always
fail: issuing a session moves the request to `upload_invited`, and
`upload_invited -> upload_invited` was not an allowed transition, so a
revoked or expired request's invitation could never be reissued — it was
**permanently stuck**. This is fixed: `issueUploadSession` now recognizes a
request already at `upload_invited` with no usable active session (the
prior one was revoked, or has expired even if no cleanup run has processed
it yet) as a valid **replacement** case, and issues a brand-new session and
token without requiring any other action first.

Two things worth knowing operationally:

- **You do not need to run cleanup first.** Reissuing atomically expires a
  stale-but-still-`active` session as part of the same operation — there
  is no dependency on a prior `cleanup --apply` run.
- **Each reissue is a genuinely new session and token.** The old token is
  never reusable again after a reissue (whether it was revoked or simply
  expired); the customer must use the new link from the new invitation
  email.

## Finish is now blocked by pending files (Section 3)

If a customer contacts you saying "Finish uploading" won't work even
though they see a completed file, check whether they also have another
file stuck in an unverified/error state — the server now correctly refuses
to finalize a session while ANY reservation remains in the `reserved`
state, even one the customer's own UI doesn't visibly mark as "busy" (a
recovered file after a page reload, for example). Advise them to either
retry verifying that file or cancel it from the upload page — both are now
self-service actions (see the R4 runbook update).

## Everything else

Sections covering `find`/`list`, `--show-sensitive`, `cleanup` (including
the R4/R5 orphan-reason tagging, now also catching reserved rows under a
revoked or used session immediately rather than waiting for expiry), and
incident response are unchanged from the R1–R4 runbooks and still apply
exactly as written there.
