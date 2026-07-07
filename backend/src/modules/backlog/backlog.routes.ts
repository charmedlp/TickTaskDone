import { Router } from 'express';
import { asyncHandler } from '../../middleware/errorHandler';
import { listBacklog } from './backlog.service';

// Mounted under /workspaces/:workspaceId/backlog.
export const backlogRouter = Router({ mergeParams: true });

backlogRouter.get(
  '/',
  asyncHandler(async (request, response) => {
    response.json(await listBacklog(request.workspaceId, request.currentUser.idUser));
  }),
);
