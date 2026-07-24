// ============================================================
// Intake request validation schemas
// PHX-LAUNCH-001
// ------------------------------------------------------------
// Zod schemas for the public /api/intake contract (Section 5.3 of
// the Phase 1 Charter). Pure validation logic with zero I/O, so it
// is fully unit-testable without any provider credential.
// ============================================================

import { z } from 'zod';
import { CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION } from './config';

const trimmedString = (max: number, min = 1) =>
  z
    .string()
    .trim()
    .min(min, 'Required')
    .max(max, `Must be ${max} characters or fewer`);

export const requestTypeSchema = z.enum(['assessment', 'demo', 'general']);

export const intakeRequestSchema = z.object({
  requestType: requestTypeSchema,
  firstName: trimmedString(100),
  lastName: trimmedString(100),
  workEmail: z
    .string()
    .trim()
    .toLowerCase()
    .max(320)
    .email('Must be a valid work email address'),
  company: trimmedString(200),
  role: trimmedString(200),
  message: trimmedString(5000),
  phone: trimmedString(40).optional(),
  country: trimmedString(100).optional(),
  estimatedTimeline: trimmedString(100).optional(),
  privacyConsent: z.literal(true, {
    errorMap: () => ({ message: 'Privacy Policy consent is required' }),
  }),
  privacyVersion: z.string().trim().min(1),
  termsVersion: z.string().trim().min(1),
  marketingConsent: z.boolean().optional().default(false),
  turnstileToken: z.string().trim().min(1, 'Bot-protection challenge is required'),
  idempotencyKey: z
    .string()
    .trim()
    .min(8, 'idempotencyKey must be at least 8 characters')
    .max(200),
});

export type IntakeRequestInput = z.infer<typeof intakeRequestSchema>;

/** True when the submitted policy versions match what the server currently serves. */
export function consentVersionsAreCurrent(input: Pick<IntakeRequestInput, 'privacyVersion' | 'termsVersion'>): boolean {
  return input.privacyVersion === CURRENT_PRIVACY_VERSION && input.termsVersion === CURRENT_TERMS_VERSION;
}

export const finalizeRequestSchema = z.object({
  action: z.enum(['under_review', 'reject', 'quote', 'accept', 'close']),
  note: z.string().trim().max(2000).optional(),
});

export const uploadSignSchema = z.object({
  filename: trimmedString(255),
  contentType: z.string().trim().min(1).max(200),
  sizeBytes: z.number().int().positive().max(20 * 1024 * 1024),
});

export const uploadCompleteSchema = z.object({
  storageObjectKey: z.string().trim().min(1).max(500),
});

/** Maximum accepted JSON body size for every intake/upload POST route. */
export const MAX_REQUEST_BODY_BYTES = 32 * 1024; // 32 KB — comfortably above the largest valid payload
