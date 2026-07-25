# PHX-LAUNCH-001-R3 — Final Implementation Report

**Task:** Transactional Integrity & Failure-Recovery Addendum
**Repository:** `hsaiedsh-cell/phoenix-live-preview`
**Branch:** `phx-launch-001`
**Starting HEAD:** `072937fbaa6a46fd715cef130d96ec073aab394f` (confirmed exact match before any work began; working tree was clean)
**Approved `main` baseline:** `4a97074c4823948eea175a71679000669e56eaa5` (unchanged, still confirmed identical to `origin/main`)
**Final HEAD:** `PHX_LAUNCH_001_R3_FINAL_HEAD_PLACEHOLDER` — a commit cannot know its own hash before it exists; this exact 40-character value is filled in immediately below in the delivered copy of this report, and is independently confirmable via `git rev-parse HEAD` on `phx-launch-001` in the accompanying archive/bundle, matching `PHX-LAUNCH-001-R3-SHA256SUMS.txt`.
**Status:** Code-complete, locally verified, including a full fresh-archive re-verification (Section 10). **Not pushed, merged, or deployed. Nothing applied to any hosted Supabase project. No DNS or production secret was touched.**

---

## 1. What R3 corrects

1. **Genuinely atomic request + upload-session finalization** — the parent request row is now locked and revalidated *inside* the same transaction as the session/reservation, not read via the global pool afterward.
2. **Zero global-pool repository calls inside finalization transactions** — proven structurally and via a real 20-way concurrency test at pool max=3.
3. **Every conditional database UPDATE's returned row is checked** before any corresponding success event is written.
4. **Signed-upload reservation revalidates expiry/revocation/finalization** inside the locked transaction, not merely `status`.
5. **Idempotency claims are released on every unexpected pre-completion failure**, with the original error preserved unchanged.
6. **Post-commit notification/event failures are non-destructive** — a transient failure recording an already-succeeded outcome's event can no longer surface as a customer-facing error.
7. **Sentry sanitization is recursive and bounded**, closing a gap where nested secrets under harmless-looking keys survived.
8. **The broad `*.vercel.app` origin wildcard is replaced** with an exact, environment-driven allowlist.

---

## 2. Commit list (R3 additions; all 20 prior commits are untouched)

```
ac1e530  fix(launch): make upload and request finalization atomic
e998fc5  fix(launch): recover idempotency claims after failures
6514023  fix(launch): make post-commit notifications non-destructive
429a7d9  fix(launch): recursively sanitize monitoring events
83f3b17  fix(website): restrict preview request origins
7a5e3b2  test(launch): add R3 transactional and failure-recovery QA
<final>  docs(launch): update R3 evidence and deployment gates
```

No commit was amended after any later commit was created on top of it. All 20 pre-existing commits (7 original + 6 R1 + 6 R2 + 1 R2 docs) remain byte-identical — confirmed via `git diff` against the R3 starting HEAD touching none of their content.

---

## 3. Finalization transaction and lock order

```
BEGIN
  SELECT session FOR UPDATE                          -- 1. lock upload session
  SELECT reservation FOR UPDATE  (when completing a file)  -- 2. lock reservation
  revalidate session: status=active, expires_at>now(),
                      revoked_at IS NULL, finalized_at IS NULL
  [complete the reservation if this call is completing a file]
  count completed files
  IF finalization requested or max_files reached:
    require count >= 1
    SELECT request FOR UPDATE                          -- 3. lock parent request
    revalidate request.status = 'upload_invited'
      -- if not: finalize NEITHER session NOR request; no mutation to either row
    UPDATE session SET status='used', finalized_at=now() WHERE finalized_at IS NULL
    UPDATE request SET status='files_received' WHERE status=<the exact status just read>
      -- if this returns zero rows: THROW, rolling back the whole
      -- transaction (session finalization included) -- structurally
      -- unreachable in correct operation since the row is held
      -- FOR UPDATE across both reads, but handled defensively
    write upload.session_finalized / request.files_received events
      -- only ever written when the corresponding UPDATE returned a row
COMMIT
(only after commit) send the upload-complete email exactly once, via the non-throwing sendUploadCompleteNotification
```

`signUploadObject` uses the same lock order (session only, since no reservation/request exists yet to complete) and the same four-condition revalidation predicate, exported as `isLockedSessionStillValid`.

---

## 4. Proof no global-pool query occurs inside the transaction

- **Structural**: `maybeFinalizeInTransaction` and everything it calls take the transaction-scoped `query` parameter exclusively; `gate1-finalization-atomic-r3.qa.ts` reads the actual function source and asserts it never calls `intakeRequestsRepo.findById` (the global-pool function it used to call) and does call `lockRequestForUpdate(query, ...)` instead.
- **Behavioral**: the same QA script runs 20 genuinely concurrent `finishUploadSession` calls (`Promise.all`, distinct sessions) against a database pool deliberately forced to `max=3` (`db.ts`'s `__resetIntakePoolForTests`), wrapped in a hard timeout. All 20 settled successfully in ~200ms in this run. A self-deadlock (the exact R2-era failure mode, reproduced here for the finalization path specifically rather than the idempotency path R2 fixed) would have caused this test to time out and fail rather than hang the whole suite.

---

## 5. Idempotency failure-recovery behavior

The owned-claim lifecycle in `submit.service.ts` (IP rate limit → Turnstile → email rate limit → request-creation transaction) is wrapped in one `try/catch`. A `claimCompleted` boolean is set `true` only once the transaction has committed. Any error caught before that point triggers `releaseClaimBestEffort` (sets the claim to `state='failed'`, immediately reclaimable; itself never throws) and then rethrows the **original, unmodified error** — its class, message, and prototype chain all survive, proven directly with a custom `Error` subclass in QA. A claim already `completed` is never released, even if a later step (e.g. an email send) throws.

---

## 6. Post-commit notification semantics

`post-commit.ts`'s `recordPostCommitEvent(requestId, eventType, context, detail?)` wraps the underlying event insert in `try/catch` and **cannot throw** — on failure it reports only a safe category/code to monitoring and returns `{ recorded: false }`. Every post-commit event-recording call site (confirmation/internal-notification email results, upload-invite email result, upload-complete notification result) now goes through it. `sendUploadCompleteNotification` additionally has its own outer `try/catch` as a second line of defense. Provider idempotency keys are unchanged by this fix.

---

## 7. Recursive monitoring sanitizer

`scrubDataObject`/`scrubValue` in `monitoring.adapter.ts` are now mutually recursive, removing every `DANGEROUS_DATA_KEYS` key **at every nesting level** (not just the first) and redacting token/object-key-shaped substrings in every string value at every level, bounded by `MAX_SCRUB_DEPTH = 5` and `MAX_SCRUB_COLLECTION_SIZE = 50`. Applied to breadcrumb data, span data, the allowed `runtime` context's own value (previously only the *key* was allowlisted), and `tags`. Top-level `message` and `logentry` are deleted unconditionally. The explicit safe fields (`requestId`, `route`, `errorCategory`, `statusCode`, `publicReference`, `safeErrorCode`) are untouched by this change — they go through the separate, already-narrow `scrubContext` allowlist.

---

## 8. Origin allowlist contract

```
Allowed:
  - the exact production origin (NEXT_PUBLIC_SITE_URL)
  - any origin listed, verbatim, in ALLOWED_PREVIEW_ORIGINS
    (comma-separated exact origins; compared via normalized URL.origin,
    not a hostname regex)
Denied:
  - any other origin, including any *.vercel.app origin not explicitly configured
  - a malformed incoming Origin header
A malformed entry WITHIN ALLOWED_PREVIEW_ORIGINS is dropped at parse
time (fails closed) -- it can never accidentally match anything.
An ABSENT Origin header is not rejected by this check alone (handled
by the rest of the anti-abuse stack: Sec-Fetch-Site, rate limits, Turnstile).
No origin value, configured or incoming, is ever logged.
```

---

## 9. Assertion accounting (unique per script; no double-counting)

| Script | Assertions | Category |
|---|---|---|
| `pure-decisions.qa.ts` | 42 | Executed — pure functions |
| `gate1-idempotency-r2.qa.ts` | 30 | Executed — real Postgres, pool max=3 concurrency |
| `gate1-finalization-atomic-r3.qa.ts` | 17 | Executed — real Postgres, 20-way pool max=3 concurrency |
| `gate2-upload-r2.qa.ts` | 31 | Executed — real Postgres + fake Storage |
| `gate2-signing-revalidation-r3.qa.ts` | 8 | Executed — real Postgres + direct predicate unit test |
| `gate3-monitoring-r2.qa.ts` | 35 | Executed — fake Monitoring + real sanitizer |
| `gate3-idempotency-recovery-r3.qa.ts` | 12 | Executed — real Postgres, injected adapter failures |
| `gate4-intake.qa.ts` | 41 | Executed — real Postgres + fake Turnstile/Email |
| `gate4-upload-ui-r2.qa.ts` | 29 | Static/structural — no browser |
| `gate4-postcommit-r3.qa.ts` | 13 | Executed — real Postgres, injected email failures |
| `gate5-email-r1.qa.ts` | 16 | Executed — fake Email adapter |
| `gate5-monitoring-recursive-r3.qa.ts` | 21 | Executed — real recursive sanitizer, deep/wide synthetic events |
| `gate6-origin-allowlist-r3.qa.ts` | 11 | Executed — pure functions |
| `gate-ops-redaction-r1.qa.ts` | 18 | Executed — real Postgres |
| `gate7-ui.qa.ts` | 27 | Static/structural — no browser |
| **Total** | **351** | **0 failing** |

---

## 10. Real / mock / static / unavailable test categories

**Executed against real local infrastructure:** every database interaction (a real, local, isolated PostgreSQL 16 instance — never any hosted Supabase project), including the R3 20-way concurrent-finalization deadlock proof at pool max=3, the direct repository-level "zero rows returned" proofs, and the real (non-mocked) recursive Sentry sanitizer operating on synthetic deep/wide event fixtures.

**Adapter/mock (real logic, injected fake provider):** every Turnstile-, Resend-, and Supabase-Storage-dependent code path, including the adapter-throws-unexpectedly injection in Gate 3's QA.

**Statically verified only (no browser):** `gate7-ui.qa.ts` (27) and `gate4-upload-ui-r2.qa.ts` (29) read real source/build output rather than driving a rendered browser — Playwright's Chromium binary download remains blocked (HTTP 403) by this sandbox's network egress allowlist, unchanged from R1/R2's finding.

**Not claimed as tested at all:** real Cloudflare Turnstile verification, real Resend delivery, real Supabase Storage upload/signed-URL/deletion, real Sentry event ingestion under the new recursive sanitizer, real Vercel deployment, real Supabase transaction-pooler behavior, DNS/domain verification. See Section 12 (Live Provider Go/No-Go) below.

---

## 11. Remaining legal stops (unchanged, preserved)

Confirmed via `git diff` that neither `/privacy`, `/terms`, nor the consent-version constants were touched between the R3 starting HEAD and the final HEAD. Both mandatory publishing stops remain open:

1. Confirm whether **"PheonixOPS"** is the intentional spelling (vs. "PhoenixOPS") and confirm the legal entity/form.
2. Confirm the specific **UAE dispute forum** and obtain qualified UAE legal review.

## 12. Live Provider Go/No-Go remains open

Per the addendum's Section 7, this revision does **not** claim live-provider validation. Before Private Beta Go, a deployed environment must still separately prove: a real Supabase signed upload succeeds; provider-recorded metadata is available; real orphan deletion succeeds; a real Turnstile challenge succeeds and rejects replay; real Resend delivery succeeds with provider idempotency; real Sentry captures only sanitized content (under this revision's new recursive sanitizer specifically — not yet proven against a live Sentry ingestion pipeline); and a real Vercel deployment's transaction-pooler connection works as documented in the R2 Setup Guide correction. This is a deployment gate, not a claim made by this local revision.

## 13. Confirmation

Nothing in this revision was pushed, merged, deployed, or applied to any hosted Supabase project, DNS provider, or production secret store. All work is local to the `phx-launch-001` branch in this sandbox, on top of the unmodified `main` baseline `4a97074c4823948eea175a71679000669e56eaa5`.
