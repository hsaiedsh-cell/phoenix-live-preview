// ============================================================
// Intake submission service — core logic, framework-agnostic
// PHX-LAUNCH-001 (R1: PHX-LAUNCH-001-R1 §1-2, §4.3)
// ------------------------------------------------------------
// R1 correction summary:
//  - Replay resolution happens BEFORE Turnstile is consumed (§2.1),
//    so a network retry of an already-persisted submission never
//    fails just because its (single-use) Turnstile token was already
//    spent.
//  - Required check order (§2.3): idempotent replay -> IP rate limit
//    -> Turnstile -> email rate limit -> request creation. An
//    attacker sending the VICTIM's email with an invalid Turnstile
//    token only ever burns the ATTACKER's own IP quota, never the
//    victim's email quota.
//  - The whole flow, including the Turnstile network call, runs
//    inside db.ts's withAdvisoryLock (a session-scoped Postgres
//    lock keyed by the idempotency-key hash) so that truly
//    concurrent submissions using the same idempotency key can never
//    create two request rows -- without ever holding a SQL
//    transaction open across the external Turnstile call (§4.3).
//  - Request creation + its request.received event commit together
//    in one transaction; emails are sent only after that commit.
// ============================================================

import { intakeRequestSchema, consentVersionsAreCurrent, type IntakeRequestInput } from './schema';
import { ipHash, emailHash, idempotencyKeyHash, payloadFingerprint } from './hash';
import { RATE_LIMITS } from './config';
import * as intakeRequestsRepo from './repositories/intake-requests.repository';
import * as eventsRepo from './repositories/intake-events.repository';
import * as rateLimitsRepo from './repositories/rate-limits.repository';
import * as idempotencyRepo from './repositories/idempotency-keys.repository';
import { withAdvisoryLock } from './db';
import { getTurnstileVerifier, sendEmailSafely } from './adapters';
import { buildConfirmationEmail, buildInternalNotificationEmail } from './adapters/email.adapter';
import { serverConfig } from './config';

export type SubmitIntakeOutcome =
  | { kind: 'accepted'; publicReference: string; wasReplay: boolean }
  | { kind: 'validation_error'; issues: string[] }
  | { kind: 'consent_version_stale' }
  | { kind: 'idempotency_conflict' }
  | { kind: 'turnstile_rejected' }
  | { kind: 'turnstile_provider_error' }
  | { kind: 'rate_limited'; scope: 'ip' | 'email' };

export interface SubmitIntakeContext {
  rawIp: string | null;
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

  // Everything from here -- including the Turnstile network call -- is
  // serialized per idempotency-key hash by a session-scoped advisory
  // lock (see db.ts's withAdvisoryLock's header comment for why this
  // is safe to hold across an external call while a SQL transaction
  // would not be).
  return withAdvisoryLock(`intake-idempotency:${keyHash}`, async (locked) => {
    // ---- §2.1: replay resolution BEFORE consuming Turnstile ----
    const existing = await locked.query<idempotencyRepo.IdempotencyKeyRow>(
      `SELECT * FROM public_intake_idempotency_keys WHERE idempotency_key_hash = $1 AND expires_at > now() ORDER BY created_at DESC LIMIT 1`,
      [keyHash]
    );
    const existingKey = existing[0];

    if (existingKey) {
      if (existingKey.payload_fingerprint !== fingerprint) {
        return { kind: 'idempotency_conflict' as const };
      }
      const requestRow = await intakeRequestsRepo.findById(existingKey.request_id);
      if (requestRow) {
        await eventsRepo.recordEvent(requestRow.id, 'request.idempotency_replay');
        return { kind: 'accepted' as const, publicReference: requestRow.public_reference, wasReplay: true };
      }
      // Idempotency row exists but its request vanished (should be
      // unreachable outside manual DB tampering) -- fail safe by
      // treating this as no valid replay rather than crashing.
    }

    // ---- §2.3: IP rate limit BEFORE Turnstile ----
    let rawIpHash: string | null = null;
    if (context.rawIp) {
      rawIpHash = ipHash(context.rawIp);
      const ipKey = `ip:${rawIpHash}`;
      const ipResult = await rateLimitsRepo.incrementAndCheck(ipKey, RATE_LIMITS.perIpPerHour);
      if (ipResult.exceeded) {
        return { kind: 'rate_limited' as const, scope: 'ip' as const };
      }
    }

    // ---- Turnstile (external call; only a session advisory lock is held, no open SQL transaction) ----
    const turnstileResult = await getTurnstileVerifier().verify(input.turnstileToken, context.rawIp ?? undefined);
    if (!turnstileResult.success) {
      return turnstileResult.reason === 'provider_error'
        ? { kind: 'turnstile_provider_error' as const }
        : { kind: 'turnstile_rejected' as const };
    }

    // ---- §2.3: email rate limit AFTER Turnstile succeeds ----
    // An attacker who never has a valid Turnstile token never reaches
    // here, so they can never burn the victim email's quota by
    // submitting invalid tokens with the victim's address.
    const emailKey = `email:${emailHash(input.workEmail)}`;
    const emailResult = await rateLimitsRepo.incrementAndCheck(emailKey, RATE_LIMITS.perEmailPerHour);
    if (emailResult.exceeded) {
      return { kind: 'rate_limited' as const, scope: 'email' as const };
    }

    // ---- Request creation: request row + request.received event + idempotency-key row, one transaction ----
    const row = await locked.transaction(async (query) => {
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
      await idempotencyRepo.insertIdempotencyKey(query, {
        idempotencyKeyHash: keyHash,
        payloadFingerprint: fingerprint,
        requestId: created.id,
      });
      return created;
    });

    // ---- Emails: only after commit, never inside the transaction (§4.3) ----
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

    return { kind: 'accepted' as const, publicReference: row.public_reference, wasReplay: false };
  });
}
