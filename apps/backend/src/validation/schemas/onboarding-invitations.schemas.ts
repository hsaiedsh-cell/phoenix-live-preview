import { z } from 'zod';

export const IssueInvitationBodySchema = z.object({
  membershipId: z.string().uuid(),
  expiresInHours: z.number().int().min(1).max(168).default(72),
}).strict();
export const InvitationIdParamsSchema = z.object({ invitationId: z.string().uuid() }).strict();
export const AcceptInvitationBodySchema = z.object({
  token: z.string().min(40).max(100).regex(/^[A-Za-z0-9_-]+$/),
}).strict();
