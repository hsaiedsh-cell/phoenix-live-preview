# PHX-LAUNCH-001-R6 — Operations Runbook (Update)

Supersedes nothing in the R1–R5 runbooks — every command documented there
is unchanged and still applies exactly as written. R6 is entirely
customer-facing UI behavior; no ops CLI command changed.

## Customers can now recover from a lost/failed sign response themselves

Before this revision, if the very first step of an upload (requesting a
signed URL) failed or its response was lost, the customer's only options
were a misleading "Cancel" (which did NOT actually cancel anything on the
server if a reservation had in fact been created) or being stuck. If a
customer reports "my file disappeared but I still can't upload a new one
in its place," that specific failure mode is now fixed: they'll see a
"Retry upload request" action, and if the server did commit a reservation,
"Refresh state" (or simply reloading the page) will surface it as a normal
recoverable file they can Verify or Cancel.

If you still see a customer stuck in this state, check whether they are
running an older cached version of the upload page (hard refresh /
clear cache) before escalating — this class of issue should no longer
require operator intervention at all going forward.

## Everything else

Unchanged from the R1–R5 runbooks.
