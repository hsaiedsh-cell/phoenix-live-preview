// ============================================================
// Intake submission service -- core logic, framework-agnostic
// PHX-LAUNCH-001 (R2: PHX-LAUNCH-001-R2 §1 -- lock-free idempotency
// state machine, transaction-pooler-compatible)
// ------------------------------------------------------------
// R2 correction summary:
//  - The R1 session-scoped advisory lock is GONE. Idempotency safety
//    now comes entirely from idempotency-keys.repository.ts's atomic
//    claim/release/complete statements against a genuinely UNIQUE
//    idempotency_key_hash column -- no lock, no connection held
//    across the external Turnstile call, safe under a
//    transaction-mode connection pooler.
//  - Required order unchanged from R1 (§2.3 there, restated here):
//    claim/replay resolution -> IP rate limit -> Turnstile -> email
//    rate limit -> request creation. A claim that fails Turnstile or
//    either rate limit is explicitly RELEASED (state='failed'),
//    immediately reclaimable by a genuine retry.
//  - Request creation + its request.received event + the idempotency
//    claim's completion all commit together in ONE short transaction;
//    emails are sent only after that commit, never inside it.
// ============================================================

import { intakeRequestSchema, consentVersionsAreCurrent, type IntakeRequestInput } from './schema';
import { ipHash, emailHash, idempotencyKeyHash, payloadFingerprint } from './hash';
import { RATE_LIMITS } from './config';
import * as intakeRequestsRepo from './repositories/intake-requests.repository';
import * as eventsRepo from './repositories/intake-events.repository';
import * as rateLimitsRepo from './repositories/rate-limits.repository';
import * as idempotencyRepo from './repositories/idempotency-keys.repository';
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

    // We own the claim. Every step below either succeeds and reaches
    // request creation, or explicitly releases the claim before
    // returning, so a genuine retry can always reclaim it promptly.

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

    // External call -- no database connection or transaction is held
    // here (PHX-LAUNCH-001-R2 §1.2 item 10).
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

    // Emails: only after commit, never inside the transaction.
    const confirmation = buildConfirmationEmail({ publicReference: row.public_reference, firstName: row.first_name });
    confirmation.to = row.work_email_normalized;
    confirmation.idempotencyKey = `request-confirmation/${row.id}`;
    const confirmationResult = await sendEmailSafely(confirmation);
    await eventsRepo.recordEvent(
      row.id,
      confirmationResult.success ? 'request.confirmation_email_sent' : 'request.confirmation_email_failed'
    );

    const internalNotification = buildInternalNotificationEmail({
      publicReference: row.public_reference,
      requestType: row.request_type,
      company: row.company,
    });
    internalNotification.to = serverConfig.intakeInternalToEmail;
    internalNotification.idempotencyKey = `internal-request-notification/${row.id}`;
    const internalResult = await sendEmailSafely(internalNotification);
    await eventsRepo.recordEvent(
      row.id,
      internalResult.success ? 'request.internal_notification_sent' : 'request.internal_notification_failed'
    );

    return { kind: 'accepted', publicReference: row.public_reference, wasReplay: false };
  }

  // Both attempts hit the practically-unreachable retry path above.
  return { kind: 'idempotency_conflict' };
}
