# PHX-LAUNCH-001-R1 — Final Implementation Report

**Task:** Security & Reliability Correction Addendum
**Repository:** `hsaiedsh-cell/phoenix-live-preview`
**Branch:** `phx-launch-001`
**Starting HEAD:** `3b2436ec0c97b72ba2c705e5cf6bb05477952f94` (confirmed exact match before any work began)
**Approved `main` baseline:** `4a97074c4823948eea175a71679000669e56eaa5` (unchanged, still confirmed identical to `origin/main`)
**Final HEAD:** `e608d2f` + one further docs commit (see below) — see `git log --oneline phx-launch-001` in the accompanying archive for the exact final hash.
**Status:** Code-complete, locally verified, including a full fresh-archive re-verification (Section 5). **Not pushed, merged, or deployed. Nothing applied to any hosted Supabase project. No DNS or production secret was touched.**

---

## 1. What R1 corrects

All 12 correction areas named in the addendum were implemented with real code and real, executed QA:

1. **Concurrency-safe upload reservations** — `SELECT ... FOR UPDATE` on the parent session row, inside one transaction, for every sign request.
2. **Session/object-key binding** — a durable reservation record ties every signed object to exactly one session and request.
3. **Actual metadata and extension validation** — completion trusts only the storage provider's own observed size/MIME; a denylist + MIME-to-extension map runs independently of the client-declared type.
4. **Correct session-finalization behavior** — exactly-once, via an atomic `finalized_at IS NULL` guard; only the first file never auto-finalizes.
5. **15-minute idempotency and reliable replay** — a dedicated time-bounded table; replay resolution runs before Turnstile is ever consumed.
6. **Anti-abuse ordering** — replay → IP limit → Turnstile → email limit → creation.
7. **Content-Type and cross-site request controls** — 415 on the wrong Content-Type, `Sec-Fetch-Site: cross-site` denial, Origin validation.
8. **Privacy-safe Sentry and logging** — only a safe error code ever reaches monitoring; a `beforeSend`/`beforeSendTransaction` pipeline strips PII and redacts tokens from URLs.
9. **HTML-safe transactional email** — every dynamic value is escaped through one tested helper.
10. **Provider email idempotency** — a stable, semantic key per email, forwarded to Resend's own mechanism.
11. **Redacted operations CLI** — safe summary by default; full detail only behind `--show-sensitive`.
12. **Complete extracted-archive verification** — see Section 5; this time the full gate suite was actually run from a freshly extracted archive, not just diffed.

---

## 2. Commit list (R1 additions; the original seven are untouched)

```
733bc07  fix(launch): bind upload reservations and enforce concurrent quotas
39a2cca  fix(launch): harden intake idempotency and request controls
78ddd86  fix(launch): sanitize monitoring and transactional email
04f33d2  fix(launch): redact operations tooling
e608d2f  test(launch): add PHX-LAUNCH-001-R1 security regression QA
<final>  docs(launch): update R1 reports and runbooks
```

No commit was amended after being referenced elsewhere. (One R1 commit — the first — was amended immediately after creation, before any other commit was made on top of it, to fix a shell-escaping artifact in its own message; see that commit's current content for the corrected, complete message. The original seven commits from the prior sprint were never touched.)

---

## 3. Exact migration/schema changes

`apps/website/db/migrations/0001_public_intake_schema.sql` was **revised in place** (not a new `0002_*.sql` file), per the addendum's explicit instruction, since this schema has never been applied to any hosted Supabase project — only to disposable local PostgreSQL instances created and dropped during this work.

- **New table** `public_intake_idempotency_keys`: `idempotency_key_hash`, `payload_fingerprint`, `request_id`, `expires_at`, `created_at`. Deliberately **not** uniquely indexed on `idempotency_key_hash` alone (see the table's header comment) — concurrency safety comes from `db.ts`'s `withAdvisoryLock`, not a database constraint, because the same key legitimately becomes reusable after it expires.
- **`public_upload_sessions`** gains `finalized_at TIMESTAMPTZ NULL`, set exactly once via `UPDATE ... WHERE finalized_at IS NULL`.
- **`public_intake_files`** redesigned into a reservation record: `declared_content_type`, `declared_size_bytes` (client claim at sign time), `verified_content_type`, `verified_size_bytes` (provider's own observation at completion time), `reservation_status` (`reserved`/`completed`/`failed`/`expired`), `completed_at`. A `CHECK` constraint enforces `completed_at` is set if and only if `reservation_status = 'completed'`.
- **`public_intake_events`**'s allowed `event_type` list grew from 32 to 44 values to cover the new idempotency/reservation/finalization lifecycle events.
- All 6 tables (was 5) have Row Level Security enabled with **zero** policies — unchanged posture, extended to the new table.

Verified via the same local-PostgreSQL-16 discipline as the original sprint: applied cleanly to a fresh database, table/RLS presence confirmed by direct SQL, and every constraint proven with live INSERT/UPDATE statements during QA script development (see Section 4).

---

## 4. Exact upload-reservation model

```
sign:
  BEGIN
    SELECT upload session FOR UPDATE
    count reserved+completed rows, sum their declared_size_bytes
    reject if count+1 > max_files, or sum+candidate > max_total_size_bytes
    reject if extension is dangerous, or extension/MIME pair is not on the allowlist
    INSERT reservation (status='reserved')
  COMMIT
  call storage adapter to create the signed URL
    on failure: mark the reservation 'failed', return signing_failed

complete:
  resolve reservation by storage_object_key
  reject if missing, or upload_session_id/request_id do not match the token's session
  reject if reservation_status != 'reserved'
  ask the storage adapter for the PROVIDER's observed size + content type
  reject if unavailable, or if it disagrees with declared_content_type/declared_size_bytes
  reject if the original filename's extension is incompatible with the provider's own content type
  UPDATE reservation SET reservation_status='completed' WHERE reservation_status='reserved' (atomic; loses the race -> denied)
  if finishSession or completed count has reached max_files:
    UPDATE session SET finalized_at=now() WHERE finalized_at IS NULL (atomic; only the winner proceeds)
    winner only: transition request to files_received, send the upload-complete email once
```

---

## 5. Evidence corrections (Section 8) — fresh archive, fully re-run

A fresh `git archive` of the final `phx-launch-001` HEAD was created, extracted into an independent directory, and — unlike the original sprint's evidence package, which only diffed the extracted files against the working tree — **every gate was actually executed from that extracted copy**:

```
pnpm install --frozen-lockfile   -> PASS
pnpm type-check                  -> PASS (all 4 apps)
pnpm lint                        -> PASS (all 4 apps)
pnpm build                       -> PASS (all 4 apps)
pnpm audit --audit-level=high    -> 0 vulnerabilities
all PHX-LAUNCH-001 QA scripts    -> 229/229 assertions passing, run from the extracted copy against a fresh local database
```

Full command transcripts are in the evidence package. The extraction was also diffed against `HEAD` (`git diff --stat` reported no differences for any tracked file) and the git bundle was verified with `git bundle verify`.

---

## 6. QA counts (this revision)

| Script | Assertions | Nature |
|---|---|---|
| `pure-decisions.qa.ts` | 42 | Executed — pure functions, no I/O |
| `gate4-intake.qa.ts` | 41 | Executed — real local Postgres + fake Turnstile/Email |
| `gate5-email-r1.qa.ts` | 16 | Executed — fake Email adapter |
| `gate6-upload-r1.qa.ts` | 53 | Executed — real local Postgres + fake Storage, incl. real concurrency proofs |
| `gate7-ui.qa.ts` | 27 | Static/structural — no browser (see below) |
| `gate3-monitoring-r1.qa.ts` | 32 | Executed — fake Monitoring adapter + real `sanitizeSentryEvent` |
| `gate-ops-redaction-r1.qa.ts` | 18 | Executed — real local Postgres, calls the real `buildSafeSummary` |
| **Total** | **229** | **0 failing** |

---

## 7. Real versus fake / provider-unavailable

**Executed against real local infrastructure:** all database interactions (a real, local, isolated PostgreSQL 16 instance — never any hosted Supabase project), all pure-function logic, the two genuine `Promise.all` concurrency proofs (5-file limit, 60MB limit, and the concurrent-same-idempotency-key proof), the real `sanitizeSentryEvent` and `buildSafeSummary` functions, and the full fresh-archive install/type-check/lint/build/audit/QA re-run.

**Adapter/mock (real logic, injected fake provider):** every Turnstile-, Resend-, and Supabase-Storage-dependent code path. No call was made to the real Cloudflare `siteverify` endpoint, the real Resend API, or any real Supabase Storage API.

**Statically verified only (no browser):** `gate7-ui.qa.ts`'s 27 assertions read real source and real `next build` output rather than driving a rendered browser — Playwright's Chromium binary download is blocked (HTTP 403, verified directly) by this sandbox's network policy, same finding as the original sprint.

**Not claimed as tested at all:** real Cloudflare Turnstile verification, real Resend delivery, real Supabase Storage upload/signed-URL behavior, real Sentry event ingestion, real Vercel deployment, DNS/domain verification. None of these require action from R1 beyond what the original Setup Guide already documented as follow-up steps before Private Beta go-live.

---

## 8. Two real bugs found and fixed during this revision (not hypothetical)

1. **Connection-pool self-deadlock.** The first real run of the 5-way concurrent-same-idempotency-key QA hung indefinitely. `withAdvisoryLock` holds one dedicated Postgres client for the whole locked flow, including nested queries (rate limiting, event recording) that go through the *same* shared pool. With the pool's original `max: 5`, five truly concurrent same-key callers could each hold a connection blocked on the advisory lock, leaving zero connections free for the eventual lock-winner's own nested queries. Fixed by sizing the pool with real headroom (5 → 15), with the reasoning documented at the call site; re-ran the test and confirmed it now passes.
2. **BIGINT/string comparison bug.** After building the reservation model's provider-metadata equality checks, `gate6-upload-r1.qa.ts` failed on "first completion succeeds." node-postgres returns `BIGINT` columns as JavaScript strings by default (to avoid precision loss for values that could exceed `Number.MAX_SAFE_INTEGER`), so `verified.sizeBytes !== reservation.declared_size_bytes` was comparing a number to a string and was *always* true. Fixed with a global type parser for the BIGINT OID, safe here because every value in this schema is a byte count far below the safe-integer limit.

A third issue was caught and corrected in the QA scripts themselves (not application code): two test-setup bugs in `gate6-upload-r1.qa.ts` (a manufactured request left in a status from which `files_received` is not a reachable transition, and an assertion that expected the wrong post-condition after that fix) were identified and corrected once the real code's behavior was understood.

---

## 9. Remaining legal stops (unchanged, preserved)

Both mandatory publishing stops from the original sprint remain open and untouched by this revision:

1. Confirm whether **"PheonixOPS"** is the intentional spelling (vs. "PhoenixOPS") and confirm the legal entity/form.
2. Confirm the specific **UAE dispute forum** and obtain qualified UAE legal review.

No production publication occurred in this revision. The draft `/privacy` and `/terms` pages, their visible amber draft-notice banners, and `PHX-LAUNCH-001-R1-LEGAL-DRAFT-REVIEW-NOTES.md` all continue to state this explicitly.

---

## 10. Scope audit

Confirmed **zero** changes to `apps/backend`, `apps/platform`, `apps/dashboard`, `packages/pbrs`, `packages/core`, `packages/ui`, `packages/design-system`, `packages/analytics` in this revision (`git diff --stat` against those paths between the R1 starting HEAD and the final HEAD is empty). The only root-level change is a `pnpm.overrides` bump for `brace-expansion` (1.1.16/2.1.2 → forced to 5.0.8), fixing a newly-published High-severity advisory (GHSA-mh99-v99m-4gvg) discovered during this revision's final audit — pre-existing in the eslint devDependency chain, unrelated to any R1 application code, verified compatible (lint still passes) before being applied.

## 11. Confirmation

Nothing in this revision was pushed, merged, deployed, or applied to any hosted Supabase project, DNS provider, or production secret store. All work is local to the `phx-launch-001` branch in this sandbox, on top of the unmodified `main` baseline `4a97074c4823948eea175a71679000669e56eaa5`.
