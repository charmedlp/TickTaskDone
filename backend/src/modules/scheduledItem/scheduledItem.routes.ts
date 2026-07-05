import { Router } from 'express';
import { createScheduledItemInput } from '@ticktaskdone/shared';
import { asyncHandler } from '../../middleware/errorHandler';
import { validateBody } from '../../middleware/validate';
import { toOccurrenceViewDto } from '../occurrence/occurrence.mapper';
import { createScheduledItem } from './scheduledItem.service';

// Mounted under /workspaces/:workspaceId/scheduled-items.
export const scheduledItemRouter = Router({ mergeParams: true });

// Create an item + occurrence + optional timeBlock in one transaction.
scheduledItemRouter.post(
  '/',
  validateBody(createScheduledItemInput),
  asyncHandler(async (request, response) => {
    const view = await createScheduledItem(request.workspaceId, request.currentUser.idUser, request.body);
    response.status(201).json(toOccurrenceViewDto(view));
  }),
);
