// ============================================================
// Transactional email adapter (Resend)
// PHX-LAUNCH-001 (R1: PHX-LAUNCH-001-R1 §4.1, §4.2)
// ------------------------------------------------------------
// Route handlers depend on the `EmailSender` interface. The live
// Resend-backed implementation is never exercised in this sprint's
// QA (no RESEND_API_KEY / verified sending domain available) -- every
// email test runs against createFakeEmailSender and is reported as
// an adapter/mock test, not a live-delivery test.
//
// R1: every email template routes every dynamic value through
// escapeHtml() before interpolating it into the HTML body (§4.1),
// and every SendEmailInput carries a stable `idempotencyKey`
// forwarded to Resend's own idempotency mechanism (§4.2) so a retry
// of the same logical send (e.g. after a timeout) can never result
// in the provider actually dispatching the email twice.
//
// No email body, recipient, or upload token is ever written to
// server logs by this module or its callers -- only counts and
// booleans.
// ============================================================

import { Resend } from 'resend';
import { serverConfig } from '../config';
import { escapeHtml } from '../html-escape';

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
  /**
   * Stable per-semantic-email idempotency key (e.g.
   * `request-confirmation/<requestId>`), forwarded to Resend's
   * `Idempotency-Key` header. A retry using the same key will never
   * cause Resend to send the email a second time.
   */
  idempotencyKey: string;
}

export interface EmailSendResult {
  success: boolean;
  providerMessageId?: string;
}

export interface EmailSender {
  send(input: SendEmailInput): Promise<EmailSendResult>;
}

export function createLiveEmailSender(): EmailSender {
  const client = new Resend(serverConfig.resendApiKey);
  return {
    async send(input: SendEmailInput): Promise<EmailSendResult> {
      try {
        const result = await client.emails.send(
          {
            from: serverConfig.intakeFromEmail,
            replyTo: serverConfig.intakeReplyToEmail,
            to: input.to,
            subject: input.subject,
            html: input.html,
            text: input.text,
          },
          { idempotencyKey: input.idempotencyKey }
        );
        if (result.error) {
          return { success: false };
        }
        return { success: true, providerMessageId: result.data?.id };
      } catch {
        return { success: false };
      }
    },
  };
}

export function createFakeEmailSender(
  behavior: 'always_succeed' | 'always_fail' = 'always_succeed'
): EmailSender & { sentMessages: SendEmailInput[]; idempotencyKeysUsed: string[] } {
  const idempotencyKeysUsed: string[] = [];
  return {
    sentMessages: [] as SendEmailInput[],
    idempotencyKeysUsed,
    async send(input: SendEmailInput): Promise<EmailSendResult> {
      // A real provider would deduplicate by idempotencyKey and NOT
      // actually dispatch twice; this fake records every attempt
      // separately (sentMessages) so a test can also assert on
      // "attempted N times but the idempotency key repeated" as a
      // proxy for "the provider would have deduplicated this".
      this.sentMessages.push(input);
      idempotencyKeysUsed.push(input.idempotencyKey);
      if (behavior === 'always_fail') return { success: false };
      return { success: true, providerMessageId: `fake-${this.sentMessages.length}` };
    },
  };
}

// ---- Email content builders (pure functions, no I/O) ----------
// Every dynamic value is passed through escapeHtml() before being
// placed into the `html` field (PHX-LAUNCH-001-R1 §4.1). The `text`
// field is plain text and is never escaped (no markup interpreter
// reads it).

export function buildConfirmationEmail(input: { publicReference: string; firstName: string }): SendEmailInput {
  const safeFirstName = escapeHtml(input.firstName);
  const safeReference = escapeHtml(input.publicReference);
  return {
    to: '', // caller fills in the actual recipient
    subject: `We received your Phoenix request (${input.publicReference})`,
    text: `Hi ${input.firstName},\n\nThanks for reaching out to Phoenix. Your reference number is ${input.publicReference}. Our team will review your request and follow up by email shortly.\n\n— The Phoenix team`,
    html: `<p>Hi ${safeFirstName},</p><p>Thanks for reaching out to Phoenix. Your reference number is <strong>${safeReference}</strong>. Our team will review your request and follow up by email shortly.</p><p>— The Phoenix team</p>`,
    idempotencyKey: '', // caller sets the semantic key: request-confirmation/<requestId>
  };
}

export function buildInternalNotificationEmail(input: {
  publicReference: string;
  requestType: string;
  company: string;
}): SendEmailInput {
  const safeReference = escapeHtml(input.publicReference);
  const safeType = escapeHtml(input.requestType);
  const safeCompany = escapeHtml(input.company);
  return {
    to: '',
    subject: `New Phoenix ${input.requestType} request — ${input.publicReference}`,
    text: `New request received.\n\nReference: ${input.publicReference}\nType: ${input.requestType}\nCompany: ${input.company}\n\nReview it in the operations tooling.`,
    html: `<p>New request received.</p><ul><li>Reference: ${safeReference}</li><li>Type: ${safeType}</li><li>Company: ${safeCompany}</li></ul>`,
    idempotencyKey: '', // caller sets: internal-request-notification/<requestId>
  };
}

export function buildUploadInvitationEmail(input: { publicReference: string; uploadUrl: string; expiresAt: Date }): SendEmailInput {
  const safeReference = escapeHtml(input.publicReference);
  const safeUploadUrl = escapeHtml(input.uploadUrl);
  const safeExpiresAt = escapeHtml(input.expiresAt.toISOString());
  return {
    to: '',
    subject: `Upload your files for Phoenix request ${input.publicReference}`,
    text: `You're invited to securely upload files for request ${input.publicReference}.\n\nUpload link (expires ${input.expiresAt.toISOString()}): ${input.uploadUrl}\n\nThis link can only be used once.`,
    html: `<p>You're invited to securely upload files for request <strong>${safeReference}</strong>.</p><p><a href="${safeUploadUrl}">Upload your files</a> (expires ${safeExpiresAt}).</p><p>This link can only be used once.</p>`,
    idempotencyKey: '', // caller sets: upload-invitation/<uploadSessionId>
  };
}

export function buildUploadCompleteInternalEmail(input: { publicReference: string; fileCount: number }): SendEmailInput {
  const safeReference = escapeHtml(input.publicReference);
  return {
    to: '',
    subject: `Files received for ${input.publicReference}`,
    text: `${input.fileCount} file(s) were received for request ${input.publicReference}. Files remain pending_review until scanned.`,
    html: `<p>${input.fileCount} file(s) were received for request <strong>${safeReference}</strong>. Files remain <code>pending_review</code> until scanned.</p>`,
    idempotencyKey: '', // caller sets: upload-complete/<uploadSessionId>
  };
}

export function buildQuoteEmail(input: {
  publicReference: string;
  firstName: string;
  priceAmount: number;
  currency: 'USD' | 'AED';
  deliveryHours: number;
  fileFormats: string[];
  revisionRounds: number;
  additionalRevisionPrice: number;
}): SendEmailInput {
  const safe = {
    reference: escapeHtml(input.publicReference),
    firstName: escapeHtml(input.firstName),
    currency: escapeHtml(input.currency),
    formats: escapeHtml(input.fileFormats.join(', ')),
  };
  const price = `${input.currency} ${input.priceAmount.toFixed(2)}`;
  const extraRevision = `${input.currency} ${input.additionalRevisionPrice.toFixed(2)}`;
  return {
    to: '',
    subject: `Phoenix quotation for ${input.publicReference} — ${price}`,
    text: `Hi ${input.firstName},\n\nWe reviewed your files and prepared the following quotation for request ${input.publicReference}.\n\nPrice: ${price}\nDelivery: ${input.deliveryHours} hours after approval\nDeliverables: ${input.fileFormats.join(', ')}\nIncluded revisions: ${input.revisionRounds} rounds\nAdditional revisions: ${extraRevision} per round\n\nWorkflow:\n1. Reply to approve this quotation.\n2. Phoenix prepares a watermarked or reduced-resolution preview proof.\n3. After final proof approval, Phoenix sends a secure payment link.\n4. Editable and high-resolution final files are released after full payment.\n\nMajor redesigns or new creative directions are quoted separately. Font matching is subject to availability and licensing. By approving, you confirm authorization to reproduce the submitted artwork.\n\n— The Phoenix team`,
    html: `<p>Hi ${safe.firstName},</p><p>We reviewed your files and prepared the following quotation for request <strong>${safe.reference}</strong>.</p><ul><li><strong>Price:</strong> ${safe.currency} ${input.priceAmount.toFixed(2)}</li><li><strong>Delivery:</strong> ${input.deliveryHours} hours after approval</li><li><strong>Deliverables:</strong> ${safe.formats}</li><li><strong>Included revisions:</strong> ${input.revisionRounds} rounds</li><li><strong>Additional revisions:</strong> ${safe.currency} ${input.additionalRevisionPrice.toFixed(2)} per round</li></ul><h3>Workflow</h3><ol><li>Reply to approve this quotation.</li><li>Phoenix prepares a watermarked or reduced-resolution preview proof.</li><li>After final proof approval, Phoenix sends a secure payment link.</li><li>Editable and high-resolution final files are released after full payment.</li></ol><p>Major redesigns or new creative directions are quoted separately. Font matching is subject to availability and licensing. By approving, you confirm authorization to reproduce the submitted artwork.</p><p>— The Phoenix team</p>`,
    idempotencyKey: '',
  };
}
