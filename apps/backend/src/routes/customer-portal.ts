import { Router, type Response } from 'express';
import { requireAuthenticatedPhoenixUser } from '../auth/request-actor';
import { ApiErrorCodes, failure, success } from '../contracts/api-response';
import { asyncHandler, getRequestId } from '../lib/http';
import { getIntakeServiceClient, type IntakeServiceResult } from '../services/intake-service.client';
import {
  CustomerQuoteDecisionBodySchema,
  CustomerQuoteMessageBodySchema,
  CustomerQuoteParamsSchema,
  IntakeRequestIdParamsSchema,
  PreviewDecisionParamsSchema,PreviewDecisionBodySchema,
} from '../validation/schemas/intake-operations.schemas';
import { formatZodIssues } from '../validation/zod-response';
import { sendValidationError } from '../validation/validation-response';

function writeCustomerServiceFailure(res: Response, result: Exclude<IntakeServiceResult<unknown>, { ok: true }>): void {
  const requestId = getRequestId(res);
  if (result.kind === 'upstream') {
    const code = result.status === 404 ? ApiErrorCodes.NOT_FOUND : ApiErrorCodes.CONFLICT;
    const message = result.status === 404 ? 'The request was not found.' : 'This quotation can no longer be changed.';
    res.status(result.status).json(failure(code, message, requestId));
    return;
  }
  if (result.kind === 'unavailable') {
    res.status(503).json(failure(ApiErrorCodes.INTAKE_SERVICE_UNAVAILABLE, 'The customer portal is temporarily unavailable.', requestId));
    return;
  }
  res.status(502).json(failure(ApiErrorCodes.INTAKE_SERVICE_ERROR, 'The customer portal returned an invalid response.', requestId));
}

export const customerPortalRouter = Router();
const client = getIntakeServiceClient();

customerPortalRouter.get('/customer/intake-requests', asyncHandler(async (req, res) => {
  const actor = await requireAuthenticatedPhoenixUser(req, res);
  if (!actor) return;
  const result = await client.customerList(actor.id, getRequestId(res));
  if (!result.ok) return writeCustomerServiceFailure(res, result);
  res.status(200).json(success(result.data, getRequestId(res)));
}));

customerPortalRouter.get('/customer/intake-requests/:requestId', asyncHandler(async (req, res) => {
  const actor = await requireAuthenticatedPhoenixUser(req, res);
  if (!actor) return;
  const params = IntakeRequestIdParamsSchema.safeParse(req.params);
  if (!params.success) return sendValidationError(res, formatZodIssues(params.error));
  const result = await client.customerDetail(params.data.requestId, actor.id, getRequestId(res));
  if (!result.ok) return writeCustomerServiceFailure(res, result);
  res.status(200).json(success(result.data, getRequestId(res)));
}));

customerPortalRouter.post('/customer/intake-requests/:requestId/quotes/:quoteOfferId/decisions', asyncHandler(async (req, res) => {
  const actor = await requireAuthenticatedPhoenixUser(req, res);
  if (!actor) return;
  const params = CustomerQuoteParamsSchema.safeParse(req.params);
  const body = CustomerQuoteDecisionBodySchema.safeParse(req.body);
  if (!params.success) return sendValidationError(res, formatZodIssues(params.error));
  if (!body.success) return sendValidationError(res, formatZodIssues(body.error));
  const result = await client.customerDecision(params.data.requestId, params.data.quoteOfferId, body.data, actor.id, getRequestId(res));
  if (!result.ok) return writeCustomerServiceFailure(res, result);
  res.status(201).json(success(result.data, getRequestId(res)));
}));

customerPortalRouter.post('/customer/intake-requests/:requestId/quotes/:quoteOfferId/messages', asyncHandler(async (req, res) => {
  const actor = await requireAuthenticatedPhoenixUser(req, res);
  if (!actor) return;
  const params = CustomerQuoteParamsSchema.safeParse(req.params);
  const body = CustomerQuoteMessageBodySchema.safeParse(req.body);
  if (!params.success) return sendValidationError(res, formatZodIssues(params.error));
  if (!body.success) return sendValidationError(res, formatZodIssues(body.error));
  const result = await client.customerMessage(params.data.requestId, params.data.quoteOfferId, body.data.message, actor.id, getRequestId(res));
  if (!result.ok) return writeCustomerServiceFailure(res, result);
  res.status(201).json(success(result.data, getRequestId(res)));
}));
customerPortalRouter.post('/customer/intake-requests/:requestId/preview-proofs/:previewProofId/decisions',asyncHandler(async(req,res)=>{const actor=await requireAuthenticatedPhoenixUser(req,res);if(!actor)return;const p=PreviewDecisionParamsSchema.safeParse(req.params);const b=PreviewDecisionBodySchema.safeParse(req.body);if(!p.success)return sendValidationError(res,formatZodIssues(p.error));if(!b.success)return sendValidationError(res,formatZodIssues(b.error));const result=await client.decidePreview(p.data.requestId,p.data.previewProofId,b.data,actor.id,getRequestId(res));if(!result.ok)return writeCustomerServiceFailure(res,result);res.status(201).json(success(result.data,getRequestId(res)));}));
