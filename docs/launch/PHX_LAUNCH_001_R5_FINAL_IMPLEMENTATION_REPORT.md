# PHX-LAUNCH-001-R5 — Final Implementation Report

**Task:** Release-Candidate Recovery & Session Lifecycle Addendum
**Repository:** `hsaiedsh-cell/phoenix-live-preview`
**Branch:** `phx-launch-001`
**Starting HEAD:** `57b520355300f8664d51f9301b6f8e6b8220da10` (confirmed exact match before any work began; working tree was clean)
**Approved `main` baseline:** `4a97074c4823948eea175a71679000669e56eaa5` (unchanged, still confirmed identical to `origin/main`)
**Final HEAD:** `PHX_LAUNCH_001_R5_FINAL_HEAD_PLACEHOLDER` — filled in as the exact 40-character value in the delivered copy of this report (a commit cannot know its own hash before it exists); independently confirmable via `git rev-parse HEAD` on `phx-launch-001` in the accompanying archive/bundle, matching `PHX-LAUNCH-001-R5-SHA256SUMS.txt`.
**Status:** Code-complete, locally verified, including a full fresh-archive re-verification (Section 12). This is stated by the addendum to be **the final planned local corrective revision** before pushing for Preview deployment — **no push, merge, or deployment is performed or authorized by this revision.**

---

## 1. What R5 corrects

1. **Safe upload-invitation reissue** after revoke or expiry.
2. **Per-session upload-complete email idempotency** (was per-request).
3. **Finalization blocked while reserved files remain**, with immediate orphan-cleanup discoverability for abandoned reservations.
4. **Stable client-generated file-entry identity**, replacing mutable array indexes.
5. **Authoritative quota state refreshed after every mutation**, with out-of-order-response protection.
6. **Idempotent sign requests** across ambiguous/lost responses.
7. **Remaining monitoring-sanitizer gaps closed** (headers, env, transaction/span query strings).
8. **Bearer-token page/response protections** (cache, referrer, robots).

---

## 2. Commit list (R5 additions; all 35 prior commits are untouched)

```
7cbb504  fix(launch): support safe upload-session reissue
b06dd0b  fix(launch): prevent finalization with pending reservations and make signed reservations idempotent
011b15a  fix(website): stabilize upload entry identity and state refresh
4e81efb  fix(launch): close monitoring and bearer-token privacy gaps
2017504  test(launch): add R5 session-lifecycle regression QA
<final>  docs(launch): finalize local release-candidate evidence
```

Sections 2, 3, and 6 are combined into one commit because they all live inside the same function/file (`upload-flow.service.ts`'s `signUploadObject`/`maybeFinalizeInTransaction`) and could not be usefully separated without an invasive partial-file patch — noted plainly rather than forced into an artificial split, consistent with how R2–R4 handled the same file-coupling constraint. No commit was amended after any later commit was created on top of it. All 35 pre-existing commits remain byte-identical — confirmed via `git diff` against the R5 starting HEAD touching none of their content.

---

## 3. Initial/replacement upload-session lifecycle (Section 1)

```
under_review + no active session
  -> lock request FOR UPDATE
  -> lock+expire-if-stale any 'active' session (atomic, same transaction)
  -> if a genuinely active, unexpired session remains: session_already_active
  -> else: transition under_review -> upload_invited, create session, commit
  -> send invitation email after commit (upload-invitation/<sessionId>)

upload_invited + no usable active session (revoked or expired)
  -> same lock/expire/reject sequence
  -> NO fake same-status transition
  -> record request.upload_session_reissued (new core event)
  -> create replacement session, commit
  -> send invitation email after commit (its OWN upload-invitation/<newSessionId>)

Denied from: files_received, quoted, accepted, rejected, closed
```

An expired-but-not-yet-cleaned-up session is expired atomically inside this same transaction (`lockAndExpireIfStaleActiveSessionInTransaction`) — reissue never requires a separate cleanup run first.

---

## 4. Per-session email idempotency (Section 2)

`upload-complete/<uploadSessionId>`, carried out of the finalization transaction alongside `completedCount`. Proven in QA specifically to differ from both the request id and any prior (revoked) session's id for the same request — the exact shape of the R4-era bug this closes.

---

## 5. Server rule for pending reservations at Finish (Section 3)

Inside the same finalization transaction: count completed rows, count reserved rows; if `reservedCount > 0`, refuse finalization entirely (neither session nor request is mutated) and return a distinct `pending_reservations` outcome carrying the actual counts. Applied uniformly to both the explicit-finish and automatic-at-max-count paths (a no-op for the latter, since quota rules make reserved rows impossible once `completedCount` reaches `max_files`). `findOrphanReservations` now also matches reserved rows whose parent session is `revoked`/`used`/`expired`, not only one still `active` but past `expires_at`.

---

## 6. Stable client-entry identity (Section 4)

Every file entry carries a `clientEntryId`, generated once at creation and used exclusively for the React key, the in-flight guard, and every update/remove/sign/upload/verify/cancel/retry target — never the array index. The pure state helpers (`updateEntryById`, `removeEntryById`, `findEntryById`, `anyEntryBusy`, `canFinish`) live in a dependency-free module (`upload-client-state.ts`) specifically so QA can import and execute them directly rather than relying on a static source-string assertion, per the addendum's own instruction.

---

## 7. Authoritative state-refresh contract (Section 5)

One reusable `refreshUploadState()` re-fetches `completedCount`/`reservedCount`/`remainingFileSlots`/`remainingBytes` from `GET /api/upload/:token` after every sign/completion/cancellation outcome (success, failure, or ambiguous-but-recoverable). A monotonically increasing sequence ref discards a stale, out-of-order response rather than overwriting newer state. A failed refresh shows a recoverable message and never guesses a quota value. Displayed per-file/total limits are sourced from the server's `maxFileSizeBytes`/`maxTotalSizeBytes`, not hard-coded text.

---

## 8. Sign-request idempotency contract (Section 6)

```
table: public_intake_files gains reservation_key_hash (nullable),
  UNIQUE on (upload_session_id, reservation_key_hash) WHERE NOT NULL

sign:
  hash the client-supplied reservationKey
  BEGIN
    lock session FOR UPDATE; revalidate
    lock any existing reservation for (session, keyHash) FOR UPDATE
    if existing.status == 'reserved':
      if fingerprint (filename/contentType/sizeBytes) matches: REUSE (no quota check, no new event)
      else: reservation_conflict
    if existing.status is terminal (completed/cancelled/failed/expired):
      reservation_terminal { status }
    if no existing row: check quota, insert (core upload.reservation_created event, in-transaction)
  COMMIT
  (external) create/refresh a signed URL for the resolved object key
    -- a signing failure on a REUSE never marks the reservation failed
```

The raw key is never stored or logged — only its hash.

---

## 9. Monitoring and token-response privacy controls (Sections 7–8)

`request.headers` and `request.env` are deleted entirely (not allowlisted). `transaction` and `span.description` now strip query string/fragment via a generalized helper that also handles the common `"METHOD <url-or-path>"` Sentry format (a real gap this sprint's own QA caught and fixed). `middleware.ts` applies `Cache-Control: no-store, private`, `Referrer-Policy: no-referrer`, and `X-Robots-Tag: noindex, nofollow, noarchive` to `/upload/:token` and every `/api/upload/:path*` response. The upload page gained `robots.noarchive` and `dynamic = 'force-dynamic'`. The sitemap was confirmed to reference no `/upload` route.

---

## 10. Assertion accounting (unique per script; no double-counting)

| Script | Assertions | Category |
|---|---|---|
| `pure-decisions.qa.ts` | 42 | Executed — pure functions |
| `gate1-idempotency-r2.qa.ts` | 30 | Executed — real Postgres, pool max=3 concurrency |
| `gate1-finalization-atomic-r3.qa.ts` | 17 | Executed — real Postgres, 20-way pool max=3 concurrency |
| `gate1-upload-state-r4.qa.ts` | 24 | Executed — real Postgres + fake Storage |
| `gate1-session-reissue-r5.qa.ts` | 21 | Executed — real Postgres + fake Email |
| `gate2-upload-r2.qa.ts` | 31 | Executed — real Postgres + fake Storage |
| `gate2-signing-revalidation-r3.qa.ts` | 8 | Executed — real Postgres + direct predicate unit test |
| `gate2-reservation-recovery-r4.qa.ts` | 32 | Executed — real Postgres + fake Storage |
| `gate2-email-idempotency-r5.qa.ts` | 11 | Executed — real Postgres + fake Storage/Email |
| `gate3-monitoring-r2.qa.ts` | 35 | Executed — fake Monitoring + real sanitizer |
| `gate3-idempotency-recovery-r3.qa.ts` | 12 | Executed — real Postgres, injected adapter failures |
| `gate3-postcommit-completion-r4.qa.ts` | 16 | Executed — real Postgres + structural source read |
| `gate3-pending-reservations-r5.qa.ts` | 16 | Executed — real Postgres + fake Storage |
| `gate4-intake.qa.ts` | 41 | Executed — real Postgres + fake Turnstile/Email |
| `gate4-upload-ui-r2.qa.ts` | 34 | Static/structural — no browser |
| `gate4-postcommit-r3.qa.ts` | 13 | Executed — real Postgres, injected email failures |
| `gate4-operational-events-r4.qa.ts` | 18 | Executed — real Postgres, real FK-violation proofs |
| `gate4-stable-entry-identity-r5.qa.ts` | 11 | Executed — real, dependency-free state helpers |
| `gate5-email-r1.qa.ts` | 16 | Executed — fake Email adapter |
| `gate5-monitoring-recursive-r3.qa.ts` | 21 | Executed — real recursive sanitizer |
| `gate5-upload-session-validation-r4.qa.ts` | 14 | Executed — real route handler module, real Postgres |
| `gate6-origin-allowlist-r3.qa.ts` | 11 | Executed — pure functions |
| `gate6-monitoring-hardening-r4.qa.ts` | 16 | Executed — real recursive sanitizer |
| `gate6-idempotent-sign-r5.qa.ts` | 21 | Executed — real Postgres, real 10-way concurrency |
| `gate7-turnstile-contract-r4.qa.ts` | 10 | Executed — pure decision function |
| `gate7-monitoring-gaps-r5.qa.ts` | 12 | Executed — real recursive sanitizer |
| `gate8-bearer-token-protection-r5.qa.ts` | 16 | Executed — real middleware function |
| `gate-ops-redaction-r1.qa.ts` | 18 | Executed — real Postgres |
| `gate7-ui.qa.ts` | 27 | Static/structural — no browser |
| **Total** | **594** | **0 failing** |

---

## 11. Real / mock / static / unavailable test categories

**Executed against real local infrastructure:** every database interaction (a real, local, isolated PostgreSQL 16 instance — never any hosted Supabase project), including a genuine 10-way concurrent same-reservation-key `Promise.all` proof (Section 6) and the 20-way concurrent-finalization proof carried over from R3.

**Adapter/mock (real logic, injected fake provider):** every Turnstile-, Resend-, and Supabase-Storage-dependent code path.

**Statically verified only (no browser):** `gate7-ui.qa.ts` (27) and `gate4-upload-ui-r2.qa.ts` (34) read real source/build output; the new `gate4-stable-entry-identity-r5.qa.ts` improves on this by directly executing the extracted pure state helpers rather than relying on source-string matching alone. Playwright's Chromium binary download remains blocked (HTTP 403) by this sandbox's network egress allowlist, unchanged from every prior revision's finding.

**Not claimed as tested at all (Section 12 of the addendum, restated):** real Supabase signed upload / `uploadToSignedUrl` SDK compatibility, real provider metadata, real cancellation/deletion, real transaction-pooler behavior under load, real Turnstile hostname/action validation, real Resend delivery/idempotency, real Sentry ingestion under the closed sanitizer gaps, real Vercel request-log redaction, real browser/mobile/accessibility QA, DNS/domain verification. These are the next Preview-deployment gates after local R5 approval.

---

## 12. Remaining legal, live-provider, browser, and DNS stops

Confirmed via `git diff` that neither `/privacy`, `/terms`, nor the consent-version constants were touched between the R5 starting HEAD and the final HEAD. Both mandatory publishing stops remain open:

1. Confirm whether **"PheonixOPS"** is the intentional spelling and confirm the legal entity/form.
2. Confirm the specific **UAE dispute forum** and obtain qualified UAE legal review.

The full live-provider Go/No-Go list (Section 11 above) remains open and unclaimed by this local revision. Per the addendum's own framing, the next phase after independent approval of R5 is: push the task branch, open a pull request, deploy an isolated Website Preview, configure non-production provider credentials, and run real browser/provider Go/No-Go — **none of which is authorized or performed by this revision.**

## 13. Confirmation

Nothing in this revision was pushed, merged, deployed, or applied to any hosted Supabase project, DNS provider, or production secret store. All work is local to the `phx-launch-001` branch in this sandbox, on top of the unmodified `main` baseline `4a97074c4823948eea175a71679000669e56eaa5`.
