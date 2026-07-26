# PHX-LAUNCH-001-R7 — Final Implementation Report

**Task:** Finalization Receipt & UI Convergence Addendum
**Repository:** `hsaiedsh-cell/phoenix-live-preview`
**Branch:** `phx-launch-001`
**Starting HEAD:** `bc80cbe606c67ccd8767a438baada03c4fcbbe2b` (confirmed exact match before any work began; working tree was clean)
**Approved `main` baseline:** `4a97074c4823948eea175a71679000669e56eaa5` (unchanged, still confirmed identical to `origin/main`)
**Final HEAD:** `PHX_LAUNCH_001_R7_FINAL_HEAD_PLACEHOLDER` — filled in as the exact 40-character value in the delivered copy of this report (a commit cannot know its own hash before it exists); independently confirmable via `git rev-parse HEAD` on `phx-launch-001` in the accompanying archive/bundle, matching `PHX-LAUNCH-001-R7-SHA256SUMS.txt`.
**Status:** Code-complete, locally verified, including a full fresh-archive re-verification (Section 8). No provider integration, hosted migration, or architecture redesign was needed or performed, per the addendum's own framing.

---

## 1. What R7 corrects

1. **Duplicate client entries for one server reservation are now collapsed to exactly one**, with a defined preference order for which identity survives.
2. **A repeated completion of an already-completed reservation returns an idempotent success receipt** instead of a denial — for both a still-active session and an already-finalized one.
3. **A repeated explicit Finish after a committed finalization returns an idempotent already-finalized success receipt** instead of a failure.
4. **`GET /api/upload/:token` returns a minimal finalized receipt** (completedCount, finalizedAt only) for a used/finalized token instead of the generic invalid-link denial.
5. **The UI reconciles ambiguous completion/finish outcomes to the actual committed success state**, rather than leaving a customer looking at a permanent false error for work the server already committed.
6. **`completedBytes`/`reservedBytes` are now retained in component state**, completing the "apply the full authoritative response" requirement first raised in R6.

---

## 2. Commit list (R7 additions; all 44 prior commits are untouched)

```
b65a33a  fix(website): converge duplicate recovered upload entries
f3c8f34  fix(launch): add idempotent completion and finalization receipts
7f45501  fix(website): reconcile finalized upload receipts
fe85d00  test(launch): add R7 replay and convergence regression QA
<final>  docs(launch): finalize local release-candidate evidence
```

Unlike R2–R6, this revision's five corrections split cleanly along real file boundaries with no forced combination: Section 1 lives entirely in `upload-client-state.ts`; Sections 2–4 live entirely in `upload-flow.service.ts` plus the three routes and the fake storage adapter's call-tracking addition; Sections 5–6 live entirely in `UploadClient.tsx`. No commit was amended after any later commit was created on top of it. All 44 pre-existing commits remain byte-identical — confirmed via `git diff` against the R7 starting HEAD touching none of their content.

---

## 3. Duplicate-entry convergence algorithm

```
collapseDuplicatesByObjectKey(entries):
  group entries by storageObjectKey (entries with none are never grouped)
  for each group of size > 1:
    winner = first entry matching, in order:
      1. has both a live File and a reservationKey
      2. has a reservationKey (no File)
      3. is in-flight (signing/uploading/verifying/cancelling)
      4. already settled (completed/cancelled/terminal)
      5. (fallback) the synthetic recovered server entry
    mergedPhase = the group's own most-advanced phase, by rank:
      pending/rejected/terminal < signing < signed/recoverable_error
      < uploading < uploaded_unverified < verifying/cancelling
      < cancelled < completed
    emit: { ...winner, phase: mergedPhase, filename/contentType/size
            from whichever entry actually holds mergedPhase }
  return [ungrouped entries, ...one entry per group]
```

Called at the end of `reconcilePendingReservations` (R6 §3), so every caller gets deduplication automatically. Pure and dependency-free; proven directly (not via source-string assertions) in `gate1-duplicate-convergence-r7.qa.ts`.

---

## 4. Idempotent completion receipt contract

```
completeUploadObject(token, {storageObjectKey, finishSession}):
  session, validity = resolve token

  if !validity.valid:
    if validity.reason == 'used' AND the object key belongs to an
       already-'completed' reservation under this exact session/request:
      return { kind: 'ok', fileCount: <authoritative count>,
                finalized: true, replayed: true }
      -- no provider verification call, no completion_verified event, no email
    else: return { kind: 'denied', reason: validity.reason }

  (session is 'active' from here)
  if the object key doesn't exist / belongs to another session: denied as before

  if the reservation is already 'completed' (active-session replay):
    return { kind: 'ok', fileCount: <authoritative count>,
              finalized: false, replayed: true }
    -- same guarantees: no second provider call, no second event, no second email

  -- else: proceed with the normal, transactional first-time completion
```

---

## 5. Idempotent finish receipt contract

```
finishUploadSession(token):
  session, validity = resolve token
  if !validity.valid:
    if validity.reason == 'used' AND finalized_at is set:
      return { ok: true, fileCount: <authoritative count>, alreadyFinalized: true }
      -- no repeated transition, event, or email
    else: return { ok: false, fileCount: 0 }
  -- else: proceed with the normal, transactional first-time finalization
```

---

## 6. Minimal finalized token-state response

```
GET /api/upload/:token, session used/finalized:
  200 { state: 'finalized', completedCount, finalizedAt, requestId }
  -- requestId here is the route's own per-call correlation id
     (already attached to every response from this route), NEVER the
     database request UUID.
  -- never includes pendingReservations, filenames, storage object
     keys, or any other customer data.
  -- does NOT make the token reusable for any mutation.

GET /api/upload/:token, session active:
  200 { state: 'active', ...the existing full authoritative fields }

GET /api/upload/:token, invalid/revoked/expired-non-finalized:
  404 (generic, unchanged)
```

---

## 7. Assertion accounting (unique per script; no double-counting)

| Script | Assertions | Category |
|---|---|---|
| `pure-decisions.qa.ts` | 42 | Executed — pure functions |
| `gate1-idempotency-r2.qa.ts` | 30 | Executed — real Postgres, pool max=3 concurrency |
| `gate1-finalization-atomic-r3.qa.ts` | 17 | Executed — real Postgres, 20-way pool max=3 concurrency |
| `gate1-upload-state-r4.qa.ts` | 24 | Executed — real Postgres + fake Storage |
| `gate1-session-reissue-r5.qa.ts` | 21 | Executed — real Postgres + fake Email |
| `gate1-ambiguous-sign-recovery-r6.qa.ts` | 14 | Executed — real Postgres + fake Storage |
| `gate1-duplicate-convergence-r7.qa.ts` | 14 | Executed — real, dependency-free pure function |
| `gate2-upload-r2.qa.ts` | 31 | Executed — real Postgres + fake Storage |
| `gate2-signing-revalidation-r3.qa.ts` | 8 | Executed — real Postgres + direct predicate unit test |
| `gate2-reservation-recovery-r4.qa.ts` | 32 | Executed — real Postgres + fake Storage |
| `gate2-email-idempotency-r5.qa.ts` | 11 | Executed — real Postgres + fake Storage/Email |
| `gate2-completion-receipt-r7.qa.ts` | 20 | Executed — real Postgres + call-tracking fake Storage |
| `gate3-monitoring-r2.qa.ts` | 35 | Executed — fake Monitoring + real sanitizer |
| `gate3-idempotency-recovery-r3.qa.ts` | 12 | Executed — real Postgres, injected adapter failures |
| `gate3-postcommit-completion-r4.qa.ts` | 18 | Executed — real Postgres + structural source read |
| `gate3-pending-reservations-r5.qa.ts` | 16 | Executed — real Postgres + fake Storage |
| `gate3-reconciliation-r6.qa.ts` | 15 | Executed — real, dependency-free pure function |
| `gate3-finish-receipt-r7.qa.ts` | 14 | Executed — real Postgres + fake Email |
| `gate4-intake.qa.ts` | 41 | Executed — real Postgres + fake Turnstile/Email |
| `gate4-upload-ui-r2.qa.ts` | 34 | Static/structural — no browser |
| `gate4-postcommit-r3.qa.ts` | 13 | Executed — real Postgres, injected email failures |
| `gate4-operational-events-r4.qa.ts` | 18 | Executed — real Postgres, real FK-violation proofs |
| `gate4-stable-entry-identity-r5.qa.ts` | 11 | Executed — real, dependency-free state helpers |
| `gate4-action-availability-r6.qa.ts` | 24 | Static/structural — no browser |
| `gate4-finalized-receipt-r7.qa.ts` | 29 | Executed (service) + static/structural (UI wiring) |
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
| **Total** | **726** | **0 failing** |

---

## 8. Real / mock / static / unavailable test categories

**Executed against real local infrastructure:** every database interaction (a real, local, isolated PostgreSQL 16 instance — never any hosted Supabase project), including the new call-tracking fake storage adapter proving a replay never calls `verifyObjectExists` a second time.

**Adapter/mock (real logic, injected fake provider):** every Turnstile-, Resend-, and Supabase-Storage-dependent code path.

**Statically verified only (no browser):** `gate7-ui.qa.ts` (27), `gate4-upload-ui-r2.qa.ts` (34), `gate4-action-availability-r6.qa.ts` (24), and the UI-wiring portion of `gate4-finalized-receipt-r7.qa.ts` read real source/build output rather than driving a rendered browser. Playwright's Chromium binary download remains blocked (HTTP 403) by this sandbox's network egress allowlist, unchanged from every prior revision's finding.

**Not claimed as tested at all** — restated per the addendum's Section 11: real Supabase signed upload / `uploadToSignedUrl` compatibility, real provider metadata, real cancellation/deletion, real transaction-pooler behavior, real Turnstile hostname/action validation, real Resend delivery/idempotency, real Sentry ingestion, real Vercel request-log redaction, real browser/mobile/accessibility QA, DNS/domain verification. These remain Preview-deployment gates.

---

## 9. A real, recurring test-hygiene defect found and permanently fixed

`gate6-idempotent-sign-r5.qa.ts` used literal (non-unique) filenames in three row-count assertions. Because this sandbox's local PostgreSQL databases persist across sessions, re-running this exact file against the same database (as happened during this revision's own regression pass) accumulated residual rows from earlier runs and produced false failures — a real, if environment-specific, defect rather than a product regression, confirmed by checking the underlying row counts directly and by re-verifying cleanly against a fresh database each time it was suspected. This revision fixes it properly: each affected assertion now additionally filters by the test's own freshly created `request_id`, confirmed to pass 21/21 even when re-run against a deliberately pre-polluted database.

---

## 10. Remaining legal, live-provider, browser, and DNS stops

Confirmed via `git diff` that neither `/privacy`, `/terms`, nor the consent-version constants were touched between the R7 starting HEAD and the final HEAD. Both mandatory publishing stops remain open:

1. Confirm whether **"PheonixOPS"** is the intentional spelling and confirm the legal entity/form.
2. Confirm the specific **UAE dispute forum** and obtain qualified UAE legal review.

The full live-provider/browser/DNS Go/No-Go list from R5/R6 remains open and unclaimed by this local revision.

## 11. Confirmation

Nothing in this revision was pushed, merged, deployed, or applied to any hosted Supabase project, DNS provider, or production secret store. All work is local to the `phx-launch-001` branch in this sandbox, on top of the unmodified `main` baseline `4a97074c4823948eea175a71679000669e56eaa5`.
