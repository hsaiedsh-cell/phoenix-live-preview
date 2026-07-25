# PHX-LAUNCH-001-R2 — Final Implementation Report

**Task:** Production-Concurrency & Upload-Finalization Addendum
**Repository:** `hsaiedsh-cell/phoenix-live-preview`
**Branch:** `phx-launch-001`
**Starting HEAD:** `b57292b075b026af436b2b4c31d8d4503fafaed6` (confirmed exact match before any work began; working tree was clean)
**Approved `main` baseline:** `4a97074c4823948eea175a71679000669e56eaa5` (unchanged, still confirmed identical to `origin/main`)
**Final HEAD:** `PHX_LAUNCH_001_R2_FINAL_HEAD_PLACEHOLDER` — this exact value is filled in below immediately after the commit containing this report is created (a commit cannot know its own hash before it exists); it is also independently confirmable via `git rev-parse HEAD` on `phx-launch-001` in the accompanying source archive/bundle, and matches `PHX-LAUNCH-001-R2-SHA256SUMS.txt`. Unlike the R1 report, this is the precise 40-character hash, not a partial short-hash-plus-description.
**Status:** Code-complete, locally verified, including a full fresh-archive re-verification (Section 8). **Not pushed, merged, or deployed. Nothing applied to any hosted Supabase project. No DNS or production secret was touched.**

---

## 1. What R2 corrects

1. **Replaced the session-scoped advisory-lock idempotency flow** with a transaction-pooler-compatible state machine.
2. **Eliminated the pool self-deadlock** under high concurrency — proven, not assumed, with the pool deliberately forced to max=3.
3. **Made upload completion, session finalization, request transition, and core events atomic**, with full revalidation under row locks.
4. **Prevented revoked or expired sessions from becoming `used`.**
5. **Added an explicit, reliable "Finish uploading" flow** to the website, with no stale-snapshot inference.
6. **Removed obsolete completion-body fields** (`originalFilename`, `contentType`).
7. **Deleted orphaned objects from private Storage** through a new `StorageAdapter.deleteObject` method.
8. **Hardened Sentry sanitization** to fail closed for auto-instrumented events.
9. **Corrected connection-mode and metadata documentation.**
10. **Ran complete working-tree and extracted-archive QA.**

---

## 2. Commit list (R2 additions; all 13 prior commits are untouched)

```
f967f4c  fix(launch): replace session-lock idempotency flow
7aebdf8  fix(launch): atomize upload completion and finalization
e654429  fix(website): add explicit resilient upload finalization
884fece  fix(launch): delete orphaned private storage objects
ae6e7f3  fix(launch): harden monitoring sanitization
42a12f5  test(launch): add R2 concurrency and lifecycle regression QA
<final>  docs(launch): correct production setup and R2 evidence
```

No commit was amended after any later commit was created on top of it. All 13 pre-existing commits (7 from the original sprint, 6 from R1) remain byte-identical — confirmed via `git diff` against the R2 starting HEAD touching none of their content.

---

## 3. Idempotency state-machine contract

```
table: public_intake_idempotency_keys
  idempotency_key_hash   TEXT  -- genuinely UNIQUE (not just indexed, unlike R1)
  payload_fingerprint    TEXT
  state                  TEXT  -- 'pending' | 'completed' | 'failed'
  owner_token_hash       TEXT  -- proves who may complete/fail a pending claim
  request_id             UUID  -- NULL until state='completed'
  expires_at             TIMESTAMPTZ
  created_at, updated_at TIMESTAMPTZ

claim:   INSERT ... ON CONFLICT (idempotency_key_hash) DO UPDATE ...
         WHERE expires_at <= now() OR state = 'failed'
         -- succeeds (returns a row) only when no active claim exists;
         -- Postgres's own unique-index conflict handling is the ENTIRE
         -- concurrency-safety mechanism -- no lock of any kind.
release: UPDATE ... SET state='failed' WHERE hash=$1 AND owner_token_hash=$2 AND state='pending'
complete (in the same transaction as request creation):
         UPDATE ... SET state='completed', request_id=$3
         WHERE hash=$1 AND owner_token_hash=$2 AND state='pending'
```

Order of operations in `submitIntakeRequest`: claim/replay resolution → IP rate limit → Turnstile (external call, no DB connection held) → email rate limit → short transaction (request row + `request.received` event + claim completion) → emails after commit. A losing racer observing a still-`pending`, fingerprint-matching claim receives the new `submission_in_progress` outcome (HTTP 202) rather than blocking or erroring.

---

## 4. Database connection mode (Section 7.2 — one authoritative rule)

The R1 setup guide recommended Supabase's transaction-mode pooler while R1's own advisory-lock implementation actually *required* session mode — a direct contradiction. Now that session-scoped locks are gone entirely:

```
Vercel runtime (this application, all API routes): Supabase transaction-mode
  pooler (Supavisor/pgbouncer in transaction mode) — every function in
  db.ts is a single short statement or a single short transaction,
  released back to the pool immediately, with no cross-statement
  session state ever relied upon.

Migration / administration (scripts/db-migrate.ts, direct psql access,
  any one-off maintenance): direct connection, or an explicitly
  approved session-mode connection — DDL and multi-statement admin
  scripts are not part of the serverless request path and have no
  transaction-pooler constraint to satisfy.
```

This is the one place either mode is discussed; the R2 Setup Guide states only this.

---

## 5. Upload completion / finalization transaction

```
(external, before any transaction) fetch provider-recorded metadata
BEGIN
  SELECT session FOR UPDATE
  SELECT reservation FOR UPDATE   -- always session, then reservation
  revalidate: session.status='active', expires_at>now(), revoked_at IS NULL,
              finalized_at IS NULL, reservation.status='reserved',
              reservation belongs to this session AND request
  verify: provider content-type/size == declared; extension compatible
  UPDATE reservation SET status='completed' WHERE status='reserved'
  count completed files
  IF finish-requested OR count reached max_files:
    require count >= 1
    UPDATE session SET status='used', finalized_at=now() WHERE finalized_at IS NULL
    UPDATE request SET status='files_received' (only if this session-update won)
    write upload.session_finalized / request.files_received events
COMMIT
(external, after commit) send the upload-complete email exactly once, only if this call won finalization
```

`finishUploadSession` (the explicit customer action) runs the identical lock → revalidate → finalize sequence.

---

## 6. UI finish flow

`UploadClient.tsx` no longer infers finalization from local React state. `completedCount` and `finalized` are set exclusively from the completion/finish HTTP responses' own fields. A new "Finish uploading" button (backed by the new `POST /api/upload/:token/finish` route) is enabled only when at least one file has completed, nothing is currently uploading, and the session is not already finalized — a rejected or errored entry has no bearing on that computation. An `inFlightRef` guard prevents duplicate sign/complete calls per entry. Automatic server-side finalization at the exact max file count is still respected client-side. A distinct, recoverable error state exists for a failed finalization. Once finalized, the file picker and every upload action are unmounted, not merely disabled.

---

## 7. Orphan provider-object deletion

`StorageAdapter.deleteObject(objectKey)` — narrowly scoped to one key, "not found" treated as idempotent success. `scripts/ops/intake-ops.ts`'s `cleanup --apply` now calls it for every orphan the dry-run scan finds, marking a row `expired` only after that deletion actually succeeds; a failed deletion leaves the row untouched and automatically retriable on the next run. Completed reservations are structurally unreachable by the orphan scan at all (`findOrphanReservations`'s query only ever matches `reserved`/`failed` rows).

---

## 8. QA counts and execution categories

| Script | Assertions | Category |
|---|---|---|
| `pure-decisions.qa.ts` | 42 | Executed — pure functions, no I/O |
| `gate1-idempotency-r2.qa.ts` | 30 | Executed — real local Postgres, pool forced to max=3, genuine 25-way/22-way concurrency via `Promise.all`, hard timeouts |
| `gate2-upload-r2.qa.ts` | 31 | Executed — real local Postgres + fake Storage |
| `gate3-monitoring-r2.qa.ts` | 35 | Executed — fake Monitoring adapter + the real `sanitizeSentryEvent` function |
| `gate4-intake.qa.ts` | 41 | Executed — real local Postgres + fake Turnstile/Email |
| `gate4-upload-ui-r2.qa.ts` | 29 | Static/structural — no browser (see below) |
| `gate5-email-r1.qa.ts` | 16 | Executed — fake Email adapter |
| `gate-ops-redaction-r1.qa.ts` | 18 | Executed — real local Postgres, calls the real `buildSafeSummary` |
| `gate7-ui.qa.ts` | 27 | Static/structural — no browser (see below) |
| **Total** | **269** | **0 failing** |

**Executed against real local infrastructure:** every database interaction (a real, local, isolated PostgreSQL 16 instance — never any hosted Supabase project), including the two deadlock-proof concurrency tests run with the pool deliberately saturated at max=3, and the real `sanitizeSentryEvent`/`buildSafeSummary` functions operating on synthetic/seeded data.

**Adapter/mock (real logic, injected fake provider):** every Turnstile-, Resend-, and Supabase-Storage-dependent code path, including the new `deleteObject` method.

**Statically verified only (no browser):** `gate7-ui.qa.ts` (27) and `gate4-upload-ui-r2.qa.ts` (29) read real source and real `next build` output rather than driving a rendered browser. Playwright's Chromium binary download is blocked (HTTP 403, verified directly with `curl` from this sandbox against both `playwright.azureedge.net` and `cdn.playwright.dev`) by this environment's network egress allowlist. This is reported accurately, not claimed as executed browser QA.

**Not claimed as tested at all:** real Cloudflare Turnstile verification, real Resend delivery, real Supabase Storage upload/signed-URL/deletion behavior, real Sentry event ingestion, real Vercel deployment, DNS/domain verification.

---

## 9. Two real bugs found and fixed during this revision (not hypothetical)

1. **Span/breadcrumb token-redaction gap.** `gate3-monitoring-r2.qa.ts`'s transaction-event test failed on first run: a raw upload token embedded in a Storage-adapter-shaped span `description` (`intake/<sessionId>/<random>`) survived sanitization, because `redactUploadTokenFromUrl` only matched the `/api/upload/<token>/...` URL shape, not the storage-object-key path shape. Fixed by broadening the redaction regex to cover both; re-verified.
2. **Test-hygiene bug across the QA suite.** Running the full regression back-to-back against the same persistent local database (as happened repeatedly during this multi-session engagement) caused several hardcoded literal test IPs, reused across different QA files, to accumulate real rate-limit hits past the 5/hour cap — a false failure, not a product defect, confirmed by inspecting `public_intake_rate_limits` directly. Fixed by replacing every hardcoded IP literal in `gate4-intake.qa.ts` with a per-run randomized helper. While making that change, a second, smaller bug was caught in the same file: an assertion was comparing a stored IP hash against a *freshly re-generated* random IP rather than the one actually used, which would have silently passed for the wrong reason. Also fixed.

---

## 10. Remaining legal stops (unchanged, preserved)

Both mandatory publishing stops remain open and untouched by this revision — confirmed via `git diff` that neither `/privacy` nor `/terms` nor the consent-version constants were touched between the R2 starting HEAD and the final HEAD:

1. Confirm whether **"PheonixOPS"** is the intentional spelling (vs. "PhoenixOPS") and confirm the legal entity/form.
2. Confirm the specific **UAE dispute forum** and obtain qualified UAE legal review.

---

## 11. Confirmation

Nothing in this revision was pushed, merged, deployed, or applied to any hosted Supabase project, DNS provider, or production secret store. All work is local to the `phx-launch-001` branch in this sandbox, on top of the unmodified `main` baseline `4a97074c4823948eea175a71679000669e56eaa5`.
