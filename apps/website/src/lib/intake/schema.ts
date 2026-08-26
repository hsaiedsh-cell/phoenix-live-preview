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
  // R5 (§6): client-generated, reused verbatim across sign retries
  // for the same file entry -- never logged, only ever hashed
  // (see hash.ts's reservationKeyHash) before being stored.
  reservationKey: z.string().trim().min(1).max(200),
});

export const uploadCompleteSchema = z.object({
  storageObjectKey: z.string().trim().min(1).max(500),
  finishSession: z.boolean().optional().default(false),
});

/** Maximum accepted JSON body size for every intake/upload POST route. */
export const MAX_REQUEST_BODY_BYTES = 32 * 1024; // 32 KB — comfortably above the largest valid payload

// ============================================================
// PHX-LAUNCH-002 R2 — controlled operator queue validation
// ============================================================

export const intakeRequestStatusSchema = z.enum([
  'received',
  'under_review',
  'upload_invited',
  'files_received',
  'quoted',
  'accepted',
  'rejected',
  'closed',
]);

export const operatorRequestTypeSchema = requestTypeSchema;

const uniqueValues = <T>(values: T[]): boolean => new Set(values).size === values.length;

export const operatorQueueCursorPayloadSchema = z
  .object({
    createdAt: z.string().datetime({ offset: true }),
    requestId: z.string().uuid(),
  })
  .strict();

export type OperatorQueueCursor = z.infer<typeof operatorQueueCursorPayloadSchema>;

const OPERATOR_QUEUE_CURSOR_PATTERN = /^[A-Za-z0-9_-]{1,500}$/;

function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';

  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }

  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function decodeBase64Url(value: string): string {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));

  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

export function encodeOperatorQueueCursor(payload: OperatorQueueCursor): string {
  const validated = operatorQueueCursorPayloadSchema.parse(payload);
  return encodeBase64Url(JSON.stringify(validated));
}

export function decodeOperatorQueueCursor(value: string): OperatorQueueCursor | null {
  if (!OPERATOR_QUEUE_CURSOR_PATTERN.test(value)) return null;

  try {
    const parsed = operatorQueueCursorPayloadSchema.safeParse(
      JSON.parse(decodeBase64Url(value))
    );
    if (!parsed.success) return null;

    return encodeOperatorQueueCursor(parsed.data) === value ? parsed.data : null;
  } catch {
    return null;
  }
}

export const operatorQueueQuerySchema = z
  .object({
    search: z.string().trim().max(200).optional(),
    statuses: z
      .array(intakeRequestStatusSchema)
      .max(8)
      .refine(uniqueValues, 'statuses must not contain duplicates')
      .optional()
      .default([]),
    requestTypes: z
      .array(operatorRequestTypeSchema)
      .max(3)
      .refine(uniqueValues, 'requestTypes must not contain duplicates')
      .optional()
      .default([]),
    createdFrom: z.string().datetime({ offset: true }).optional(),
    createdTo: z.string().datetime({ offset: true }).optional(),
    limit: z.number().int().min(1).max(100).optional().default(25),
    cursor: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .refine((value) => decodeOperatorQueueCursor(value) !== null, 'Invalid cursor')
      .optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (
      input.createdFrom &&
      input.createdTo &&
      Date.parse(input.createdFrom) > Date.parse(input.createdTo)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['createdTo'],
        message: 'createdTo must be greater than or equal to createdFrom',
      });
    }
  });

export type OperatorQueueQueryInput = z.infer<typeof operatorQueueQuerySchema>;

// ============================================================
// PHX-LAUNCH-002 R2 — strict operator status action
// ============================================================

export const operatorActionBodySchema = z
  .object({
    action: z.string().min(1).max(32),
  })
  .strict();

export const operatorActionSchema = z
  .object({
    action: z.enum([
      'under_review',
      'reject',
      'quote',
      'accept',
      'close',
    ]),
  })
  .strict();

export type OperatorAction = z.infer<
  typeof operatorActionSchema
>['action'];
