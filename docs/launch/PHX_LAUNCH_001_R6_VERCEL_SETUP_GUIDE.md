# PHX-LAUNCH-001-R6 — Vercel Setup Guide (Addendum)

Supersedes nothing structurally in the R2–R5 setup guide corrections. This
revision is client-side only (`UploadClient.tsx`, `upload-client-state.ts`)
plus one fake-adapter test-fixture fix — there is no new environment
variable, no schema change, and no new route.

## 1. No new environment variable, no schema change

R6 introduces no deployment configuration of any kind. The R5 setup guide's
own introduction previously contained a self-contradiction (it said both
"adds one new required environment variable" and, two sentences later, "No
new environment variable is introduced") — that has been corrected in
place: **no new environment variable was introduced in R5**, and none is
introduced in R6 either.

## 2. Live-provider Go/No-Go — unchanged from R5

The full list from the R5 setup guide is unchanged and still the
authoritative pre-Private-Beta-Go checklist. R6 does not add or resolve any
item on it — in particular, the real Supabase signed-upload/
`uploadToSignedUrl` compatibility question remains exactly as open as it
was after R5, since R6's fix is entirely about what the browser does when
a sign response is lost, not about the PUT itself.

## 3. Next phase after R6 approval

Unchanged from R5's own framing: after independent review approves this
revision, the expected next phase is to push the task branch, open a pull
request, deploy an isolated Website Preview, configure non-production
provider credentials, and run the real browser/provider Go/No-Go checks.
No production merge or launch is authorized by R6, and none was performed.
