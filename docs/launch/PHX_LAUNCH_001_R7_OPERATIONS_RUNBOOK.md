# PHX-LAUNCH-001-R7 — Operations Runbook (Update)

Supersedes nothing in the R1–R6 runbooks — every command documented there
is unchanged and still applies exactly as written. R7 is entirely
customer-facing behavior; no ops CLI command changed.

## A used/finalized token now returns a receipt, not a 404

If you (or a customer) hit `GET /api/upload/<token>` for a link whose
session has already been finalized, you'll now get back a 200 with a small
receipt (`state: 'finalized'`, a completed file count, and when it
finalized) instead of the generic "link not valid" 404. This is
informational only — it does not reactivate the link for uploading,
cancelling, or any other mutation. If a customer reports "the link says my
files were already received but I need to add more," that is expected and
correct: a finalized session is genuinely done, and a NEW invitation (see
the R5 runbook's revoke-and-reissue section) is the right next step if
they truly need to send additional files.

## Duplicate-looking rows in the customer's own view are now resolved automatically

If a customer previously reported seeing what looked like the same file
listed twice after a flaky connection, that specific issue is fixed — the
UI now collapses this automatically. You should not need to do anything
operationally about it going forward.

## Everything else

Unchanged from the R1–R6 runbooks.
