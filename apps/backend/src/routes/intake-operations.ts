import { Router, type Response } from 'express';
import { requirePlatformSuperAdmin } from '../auth/request-actor';
import { ApiErrorCodes, failure, success } from '../contracts/api-response';
import { asyncHandler, getRequestId } from '../lib/http';
import {
  getIntakeServiceClient,
  type IntakeServiceClient,
  type IntakeServiceResult,
} from '../services/intake-service.client';
import {
  IntakeActionBodySchema,
  IntakeFileParamsSchema,
  IntakeQueueQueryBodySchema,
  IntakeRequestIdParamsSchema,
  SupportedIntakeActionSchema,
} from '../validation/schemas/intake-operations.schemas';
import { formatZodIssues } from '../validation/zod-response';
import { sendValidationError } from '../validation/validation-response';

function writeServiceFailure(res: Response, result: Exclude<IntakeServiceResult<unknown>, { ok: true }>): void {
  const requestId = getRequestId(res);
  if (result.kind === 'upstream') {
    const code = result.status === 404 ? ApiErrorCodes.NOT_FOUND : ApiErrorCodes.CONFLICT;
    const message = result.status === 404 ? 'The intake request was not found.' : 'The intake request status changed before this action completed.';
    res.status(result.status).json(failure(code, message, requestId));
    return;
  }
  if (result.kind === 'unavailable') {
    res.status(503).json(failure(ApiErrorCodes.INTAKE_SERVICE_UNAVAILABLE, 'The intake service is temporarily unavailable.', requestId));
    return;
  }
  res.status(502).json(failure(ApiErrorCodes.INTAKE_SERVICE_ERROR, 'The intake service returned an invalid response.', requestId));
}

type OperatorAuthorizer = typeof requirePlatformSuperAdmin;

export interface IntakeOperationsRouterOptions {
  client?: IntakeServiceClient;
  authorize?: OperatorAuthorizer;
}

export function createIntakeOperationsRouter(options: IntakeOperationsRouterOptions = {}): Router {
  const client = options.client ?? getIntakeServiceClient();
  const authorize: OperatorAuthorizer = options.authorize ?? requirePlatformSuperAdmin;
  const router = Router();

  router.post('/operations/intake-requests/query', asyncHandler(async (req, res) => {
    const actor = await authorize(req, res);
    if (!actor) return;
    const parsed = IntakeQueueQueryBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      sendValidationError(res, formatZodIssues(parsed.error));
      return;
    }
    const result = await client.query(parsed.data, getRequestId(res));
    if (!result.ok) return writeServiceFailure(res, result);
    res.status(200).json(success(result.data, getRequestId(res)));
  }));

  router.get('/operations/intake-requests/:requestId', asyncHandler(async (req, res) => {
    const actor = await authorize(req, res);
    if (!actor) return;
    const parsed = IntakeRequestIdParamsSchema.safeParse(req.params);
    if (!parsed.success) {
      sendValidationError(res, formatZodIssues(parsed.error));
      return;
    }
    const result = await client.detail(parsed.data.requestId, getRequestId(res));
    if (!result.ok) return writeServiceFailure(res, result);
    res.status(200).json(success(result.data, getRequestId(res)));
  }));

  router.post('/operations/intake-requests/:requestId/actions', asyncHandler(async (req, res) => {
    const actor = await authorize(req, res);
    if (!actor) return;
    const params = IntakeRequestIdParamsSchema.safeParse(req.params);
    if (!params.success) {
      sendValidationError(res, formatZodIssues(params.error));
      return;
    }
    const body = IntakeActionBodySchema.safeParse(req.body);
    if (!body.success) {
      sendValidationError(res, formatZodIssues(body.error));
      return;
    }
    const action = SupportedIntakeActionSchema.safeParse(body.data.action);
    if (!action.success) {
      res.status(422).json(failure(ApiErrorCodes.VALIDATION_ERROR, 'The requested intake action is not supported.', getRequestId(res)));
      return;
    }
    const result = await client.action(params.data.requestId, action.data, actor.id, getRequestId(res));
    if (!result.ok) return writeServiceFailure(res, result);
    res.status(200).json(success(result.data, getRequestId(res)));
  }));

  router.post('/operations/intake-requests/:requestId/upload-invitation', asyncHandler(async (req, res) => {
    const actor = await authorize(req, res);
    if (!actor) return;
    const parsed = IntakeRequestIdParamsSchema.safeParse(req.params);
    if (!parsed.success) {
      sendValidationError(res, formatZodIssues(parsed.error));
      return;
    }
    const result = await client.inviteUpload(parsed.data.requestId, actor.id, getRequestId(res));
    if (!result.ok) return writeServiceFailure(res, result);
    res.status(200).json(success(result.data, getRequestId(res)));
  }));

  router.get('/operations/intake-requests/:requestId/files/:fileId/download', asyncHandler(async (req, res) => {
    const actor = await authorize(req, res);
    if (!actor) return;
    const parsed = IntakeFileParamsSchema.safeParse(req.params);
    if (!parsed.success) {
      sendValidationError(res, formatZodIssues(parsed.error));
      return;
    }
    const result = await client.downloadFile(parsed.data.requestId, parsed.data.fileId, getRequestId(res));
    if (!result.ok) return writeServiceFailure(res, result);
    res.status(200).json(success(result.data, getRequestId(res)));
  }));

  return router;
}

export const intakeOperationsRouter = createIntakeOperationsRouter();
