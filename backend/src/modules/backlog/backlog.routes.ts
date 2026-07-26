import { Router } from 'express';
import { occurrenceWindowQuery } from '@ticktaskdone/shared';
import { asyncHandler } from '../../middleware/errorHandler';
import { AppError } from '../../http/errors';
import { listBacklog, listRecurringUnplanned } from './backlog.service';

// Mounted under /workspaces/:workspaceId/backlog.
export const backlogRouter = Router({ mergeParams: true });

backlogRouter.get(
  '/',
  asyncHandler(async (request, response) => {
    response.json(await listBacklog(request.workspaceId, request.currentUser.idUser));
  }),
);

// Recurring tasks absent from a given window (second tray) — needs from/to like the feed.
backlogRouter.get(
  '/recurring',
  asyncHandler(async (request, response) => {
    const parsed = occurrenceWindowQuery.safeParse(request.query);
    if (!parsed.success) {
      throw new AppError(400, 'INVALID_DATE_WINDOW', parsed.error.issues);
    }
    response.json(
      await listRecurringUnplanned(request.workspaceId, request.currentUser.idUser, parsed.data.from, parsed.data.to),
    );
  }),
);
