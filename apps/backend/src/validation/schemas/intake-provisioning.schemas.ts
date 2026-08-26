import { z } from 'zod';

export const IntakeProvisioningBodySchema = z.object({
  sourceReference: z.string().trim().min(1).max(100),
  sourceStatus: z.string().trim().min(1).max(50),
  requestType: z.enum(['assessment', 'demo', 'general']),
  company: z.string().trim().min(1).max(500),
  firstName: z.string().trim().min(1).max(200),
  lastName: z.string().trim().min(1).max(200),
  workEmail: z.string().trim().toLowerCase().email().max(320),
}).strict();

export type IntakeProvisioningCommand = z.infer<typeof IntakeProvisioningBodySchema>;
