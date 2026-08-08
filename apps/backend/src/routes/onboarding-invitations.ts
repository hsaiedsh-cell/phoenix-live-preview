import { Router } from 'express';
import { requirePlatformSuperAdmin } from '../auth/request-actor';
import { ApiErrorCodes, failure, success } from '../contracts/api-response';
import { asyncHandler, getRequestId } from '../lib/http';
import {
  acceptOnboardingInvitation,
  issueOnboardingInvitation,
  OnboardingInvitationError,
  reissueOnboardingInvitation,
  revokeOnboardingInvitation,
} from '../services/onboarding-invitation.service';
import {
  AcceptInvitationBodySchema,
  InvitationIdParamsSchema,
  IssueInvitationBodySchema,
} from '../validation/schemas/onboarding-invitations.schemas';
import { formatZodIssues } from '../validation/zod-response';
import { sendValidationError } from '../validation/validation-response';

export const onboardingInvitationsRouter = Router();

function isConflict(error: unknown): boolean {
  return error instanceof OnboardingInvitationError && error.reason === 'conflict'
    || (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505');
}

function writeLifecycleError(error: unknown, res: Parameters<typeof sendValidationError>[0]): boolean {
  const requestId = getRequestId(res);
  if (error instanceof OnboardingInvitationError && error.reason === 'not_found') {
    res.status(404).json(failure(ApiErrorCodes.NOT_FOUND, 'The onboarding invitation was not found.', requestId));
    return true;
  }
  if (isConflict(error)) {
    res.status(409).json(failure(ApiErrorCodes.CONFLICT, 'The onboarding invitation cannot be used in its current state.', requestId));
    return true;
  }
  return false;
}

onboardingInvitationsRouter.post('/operations/onboarding-invitations', asyncHandler(async (req, res) => {
  const actor = await requirePlatformSuperAdmin(req, res);
  if (!actor) return;
  const parsed = IssueInvitationBodySchema.safeParse(req.body);
  if (!parsed.success) return sendValidationError(res, formatZodIssues(parsed.error));
  try {
    const result = await issueOnboardingInvitation(parsed.data.membershipId, parsed.data.expiresInHours, actor.id);
    res.status(201).json(success(result, getRequestId(res)));
  } catch (error) {
    if (!writeLifecycleError(error, res)) throw error;
  }
}));

onboardingInvitationsRouter.post('/operations/onboarding-invitations/:invitationId/revoke', asyncHandler(async (req, res) => {
  const actor = await requirePlatformSuperAdmin(req, res);
  if (!actor) return;
  const params = InvitationIdParamsSchema.safeParse(req.params);
  if (!params.success) return sendValidationError(res, formatZodIssues(params.error));
  try {
    res.status(200).json(success(await revokeOnboardingInvitation(params.data.invitationId, actor.id), getRequestId(res)));
  } catch (error) {
    if (!writeLifecycleError(error, res)) throw error;
  }
}));

onboardingInvitationsRouter.post('/operations/onboarding-invitations/:invitationId/reissue', asyncHandler(async (req, res) => {
  const actor = await requirePlatformSuperAdmin(req, res);
  if (!actor) return;
  const params = InvitationIdParamsSchema.safeParse(req.params);
  const body = IssueInvitationBodySchema.omit({ membershipId: true }).safeParse(req.body ?? {});
  if (!params.success) return sendValidationError(res, formatZodIssues(params.error));
  if (!body.success) return sendValidationError(res, formatZodIssues(body.error));
  try {
    const result = await reissueOnboardingInvitation(params.data.invitationId, body.data.expiresInHours, actor.id);
    res.status(201).json(success(result, getRequestId(res)));
  } catch (error) {
    if (!writeLifecycleError(error, res)) throw error;
  }
}));

onboardingInvitationsRouter.post('/onboarding-invitations/accept', asyncHandler(async (req, res) => {
  const parsed = AcceptInvitationBodySchema.safeParse(req.body);
  if (!parsed.success) return sendValidationError(res, formatZodIssues(parsed.error));
  try {
    const result = await acceptOnboardingInvitation(parsed.data.token);
    if (result.status === 'Expired') {
      res.status(410).json(failure(ApiErrorCodes.CONFLICT, 'The onboarding invitation has expired.', getRequestId(res)));
      return;
    }
    res.status(200).json(success(result, getRequestId(res)));
  } catch (error) {
    if (!writeLifecycleError(error, res)) throw error;
  }
}));
