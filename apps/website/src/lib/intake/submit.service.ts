// ============================================================
// Intake submission service -- core logic, framework-agnostic
// PHX-LAUNCH-001 (R3: PHX-LAUNCH-001-R3 §3, §4)
// ------------------------------------------------------------
// R2 recap: the session-scoped advisory lock is gone. Idempotency
// safety comes entirely from idempotency-keys.repository.ts's atomic
// claim/release/complete statements against a genuinely UNIQUE
// idempotency_key_hash column. Required order: claim/replay
// resolution -> IP rate limit -> Turnstile -> email rate limit ->
// request creation.
//
// R3 correction summary:
//  - §3: once a caller wins a claim, EVERY step from there through
//    the request-creation transaction is now wrapped in a single
//    try/catch. Any UNEXPECTED failure (a rate-limit persistence
//    error, the Turnstile adapter throwing instead of returning a
//    result, a transaction failure, etc.) now triggers a best-effort
//    release of the claim (state='failed', immediately reclaimable)
//    BEFORE the original error is rethrown unchanged -- previously
//    such a failure left the claim 'pending' for the full 15-minute
//    window with no corresponding request, during which a legitimate
//    retry only ever received submission_in_progress. A `claimCompleted`
//    flag ensures a claim that DID successfully complete (the
//    transaction committed) is never released after the fact, even if
//    a post-commit step later throws.
//  - §4: the two post-submission email-result events
//    (confirmation/internal-notification sent-or-failed) are now
//    recorded via post-commit.ts's recordPostCommitEvent, which can
//    never throw -- a transient failure persisting THAT event can no
//    longer surface as an error for a request that was already
//    accepted and committed.
// ============================================================

import { intakeRequestSchema, consentVersionsAreCurrent, type IntakeRequestInput } from './schema';
import { ipHash, emailHash, idempotencyKeyHash, payloadFingerprint } from './hash';
import { RATE_LIMITS } from './config';
import * as intakeRequestsRepo from './repositories/intake-requests.repository';
import * as eventsRepo from './repositories/intake-events.repository';
import * as rateLimitsRepo from './repositories/rate-limits.repository';
import * as idempotencyRepo from './repositories/idempotency-keys.repository';
import { recordPostCommitEvent } from './post-commit';
import { withIntakeTransaction } from './db';
import { getTurnstileVerifier, sendEmailSafely } from './adapters';
import { buildConfirmationEmail, buildInternalNotificationEmail } from './adapters/email.adapter';
import { serverConfig } from './config';

export type SubmitIntakeOutcome =
  | { kind: 'accepted'; publicReference: string; wasReplay: boolean }
  | { kind: 'validation_error'; issues: string[] }
  | { kind: 'consent_version_stale' }
  | { kind: 'idempotency_conflict' }
  | { kind: 'submission_in_progress' }
  | { kind: 'turnstile_rejected' }
  | { kind: 'turnstile_provider_error' }
  | { kind: 'rate_limited'; scope: 'ip' | 'email' };

export interface SubmitIntakeContext {
  rawIp: string | null;
}

/** Inspects an ACTIVE existing idempotency row (claim failed) and decides the outcome. Pure decision logic, no I/O. */
function resolveActiveClaimOutcome(
  existing: idempotencyRepo.IdempotencyKeyRow,
  fingerprint: string
): { kind: 'replay'; requestId: string } | { kind: 'conflict' } | { kind: 'in_progress' } | { kind: 'unreachable' } {
  if (existing.payload_fingerprint !== fingerprint) {
    return { kind: 'conflict' };
  }
  if (existing.state === 'completed' && existing.request_id) {
    return { kind: 'replay', requestId: existing.request_id };
  }
  if (existing.state === 'pending') {
    return { kind: 'in_progress' };
  }
  // A 'failed' or expired row with a matching fingerprint should be
  // unreachable here -- claimIdempotencyKey's WHERE clause would have
  // reclaimed it. Treated as a signal to retry the claim once.
  return { kind: 'unreachable' };
}

/** Best-effort claim release used by the R3 §3 failure-recovery wrapper -- never throws, so it can never mask the original failure it is cleaning up after. */
async function releaseClaimBestEffort(keyHash: string, ownerTokenHash: string): Promise<void> {
  try {
    await idempotencyRepo.releaseIdempotencyClaim(keyHash, ownerTokenHash);
  } catch {
    // Swallowed deliberately -- see this function's own doc comment.
  }
}

export async function submitIntakeRequest(
  rawInput: unknown,
  context: SubmitIntakeContext
): Promise<SubmitIntakeOutcome> {
  const parsed = intakeRequestSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      kind: 'validation_error',
      issues: parsed.error.issues.map((issue) => issue.path.join('.') || 'root'),
    };
  }
  const input: IntakeRequestInput = parsed.data;

  if (!consentVersionsAreCurrent(input)) {
    return { kind: 'consent_version_stale' };
  }

  const keyHash = idempotencyKeyHash(input.idempotencyKey);
  const fingerprint = payloadFingerprint(input.workEmail, input.requestType);

  // Up to 2 attempts: a claim can legitimately fail once if we lose
  // a true race to another concurrent claimant, in which case we
  // inspect what they left behind; the only case that calls for a
  // second claim ATTEMPT (not just inspection) is the practically
  // unreachable "matching fingerprint but failed/expired state" case
  // in resolveActiveClaimOutcome, handled by looping.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const ownerToken = idempotencyRepo.generateOwnerToken();
    const ownerTokenHash = idempotencyRepo.hashOwnerToken(ownerToken);

    const claimed = await idempotencyRepo.claimIdempotencyKey({
      idempotencyKeyHash: keyHash,
      payloadFingerprint: fingerprint,
      ownerTokenHash,
    });

    if (!claimed) {
      const existing = await idempotencyRepo.findByHash(keyHash);
      if (!existing) {
        // Vanishingly unlikely (the row was deleted between our
        // failed claim and this read -- nothing in this codebase
        // deletes idempotency rows), but handled explicitly rather
        // than assumed impossible: just retry the claim.
        continue;
      }
      const decision = resolveActiveClaimOutcome(existing, fingerprint);
      switch (decision.kind) {
        case 'conflict':
          return { kind: 'idempotency_conflict' };
        case 'replay': {
          const requestRow = await intakeRequestsRepo.findById(decision.requestId);
          if (requestRow) {
            await eventsRepo.recordEvent(requestRow.id, 'request.idempotency_replay');
            return { kind: 'accepted', publicReference: requestRow.public_reference, wasReplay: true };
          }
          continue; // fall through to retry, same reasoning as the !existing branch
        }
        case 'in_progress':
          return { kind: 'submission_in_progress' };
        case 'unreachable':
          continue;
      }
    }

    // R3 (§3): we own the claim. EVERYTHING from here through the
    // request-creation transaction is wrapped in one try/catch --
    // any UNEXPECTED error (as opposed to the explicit, already-
    // handled rate-limit/Turnstile rejection paths below, which
    // release-and-return rather than throw) triggers a best-effort
    // release of this claim before the original error is rethrown
    // unchanged, so a genuine retry is never stuck behind a claim
    // that failed for a reason it never got the chance to release
    // itself. `claimCompleted` ensures we never release a claim that
    // has already committed as 'completed'.
    let claimCompleted = false;
    try {
      let rawIpHash: string | null = null;
      if (context.rawIp) {
        rawIpHash = ipHash(context.rawIp);
        const ipKey = `ip:${rawIpHash}`;
        const ipResult = await rateLimitsRepo.incrementAndCheck(ipKey, RATE_LIMITS.perIpPerHour);
        if (ipResult.exceeded) {
          await idempotencyRepo.releaseIdempotencyClaim(keyHash, ownerTokenHash);
          return { kind: 'rate_limited', scope: 'ip' };
        }
      }

      // External call -- no database connection or transaction is
      // held here.
      const turnstileResult = await getTurnstileVerifier().verify(input.turnstileToken, context.rawIp ?? undefined);
      if (!turnstileResult.success) {
        await idempotencyRepo.releaseIdempotencyClaim(keyHash, ownerTokenHash);
        return turnstileResult.reason === 'provider_error'
          ? { kind: 'turnstile_provider_error' }
          : { kind: 'turnstile_rejected' };
      }

      const emailKey = `email:${emailHash(input.workEmail)}`;
      const emailResult = await rateLimitsRepo.incrementAndCheck(emailKey, RATE_LIMITS.perEmailPerHour);
      if (emailResult.exceeded) {
        await idempotencyRepo.releaseIdempotencyClaim(keyHash, ownerTokenHash);
        return { kind: 'rate_limited', scope: 'email' };
      }

      // Request creation: request row + request.received event +
      // idempotency-claim completion, one short transaction.
      const row = await withIntakeTransaction(async (query) => {
        const created = await intakeRequestsRepo.insertRequest(query, {
          requestType: input.requestType,
          firstName: input.firstName,
          lastName: input.lastName,
          workEmailNormalized: input.workEmail,
          company: input.company,
          role: input.role,
          phone: input.phone,
          country: input.country,
          estimatedTimeline: input.estimatedTimeline,
          message: input.message,
          privacyVersion: input.privacyVersion,
          termsVersion: input.termsVersion,
          marketingConsent: input.marketingConsent,
          idempotencyKeyHash: keyHash,
          ipHash: rawIpHash,
        });
        await eventsRepo.recordEventInTransaction(query, created.id, 'request.received');
        const completedClaim = await idempotencyRepo.completeIdempotencyClaimInTransaction(query, keyHash, ownerTokenHash, created.id);
        if (!completedClaim) {
          // Should be unreachable (see the repository function's own
          // comment) -- if it ever happens, roll back the whole
          // transaction rather than leave an orphaned request with no
          // completed idempotency record.
          throw new Error('idempotency_claim_completion_failed');
        }
        return created;
      });
      // The transaction committed successfully -- the claim is now
      // 'completed' in the database. From this point on it must
      // never be released, regardless of what happens next (e.g. the
      // best-effort email sends/events below).
      claimCompleted = true;

      // Emails: only after commit, never inside the transaction.
      // Event recording for their outcome is best-effort (R3 §4) --
      // it can never throw, so it can never turn an already-accepted
      // request into a reported failure.
      const confirmation = buildConfirmationEmail({ publicReference: row.public_reference, firstName: row.first_name });
      confirmation.to = row.work_email_normalized;
      confirmation.idempotencyKey = `request-confirmation/${row.id}`;
      const confirmationResult = await sendEmailSafely(confirmation);
      await recordPostCommitEvent(
        row.id,
        confirmationResult.success ? 'request.confirmation_email_sent' : 'request.confirmation_email_failed',
        { route: 'submitIntakeRequest' }
      );

      const internalNotification = buildInternalNotificationEmail({
        publicReference: row.public_reference,
        requestType: row.request_type,
        company: row.company,
      });
      internalNotification.to = serverConfig.intakeInternalToEmail;
      internalNotification.idempotencyKey = `internal-request-notification/${row.id}`;
      const internalResult = await sendEmailSafely(internalNotification);
      await recordPostCommitEvent(
        row.id,
        internalResult.success ? 'request.internal_notification_sent' : 'request.internal_notification_failed',
        { route: 'submitIntakeRequest' }
      );

      return { kind: 'accepted', publicReference: row.public_reference, wasReplay: false };
    } catch (error) {
      if (!claimCompleted) {
        await releaseClaimBestEffort(keyHash, ownerTokenHash);
      }
      throw error;
    }
  }

  // Both attempts hit the practically-unreachable retry path above.
  return { kind: 'idempotency_conflict' };
}
