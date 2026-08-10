import { z } from 'zod';
import { Buffer } from 'node:buffer';

export const IntakeRequestStatusSchema = z.enum([
  'received', 'under_review', 'upload_invited', 'files_received',
  'quoted', 'accepted', 'rejected', 'closed',
]);

export const IntakeRequestTypeSchema = z.enum(['assessment', 'demo', 'general']);

const uniqueArray = <T extends z.ZodTypeAny>(item: T, maximum: number) =>
  z.array(item).max(maximum).refine((values) => new Set(values).size === values.length, {
    message: 'Values must be unique.',
  });

const cursorPayloadSchema = z.object({
  createdAt: z.string().datetime({ offset: true }),
  requestId: z.string().uuid(),
}).strict();

function isCanonicalCursor(value: string): boolean {
  if (!/^[A-Za-z0-9_-]{1,500}$/.test(value)) return false;
  try {
    const decoded = Buffer.from(value, 'base64url').toString('utf8');
    if (!cursorPayloadSchema.safeParse(JSON.parse(decoded) as unknown).success) return false;
    return Buffer.from(decoded, 'utf8').toString('base64url') === value;
  } catch {
    return false;
  }
}

export const IntakeQueueQueryBodySchema = z
  .object({
    search: z.string().trim().max(200).optional(),
    statuses: uniqueArray(IntakeRequestStatusSchema, 8).optional().default([]),
    requestTypes: uniqueArray(IntakeRequestTypeSchema, 3).optional().default([]),
    createdFrom: z.string().datetime({ offset: true }).optional(),
    createdTo: z.string().datetime({ offset: true }).optional(),
    limit: z.number().int().min(1).max(100).default(25),
    cursor: z.string().trim().min(1).max(500).refine(isCanonicalCursor, 'Invalid cursor.').optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.createdFrom && value.createdTo && Date.parse(value.createdFrom) > Date.parse(value.createdTo)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['createdTo'],
        message: 'createdTo must be at or after createdFrom.',
      });
    }
  });

export const IntakeRequestIdParamsSchema = z.object({ requestId: z.string().uuid() }).strict();
export const IntakeFileParamsSchema = z.object({
  requestId: z.string().uuid(),
  fileId: z.string().uuid(),
}).strict();

export const IntakeActionBodySchema = z
  .object({ action: z.string().trim().min(1).max(50) })
  .strict();

export const IntakeQuoteBodySchema = z.object({
  priceAmount: z.number().positive().max(1_000_000),
  currency: z.enum(['USD', 'AED']),
  deliveryHours: z.number().int().min(1).max(720),
  fileFormats: z.array(z.enum(['AI', 'SVG', 'JPEG', 'PNG', 'PDF', 'EPS'])).min(1).max(6),
  revisionRounds: z.number().int().min(0).max(20),
  additionalRevisionPrice: z.number().nonnegative().max(100_000),
}).strict();

export const SupportedIntakeActionSchema = z.enum([
  'under_review', 'reject', 'quote', 'accept', 'close',
]);

export const CustomerQuoteParamsSchema = z.object({
  requestId: z.string().uuid(),
  quoteOfferId: z.string().uuid(),
}).strict();

export const CustomerQuoteDecisionBodySchema = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('approved'), termsAcceptedVersion: z.string().trim().min(1).max(100) }).strict(),
  z.object({ decision: z.literal('declined'), reason: z.string().trim().min(1).max(4000) }).strict(),
  z.object({ decision: z.literal('changes_requested'), reason: z.string().trim().min(1).max(4000) }).strict(),
]);

export const CustomerQuoteMessageBodySchema = z.object({
  message: z.string().trim().min(1).max(4000),
}).strict();

export const IntakeCustomerAccessBodySchema = z.object({
  customerUserId: z.string().uuid(),
}).strict();

export const FulfillmentStatusSchema = z.enum([
  'accepted', 'in_progress', 'preview_ready', 'payment_pending',
  'paid', 'final_files_delivered', 'cancelled',
]);

export const FulfillmentTransitionBodySchema = z.object({
  status: FulfillmentStatusSchema,
}).strict();
export const PreviewSignBodySchema=z.object({filename:z.string().trim().min(1).max(255),contentType:z.enum(['application/pdf','image/png','image/jpeg']),sizeBytes:z.number().int().min(1).max(20*1024*1024)}).strict();
export const PreviewCompleteBodySchema=z.object({previewProofId:z.string().uuid(),storageObjectKey:z.string().min(1).max(500)}).strict();
export const FinalDeliverableSignBodySchema=z.object({filename:z.string().trim().min(1).max(255),contentType:z.enum(['application/zip','application/x-zip-compressed']),sizeBytes:z.number().int().min(1).max(60*1024*1024)}).strict();
export const FinalDeliverableCompleteBodySchema=z.object({finalDeliverableId:z.string().uuid(),storageObjectKey:z.string().min(1).max(500)}).strict();
export const PreviewDecisionParamsSchema=z.object({requestId:z.string().uuid(),previewProofId:z.string().uuid()}).strict();
export const PreviewDecisionBodySchema=z.discriminatedUnion('decision',[z.object({decision:z.literal('approved')}).strict(),z.object({decision:z.literal('revision_requested'),reason:z.string().trim().min(1).max(4000)}).strict()]);
