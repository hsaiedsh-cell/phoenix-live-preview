// ============================================================
// Transactional email adapter (Resend)
// PHX-LAUNCH-001
// ------------------------------------------------------------
// Route handlers depend on the `EmailSender` interface. The live
// Resend-backed implementation is never exercised in this sprint's
// QA (no RESEND_API_KEY / verified sending domain available) — every
// email test in Gate 5 runs against createFakeEmailSender and is
// reported as an adapter/mock test, not a live-delivery test.
//
// No email body, recipient, or upload token is ever written to
// server logs by this module or its callers — only counts and
// booleans (see the call-count assertions in the Gate 5 QA script).
// ============================================================

import { Resend } from 'resend';
import { serverConfig } from '../config';

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
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
        const result = await client.emails.send({
          from: serverConfig.intakeFromEmail,
          to: input.to,
          subject: input.subject,
          html: input.html,
          text: input.text,
        });
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
): EmailSender & { sentMessages: SendEmailInput[] } {
  return {
    sentMessages: [] as SendEmailInput[],
    async send(input: SendEmailInput): Promise<EmailSendResult> {
      this.sentMessages.push(input);
      if (behavior === 'always_fail') return { success: false };
      return { success: true, providerMessageId: `fake-${this.sentMessages.length}` };
    },
  };
}

// ---- Email content builders (pure functions, no I/O) ----------

export function buildConfirmationEmail(input: { publicReference: string; firstName: string }): SendEmailInput {
  return {
    to: '', // caller fills in the actual recipient
    subject: `We received your Phoenix request (${input.publicReference})`,
    text: `Hi ${input.firstName},\n\nThanks for reaching out to Phoenix. Your reference number is ${input.publicReference}. Our team will review your request and follow up by email shortly.\n\n— The Phoenix team`,
    html: `<p>Hi ${input.firstName},</p><p>Thanks for reaching out to Phoenix. Your reference number is <strong>${input.publicReference}</strong>. Our team will review your request and follow up by email shortly.</p><p>— The Phoenix team</p>`,
  };
}

export function buildInternalNotificationEmail(input: {
  publicReference: string;
  requestType: string;
  company: string;
}): SendEmailInput {
  return {
    to: '',
    subject: `New Phoenix ${input.requestType} request — ${input.publicReference}`,
    text: `New request received.\n\nReference: ${input.publicReference}\nType: ${input.requestType}\nCompany: ${input.company}\n\nReview it in the operations tooling.`,
    html: `<p>New request received.</p><ul><li>Reference: ${input.publicReference}</li><li>Type: ${input.requestType}</li><li>Company: ${input.company}</li></ul>`,
  };
}

export function buildUploadInvitationEmail(input: { publicReference: string; uploadUrl: string; expiresAt: Date }): SendEmailInput {
  return {
    to: '',
    subject: `Upload your files for Phoenix request ${input.publicReference}`,
    text: `You're invited to securely upload files for request ${input.publicReference}.\n\nUpload link (expires ${input.expiresAt.toISOString()}): ${input.uploadUrl}\n\nThis link can only be used once.`,
    html: `<p>You're invited to securely upload files for request <strong>${input.publicReference}</strong>.</p><p><a href="${input.uploadUrl}">Upload your files</a> (expires ${input.expiresAt.toISOString()}).</p><p>This link can only be used once.</p>`,
  };
}

export function buildUploadCompleteInternalEmail(input: { publicReference: string; fileCount: number }): SendEmailInput {
  return {
    to: '',
    subject: `Files received for ${input.publicReference}`,
    text: `${input.fileCount} file(s) were received for request ${input.publicReference}. Files remain pending_review until scanned.`,
    html: `<p>${input.fileCount} file(s) were received for request <strong>${input.publicReference}</strong>. Files remain <code>pending_review</code> until scanned.</p>`,
  };
}
