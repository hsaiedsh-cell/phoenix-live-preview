import { Router } from 'express';
import { requirePlatformSuperAdmin } from '../auth/request-actor';
import { ApiErrorCodes, failure, success } from '../contracts/api-response';
import { asyncHandler, getRequestId } from '../lib/http';
import {
  IntakeProvisioningConflictError,
  provisionIntakeWorkspace,
} from '../services/intake-workspace-provisioning.service';
import { IntakeProvisioningBodySchema } from '../validation/schemas/intake-provisioning.schemas';
import { formatZodIssues } from '../validation/zod-response';
import { sendValidationError } from '../validation/validation-response';

export const intakeProvisioningRouter = Router();

intakeProvisioningRouter.post(
  '/operations/intake-workspace-handoffs',
  asyncHandler(async (req, res) => {
    const actor = await requirePlatformSuperAdmin(req, res);
    if (!actor) return;

    const parsed = IntakeProvisioningBodySchema.safeParse(req.body);
    if (!parsed.success) {
      sendValidationError(res, formatZodIssues(parsed.error));
      return;
    }

    if (parsed.data.sourceStatus !== 'accepted') {
      res.status(422).json(failure(
        ApiErrorCodes.VALIDATION_ERROR,
        'Only an accepted intake request can be provisioned.',
        getRequestId(res)
      ));
      return;
    }

    try {
      const result = await provisionIntakeWorkspace(parsed.data, actor.id);
      res.status(result.outcome === 'created' ? 201 : 200).json(success(result, getRequestId(res)));
    } catch (error) {
      if (error instanceof IntakeProvisioningConflictError) {
        res.status(409).json(failure(
          ApiErrorCodes.CONFLICT,
          'The intake request cannot be provisioned in its current state.',
          getRequestId(res)
        ));
        return;
      }
      throw error;
    }
  })
);
