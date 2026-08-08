import { Router } from 'express';
import { getRequestUserId } from '../auth/request-actor';
import { ApiErrorCodes, failure, success } from '../contracts/api-response';
import { asyncHandler, getRequestId } from '../lib/http';
import { requireDatabase } from '../middleware/database-required';
import { getUserById, listActiveWorkspacesForUser } from '../repositories/auth.repository';

export const identityWorkspacesRouter = Router();

identityWorkspacesRouter.get('/me/workspaces', asyncHandler(async (req, res) => {
  const userId = await getRequestUserId(req, res);
  if (!userId) return;
  if (!(await requireDatabase(res))) return;
  const user = await getUserById(userId);
  if (!user) {
    res.status(401).json(failure(ApiErrorCodes.AUTH_REQUIRED, 'No Phoenix user was found for the authenticated identity.', getRequestId(res)));
    return;
  }
  const items = await listActiveWorkspacesForUser(user.id);
  res.status(200).json(success({ items, total: items.length }, getRequestId(res)));
}));
