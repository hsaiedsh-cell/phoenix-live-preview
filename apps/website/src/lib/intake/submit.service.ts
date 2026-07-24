// ============================================================
// Intake submission service — core logic, framework-agnostic
// PHX-LAUNCH-001
// ------------------------------------------------------------
// Extracted out of the route handler (src/app/api/intake/route.ts)
// so that Gate 4 QA can call `submitIntakeRequest` directly with
// injected fake adapters, without needing to run a Next.js server
// or perform any real HTTP request.
// ============================================================

import { intakeRequestSchema, consentVersionsAreCurrent, type IntakeRequestInput } from './schema';
import { ipHash, emailHash, idempotencyKeyHash } from './hash';
import { RATE_LIMITS } from './config';
import * as intakeRequestsRepo from './repositories/intake-requests.repository';
import * as eventsRepo from './repositories/intake-events.repository';
import * as rateLimitsRepo from './repositories/rate-limits.repository';
import { getTurnstileVerifier, sendEmailSafely } from './adapters';
import {
  buildConfirmationEmail,
  buildInternalNotificationEmail,
} from './adapters/email.adapter';
import { serverConfig } from './config';

export type SubmitIntakeOutcome =
  | { kind: 'accepted'; publicReference: string; wasReplay: boolean }
  | { kind: 'validation_error'; issues: string[] }
  | { kind: 'consent_version_stale' }
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

  // Rate limiting happens BEFORE Turnstile verification so an
  // attacker cannot burn Turnstile verification calls indefinitely;
  // it also happens before any database write.
  const emailKey = `email:${emailHash(input.workEmail)}`;
  const emailResult = await rateLimitsRepo.incrementAndCheck(emailKey, RATE_LIMITS.perEmailPerHour);
  if (emailResult.exceeded) {
    return { kind: 'rate_limited', scope: 'email' };
  }

  let rawIpHash: string | null = null;
  if (context.rawIp) {
    rawIpHash = ipHash(context.rawIp);
    const ipKey = `ip:${rawIpHash}`;
    const ipResult = await rateLimitsRepo.incrementAndCheck(ipKey, RATE_LIMITS.perIpPerHour);
    if (ipResult.exceeded) {
      return { kind: 'rate_limited', scope: 'ip' };
    }
  }

  const turnstileResult = await getTurnstileVerifier().verify(input.turnstileToken, context.rawIp ?? undefined);
  if (!turnstileResult.success) {
    return turnstileResult.reason === 'provider_error'
      ? { kind: 'turnstile_provider_error' }
      : { kind: 'turnstile_rejected' };
  }

  const { row, wasCreated } = await intakeRequestsRepo.createOrGetByIdempotencyKey({
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
    idempotencyKeyHash: idempotencyKeyHash(input.idempotencyKey),
    ipHash: rawIpHash,
  });

  if (!wasCreated) {
    await eventsRepo.recordEvent(row.id, 'request.duplicate_suppressed');
    return { kind: 'accepted', publicReference: row.public_reference, wasReplay: true };
  }

  await eventsRepo.recordEvent(row.id, 'request.received');

  // Confirmation + internal notification emails. Failure here must
  // never roll back or duplicate the already-persisted request — it
  // only records an operational event so staff can follow up
  // manually (Gate 5 requirement).
  const confirmation = buildConfirmationEmail({ publicReference: row.public_reference, firstName: row.first_name });
  confirmation.to = row.work_email_normalized;
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
  const internalResult = await sendEmailSafely(internalNotification);
  await eventsRepo.recordEvent(
    row.id,
    internalResult.success ? 'request.internal_notification_sent' : 'request.internal_notification_failed'
  );

  return { kind: 'accepted', publicReference: row.public_reference, wasReplay: false };
}
