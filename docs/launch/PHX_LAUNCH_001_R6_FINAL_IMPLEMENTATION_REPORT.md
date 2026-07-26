# PHX-LAUNCH-001-R6 — Final Implementation Report

**Task:** Ambiguous Sign Recovery & Authoritative UI Reconciliation Addendum
**Repository:** `hsaiedsh-cell/phoenix-live-preview`
**Branch:** `phx-launch-001`
**Starting HEAD:** `97f6a0bb2c1add0104013d02ef4368f41b5122c1` (confirmed exact match before any work began; working tree was clean)
**Approved `main` baseline:** `4a97074c4823948eea175a71679000669e56eaa5` (unchanged, still confirmed identical to `origin/main`)
**Final HEAD:** `PHX_LAUNCH_001_R6_FINAL_HEAD_PLACEHOLDER` — filled in as the exact 40-character value in the delivered copy of this report (a commit cannot know its own hash before it exists); independently confirmable via `git rev-parse HEAD` on `phx-launch-001` in the accompanying archive/bundle, matching `PHX-LAUNCH-001-R6-SHA256SUMS.txt`.
**Status:** Code-complete, locally verified, including a full fresh-archive re-verification (Section 9). No backend architecture redesign was needed or performed, per the addendum's own framing.

---

## 1. What R6 corrects — and the critical distinction the addendum requires

**R5 already implemented real server-side idempotent sign requests** (§6 of that revision): given the same session, the same client-generated `reservationKey`, and the same file fingerprint, the server reuses the existing reservation and issues a fresh signed URL, consuming no additional quota. That server-side contract was genuine and already proven in `gate6-idempotent-sign-r5.qa.ts`.

**What R6 adds is exclusively the client-side wiring and reconciliation** that makes that contract *usable*:

1. A real **"Retry upload request"** action, reusing the same `reservationKey`, for an entry left in `recoverable_error` with no `storageObjectKey`.
2. **`cancelEntry()` no longer silently removes** an entry whose server state is ambiguous — this previously hid an already-committed reservation behind what looked like a successful local cancel.
3. **`refreshUploadState()` now reconciles the complete token-state response**, including `pendingReservations`, into the entry list — not just four of its seven fields.
4. **Duplicate recovered entries across repeated refreshes are prevented** by construction (a deterministic synthetic id derived from `storageObjectKey`).
5. **A recovered reservation merges with its local entry** the instant they share an object key.

**What remains unverified after R6, exactly as before**: real Supabase signed-upload/`uploadToSignedUrl` compatibility, real provider metadata, real cancellation/deletion, real transaction-pooler behavior, real Turnstile hostname/action validation, real Resend delivery/idempotency, real Sentry ingestion, real Vercel request-log redaction, real browser/mobile/accessibility QA, DNS/domain verification. None of these are Preview-deployment gates R6 claims to have closed.

---

## 2. Commit list (R6 additions; all 41 prior commits are untouched)

```
7dd42b5  fix(website): expose idempotent sign retry recovery and reconcile authoritative pending state
95841eb  test(website): add ambiguous-sign recovery regression QA
<final>  docs(launch): finalize R6 release-candidate evidence
```

Sections 1, 2, 3, and 4 are combined into one commit because they live inside the same two tightly-coupled files (`UploadClient.tsx` and `upload-client-state.ts`) and could not be usefully separated without an invasive partial-file patch — noted plainly rather than forced into an artificial split, consistent with how R2–R5 handled the same constraint. No commit was amended after any later commit was created on top of it. All 41 pre-existing commits remain byte-identical — confirmed via `git diff` against the R6 starting HEAD touching none of their content.

---

## 3. Ambiguous-sign UI recovery lifecycle

```
pending, never signed
  -> Upload (signAndUpload, generates the reservationKey once)
  -> Remove (local-only, safe -- nothing was ever sent to the server)

signAndUpload() throws/fails before a response is received
  -> phase = recoverable_error, NO storageObjectKey
  -> "Retry upload request" (signAndUpload again, SAME reservationKey)
  -> "Refresh state" (surfaces a server-committed reservation via reconciliation)
  -> NO Cancel action offered here (nothing safe to cancel without a known object key)

signAndUpload() succeeds -> storageObjectKey + signedUploadUrl known
  -> PUT fails/expires
  -> "Retry upload" (same signed URL) AND/OR "Request fresh upload URL" (same reservationKey, re-signs)
  -> Verify, Cancel (both now safe -- object key is known)

PUT succeeds -> uploaded_unverified
  -> Verify, Cancel

Server returns an explicit terminal/conflict result (409)
  -> phase = terminal
  -> "Remove and re-select" only -- no further signAndUpload attempt
```

---

## 4. Pending-reservation reconciliation algorithm

```
reconcilePendingReservations(entries, pendingReservations):
  for each local entry with a storageObjectKey:
    if a matching server reservation exists:
      if entry is in-flight (signing/uploading/verifying/cancelling): leave untouched
      if entry already shows a settled outcome (completed/cancelled/terminal): leave untouched
      else: update filename/contentType/size from server, set phase = uploaded_unverified
    (entries with no storageObjectKey are untouched by this pass entirely)

  for each server reservation with NO local entry sharing its object key:
    add a new entry: clientEntryId = `server:<objectKey>` (deterministic -- never re-added)

  for each entry with a storageObjectKey no longer in the server's pending list:
    keep it if: it still has a live File, is in-flight, or already shows a settled outcome
    otherwise: remove it (the reservation is genuinely gone -- completed/cancelled/expired elsewhere)
```

Pure, dependency-free, keyed exclusively by `storageObjectKey` (never filename, never any guessable field). The existing monotonic sequence-ref guard in `refreshUploadState()` (R5 §5) is unchanged and still discards an out-of-order response before this reconciliation ever runs against it.

---

## 5. Proof local removal cannot hide reserved quota

- **Structural**: `cancelEntry()`'s local-removal branch is gated by `entry.phase === 'pending' || entry.phase === 'terminal'` — no other phase reaches a local `removeEntryById` call at all; every other ambiguous case calls `refreshUploadState()` instead (`gate4-action-availability-r6.qa.ts` §3–4).
- **Behavioral**: `gate1-ambiguous-sign-recovery-r6.qa.ts` §5 creates a reservation with **zero local client-side reference to it at all** (simulating the entry having been "removed" the old, unsafe way) and proves the reservation is still fully discoverable via `GET /api/upload/:token`'s `pendingReservations` — i.e., nothing was ever actually hidden from the server's point of view; only the client's own bookkeeping could have lost track of it, and reconciliation is what recovers that.

---

## 6. Assertion accounting (unique per script; no double-counting)

| Script | Assertions | Category |
|---|---|---|
| `pure-decisions.qa.ts` | 42 | Executed — pure functions |
| `gate1-idempotency-r2.qa.ts` | 30 | Executed — real Postgres, pool max=3 concurrency |
| `gate1-finalization-atomic-r3.qa.ts` | 17 | Executed — real Postgres, 20-way pool max=3 concurrency |
| `gate1-upload-state-r4.qa.ts` | 24 | Executed — real Postgres + fake Storage |
| `gate1-session-reissue-r5.qa.ts` | 21 | Executed — real Postgres + fake Email |
| `gate1-ambiguous-sign-recovery-r6.qa.ts` | 14 | Executed — real Postgres + fake Storage |
| `gate2-upload-r2.qa.ts` | 31 | Executed — real Postgres + fake Storage |
| `gate2-signing-revalidation-r3.qa.ts` | 8 | Executed — real Postgres + direct predicate unit test |
| `gate2-reservation-recovery-r4.qa.ts` | 32 | Executed — real Postgres + fake Storage |
| `gate2-email-idempotency-r5.qa.ts` | 11 | Executed — real Postgres + fake Storage/Email |
| `gate3-monitoring-r2.qa.ts` | 35 | Executed — fake Monitoring + real sanitizer |
| `gate3-idempotency-recovery-r3.qa.ts` | 12 | Executed — real Postgres, injected adapter failures |
| `gate3-postcommit-completion-r4.qa.ts` | 16 | Executed — real Postgres + structural source read |
| `gate3-pending-reservations-r5.qa.ts` | 16 | Executed — real Postgres + fake Storage |
| `gate3-reconciliation-r6.qa.ts` | 15 | Executed — real, dependency-free pure function |
| `gate4-intake.qa.ts` | 41 | Executed — real Postgres + fake Turnstile/Email |
| `gate4-upload-ui-r2.qa.ts` | 34 | Static/structural — no browser |
| `gate4-postcommit-r3.qa.ts` | 13 | Executed — real Postgres, injected email failures |
| `gate4-operational-events-r4.qa.ts` | 18 | Executed — real Postgres, real FK-violation proofs |
| `gate4-stable-entry-identity-r5.qa.ts` | 11 | Executed — real, dependency-free state helpers |
| `gate4-action-availability-r6.qa.ts` | 24 | Static/structural — no browser |
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
| **Total** | **647** | **0 failing** |

---

## 7. Real / mock / static / unavailable test categories

**Executed against real local infrastructure:** every database interaction (a real, local, isolated PostgreSQL 16 instance — never any hosted Supabase project), and the new `reconcilePendingReservations` pure function, executed directly with no I/O.

**Adapter/mock (real logic, injected fake provider):** every Turnstile-, Resend-, and Supabase-Storage-dependent code path, including this revision's fix to the fake storage adapter itself (see §8).

**Statically verified only (no browser):** `gate7-ui.qa.ts` (27), `gate4-upload-ui-r2.qa.ts` (34), and the new `gate4-action-availability-r6.qa.ts` (24) read real source/build output rather than driving a rendered browser. Playwright's Chromium binary download remains blocked (HTTP 403) by this sandbox's network egress allowlist, unchanged from every prior revision's finding.

**Not claimed as tested at all** — restated per the addendum's Section 11: real Supabase signed upload / `uploadToSignedUrl` compatibility, real provider metadata, real cancellation/deletion, real transaction-pooler behavior, real Turnstile hostname/action validation, real Resend delivery/idempotency, real Sentry ingestion, real Vercel request-log redaction, real browser/mobile/accessibility QA, DNS/domain verification. These remain Preview-deployment gates.

---

## 8. Real bugs found and fixed during this revision (not hypothetical)

1. **Fake storage adapter realism gap.** The fake `createSignedUploadUrl`'s returned `uploadUrl` did not vary per call for the same object key — real Supabase Storage always issues a genuinely distinct signed URL (with a fresh token) per signing call, even for the same path. `gate1-ambiguous-sign-recovery-r6.qa.ts`'s own assertion that a retry returns a *fresh* URL caught this immediately; fixed by embedding the per-call fake token into the fake URL. Fixture-only — no product code was affected, and no other QA depended on the old exact URL string.
2. **Two fragile test regexes.** `gate4-action-availability-r6.qa.ts`'s first draft used paren-counting regexes to extract adjacent JSX conditional-rendering blocks; both overshot into the neighboring block (e.g., the "no object key" branch's extracted text spilled into the very next "has object key" branch, which does legitimately contain "Cancel"), producing two false failures. Replaced with explicit marker-based line extraction (find the next sibling `{entry.phase === ...}` marker and slice up to it) rather than depending on balanced-paren matching against nested JSX arrow functions.

---

## 9. Remaining legal, live-provider, browser, and DNS stops

Confirmed via `git diff` that neither `/privacy`, `/terms`, nor the consent-version constants were touched between the R6 starting HEAD and the final HEAD. Both mandatory publishing stops remain open:

1. Confirm whether **"PheonixOPS"** is the intentional spelling and confirm the legal entity/form.
2. Confirm the specific **UAE dispute forum** and obtain qualified UAE legal review.

The full live-provider/browser/DNS Go/No-Go list from R5 (restated in Section 7 above) remains open and unclaimed by this local revision.

## 10. Confirmation

Nothing in this revision was pushed, merged, deployed, or applied to any hosted Supabase project, DNS provider, or production secret store. All work is local to the `phx-launch-001` branch in this sandbox, on top of the unmodified `main` baseline `4a97074c4823948eea175a71679000669e56eaa5`.
