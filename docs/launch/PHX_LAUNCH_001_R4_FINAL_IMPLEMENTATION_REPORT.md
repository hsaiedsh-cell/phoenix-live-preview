# PHX-LAUNCH-001-R4 — Final Implementation Report

**Task:** Upload Recovery & Post-Commit Reliability Addendum
**Repository:** `hsaiedsh-cell/phoenix-live-preview`
**Branch:** `phx-launch-001`
**Starting HEAD:** `e6f4210f12e5b399dea1fe42d57bf33beb3210bb` (confirmed exact match before any work began; working tree was clean)
**Approved `main` baseline:** `4a97074c4823948eea175a71679000669e56eaa5` (unchanged, still confirmed identical to `origin/main`)
**Final HEAD:** `PHX_LAUNCH_001_R4_FINAL_HEAD_PLACEHOLDER` — filled in as the exact 40-character value in the delivered copy of this report (a commit cannot know its own hash before it exists); independently confirmable via `git rev-parse HEAD` on `phx-launch-001` in the accompanying archive/bundle, matching `PHX-LAUNCH-001-R4-SHA256SUMS.txt`.
**Status:** Code-complete, locally verified, including a full fresh-archive re-verification (Section 10). **Not pushed, merged, or deployed. Nothing applied to any hosted Supabase project. No DNS or production secret was touched.**

---

## 1. What R4 corrects

1. **Authoritative upload-session state** returned by `GET /api/upload/:token`.
2. **Reservation retry and cancellation** — a signed reservation no longer permanently consumes quota after a failed PUT, an ambiguous response, a failed completion, or a page reload.
3. **No post-commit database query required to construct a completion success response** — eliminates a false-HTTP-500 failure mode for already-committed work.
4. **Operational events are non-destructive** across the whole upload flow (signing, denial, replay, revoke).
5. **Strict validation of the internal upload-session route body** — malformed/oversized/invalid input can no longer silently issue an invitation.
6. **Recursive Sentry sanitization hardened** for mixed-case nested keys and arbitrary nested URL query strings.
7. **Turnstile hostname/action contract** implemented (not yet claimed live).

---

## 2. Commit list (R4 additions; all 27 prior commits are untouched)

```
b51cd52  fix(launch): expose authoritative upload-session state and add reservation recovery
89a69cc  fix(website): add reservation retry and cancellation recovery UI
585c23b  fix(launch): make remaining operational events non-destructive
da4941c  fix(launch): validate internal upload-session requests strictly
c02031f  fix(launch): harden recursive monitoring field scrubbing
ac6b86a  fix(launch): implement Turnstile hostname/action contract
d7c6592  test(launch): add R4 upload-recovery regression QA
<final>  docs(launch): update final deployment and live-provider gates
```

Sections 1, 2, and 3 are combined into the first commit because they are tightly coupled inside the same two files (`upload-flow.service.ts` and `intake-files.repository.ts`) — splitting them further would have required partial-file patch surgery rather than coherent, independently buildable commits. This is noted plainly rather than forced into an artificial split. No commit was amended after any later commit was created on top of it. All 27 pre-existing commits remain byte-identical — confirmed via `git diff` against the R4 starting HEAD touching none of their content.

---

## 3. Token-state response contract (Section 1)

```
GET /api/upload/:token  ->  200:
  maxFiles, maxFileSizeBytes, maxTotalSizeBytes,
  completedCount, completedBytes,
  reservedCount, reservedBytes,
  remainingFileSlots, remainingBytes,
  expiresAt,
  pendingReservations: [
    { storageObjectKey, originalFilename, declaredContentType, declaredSizeBytes, reservationStatus: 'reserved' }
  ]
```

Never includes: database UUIDs, the request UUID, the token hash, email, customer message, IP hash, or provider secrets. Verified directly in QA by planting marker values in the underlying request row and searching the full serialized response for their absence. Nothing in this response is ever logged.

---

## 4. Reservation retry/cancel lifecycle (Section 2)

```
Client entry phases: pending -> signing -> signed -> uploading ->
  uploaded_unverified -> verifying -> completed
  (any of signing/uploading/verifying) -> recoverable_error -> [retry same phase]
  reserved -> cancelled (via POST /api/upload/:token/cancel)

Cancel:
  resolve+validate token
  BEGIN
    lock session FOR UPDATE; revalidate (active, unexpired, non-revoked, non-finalized)
    lock reservation FOR UPDATE; require it belongs to this session/request
    if already 'completed': deny (cancellation_denied/already_completed)
    if not 'reserved' (already cancelled/failed/expired): idempotent no-op success
    else: UPDATE reservation_status='cancelled' WHERE reservation_status='reserved'
  COMMIT
  (after commit) best-effort provider object deletion; failure leaves the
    row discoverable by the existing orphan-cleanup scan (now also
    matching 'cancelled' rows, tagged with that reason)
```

A retry of a failed PUT reuses the same signed URL (never re-signs); a retry of a failed completion reuses the same `storageObjectKey` (never creates a second reservation) — both proven in QA by asserting exactly one database row exists for the object key throughout a fail-then-retry sequence.

---

## 5. Proof upload quotas recover after failure

`gate2-reservation-recovery-r4.qa.ts` fills every file slot in a session, proves the 6th signing attempt is rejected (`file_count_exceeded`), cancels one reservation, and proves signing immediately succeeds again — the freed slot is usable without waiting for session expiry. The same script proves cancellation is reflected in the very next `checkUploadToken` read (`reservedCount` back to 0, `remainingFileSlots` back to `maxFiles`).

---

## 6. Proof committed completion cannot become a false HTTP 500

`maybeFinalizeInTransaction` now returns `completedCount` on both its `not_finalized` and `finalized` branches, computed inside the same transaction that completed the reservation and/or finalized the session. `completeUploadObject` and `finishUploadSession` use that value directly — a structural read of the actual source (`gate3-postcommit-completion-r4.qa.ts`) confirms neither function calls the global-pool `countCompletedForSession` at all. A behavioral test with the email provider forced to always fail (the only remaining post-commit code path, already non-throwing since R3) still reports a genuine `ok`/`finalized:true` result. Two further tests confirm the response's `fileCount` exactly equals an independent, direct database count of completed rows.

---

## 7. Event transactional/best-effort classification (Section 4)

**Core (written inside the same transaction as the state they prove):** `request.received`, `request.upload_session_created`, `request.upload_invited`, `upload.reservation_created` (moved inside its transaction in this revision — previously recorded after commit with a plain, throwable call, the exact "most serious path" the addendum describes), `upload.completion_verified`, `upload.session_finalized`, `request.files_received`.

**Best-effort (via `recordPostCommitEvent`, never throws):** token accepted/denied, file rejected, object signed, reservation signing failed, completion denied (all reasons), `request.idempotency_replay`, `request.upload_session_revoked`, `request.status_changed` after a non-transactional finalize action, notification sent/failed (unchanged from R3), cleanup observations.

---

## 8. Strict internal-route input behavior (Section 5)

`POST /api/intake/:requestId/upload-session`: a malformed or oversized body now returns an explicit error (413) before any service function is called; a schema-invalid body (e.g. `revoke` as a non-boolean) returns 422; only a well-formed, schema-valid body ever reaches `issueUploadSession`/`revokeUploadSession`. Proven directly against the real route handler module in `gate5-upload-session-validation-r4.qa.ts`, checking the target request's database status is completely unchanged after each rejected input.

---

## 9. Monitoring-sanitizer improvements (Section 6)

Dangerous-key comparison is now case- and separator-insensitive (`Authorization`, `AUTHORIZATION`, `QUERY_STRING` all match); header bags (`headers`/`header`) are removed wholesale by default; every string value encountered anywhere during recursive scrubbing (not only `event.request.url`) has its query string/fragment stripped if it looks like a URL or absolute path. Bounded recursion depth (5) and collection size (50) from R3 are unchanged. A control-case test confirms genuinely harmless nested fields are not removed — the hardening is targeted, not a blanket wipe.

---

## 10. Assertion accounting (unique per script; no double-counting)

| Script | Assertions | Category |
|---|---|---|
| `pure-decisions.qa.ts` | 42 | Executed — pure functions |
| `gate1-idempotency-r2.qa.ts` | 30 | Executed — real Postgres, pool max=3 concurrency |
| `gate1-finalization-atomic-r3.qa.ts` | 17 | Executed — real Postgres, 20-way pool max=3 concurrency |
| `gate1-upload-state-r4.qa.ts` | 24 | Executed — real Postgres + fake Storage |
| `gate2-upload-r2.qa.ts` | 31 | Executed — real Postgres + fake Storage |
| `gate2-signing-revalidation-r3.qa.ts` | 8 | Executed — real Postgres + direct predicate unit test |
| `gate2-reservation-recovery-r4.qa.ts` | 32 | Executed — real Postgres + fake Storage |
| `gate3-monitoring-r2.qa.ts` | 35 | Executed — fake Monitoring + real sanitizer |
| `gate3-idempotency-recovery-r3.qa.ts` | 12 | Executed — real Postgres, injected adapter failures |
| `gate3-postcommit-completion-r4.qa.ts` | 16 | Executed — real Postgres + structural source read |
| `gate4-intake.qa.ts` | 41 | Executed — real Postgres + fake Turnstile/Email |
| `gate4-upload-ui-r2.qa.ts` | 29 | Static/structural — no browser |
| `gate4-postcommit-r3.qa.ts` | 13 | Executed — real Postgres, injected email failures |
| `gate4-operational-events-r4.qa.ts` | 18 | Executed — real Postgres, real FK-violation proofs |
| `gate5-email-r1.qa.ts` | 16 | Executed — fake Email adapter |
| `gate5-monitoring-recursive-r3.qa.ts` | 21 | Executed — real recursive sanitizer |
| `gate5-upload-session-validation-r4.qa.ts` | 14 | Executed — real route handler module, real Postgres |
| `gate6-origin-allowlist-r3.qa.ts` | 11 | Executed — pure functions |
| `gate6-monitoring-hardening-r4.qa.ts` | 16 | Executed — real recursive sanitizer |
| `gate7-turnstile-contract-r4.qa.ts` | 10 | Executed — pure decision function |
| `gate-ops-redaction-r1.qa.ts` | 18 | Executed — real Postgres |
| `gate7-ui.qa.ts` | 27 | Static/structural — no browser |
| **Total** | **481** | **0 failing** |

---

## 11. Real / mock / static / unavailable test categories

**Executed against real local infrastructure:** every database interaction (a real, local, isolated PostgreSQL 16 instance — never any hosted Supabase project), including the R3 20-way concurrent-finalization proof, the R4 reservation-recovery quota proofs, and every real end-to-end flow (signing, replay, revoke, cancel, strict route validation against the actual route handler module).

**Adapter/mock (real logic, injected fake provider):** every Turnstile-, Resend-, and Supabase-Storage-dependent code path.

**Statically verified only (no browser):** `gate7-ui.qa.ts` (27) and `gate4-upload-ui-r2.qa.ts` (29) read real source/build output. Playwright's Chromium binary download remains blocked (HTTP 403) by this sandbox's network egress allowlist, unchanged from R1/R2/R3's finding.

**Not claimed as tested at all (Section 9 of the addendum):** real Supabase signed upload and direct browser PUT; real provider-recorded metadata; real reservation retry/cancel against Supabase Storage; real orphan deletion; real Turnstile hostname/action validation; real Resend delivery and idempotency; real Sentry ingestion after sanitization; real Vercel transaction-pooler behavior; real browser mobile/desktop/accessibility QA; DNS/domain verification. Per the addendum's own note, official Supabase documentation treats `uploadToSignedUrl(path, token, file)` as the supported SDK upload flow — this codebase's raw signed-URL PUT has not been proven against a real Supabase project and must be explicitly verified during deployed Go/No-Go QA, not inferred from these fake-adapter tests.

---

## 12. Remaining legal and live-provider stops

Confirmed via `git diff` that neither `/privacy`, `/terms`, nor the consent-version constants were touched between the R4 starting HEAD and the final HEAD. Both mandatory publishing stops remain open:

1. Confirm whether **"PheonixOPS"** is the intentional spelling and confirm the legal entity/form.
2. Confirm the specific **UAE dispute forum** and obtain qualified UAE legal review.

The full live-provider Go/No-Go list in Section 11 above remains open and unclaimed by this local revision.

## 13. Confirmation

Nothing in this revision was pushed, merged, deployed, or applied to any hosted Supabase project, DNS provider, or production secret store. All work is local to the `phx-launch-001` branch in this sandbox, on top of the unmodified `main` baseline `4a97074c4823948eea175a71679000669e56eaa5`.
