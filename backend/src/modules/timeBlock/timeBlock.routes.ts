import { Router } from 'express';
import { createTimeBlockInput, updateTimeBlockInput } from '@ticktaskdone/shared';
import { asyncHandler } from '../../middleware/errorHandler';
import { validateBody } from '../../middleware/validate';
import { notFound } from '../../http/errors';
import { parseId } from '../../http/params';
import * as timeBlockService from './timeBlock.service';
import { toTimeBlockDto } from './timeBlock.mapper';

// Mounted under /workspaces/:workspaceId/timeblocks. Blocks are personal, so the
// current user is always part of the scope alongside the workspace.
export const timeBlockRouter = Router({ mergeParams: true });

// List
timeBlockRouter.get(
  '/',
  asyncHandler(async (request, response) => {
    const rows = await timeBlockService.listTimeBlocks(request.workspaceId, request.currentUser.idUser);
    response.json(rows.map(toTimeBlockDto));
  }),
);

// Read
timeBlockRouter.get(
  '/:idTimeBlock',
  asyncHandler(async (request, response) => {
    const row = await timeBlockService.readTimeBlock(
      request.workspaceId,
      request.currentUser.idUser,
      parseId(request.params.idTimeBlock, 'timeBlock id'),
    );
    if (!row) throw notFound('TimeBlock');
    response.json(toTimeBlockDto(row));
  }),
);

// Create
timeBlockRouter.post(
  '/',
  validateBody(createTimeBlockInput),
  asyncHandler(async (request, response) => {
    const row = await timeBlockService.createTimeBlock(request.workspaceId, request.currentUser.idUser, request.body);
    response.status(201).json(toTimeBlockDto(row));
  }),
);

// Update
timeBlockRouter.patch(
  '/:idTimeBlock',
  validateBody(updateTimeBlockInput),
  asyncHandler(async (request, response) => {
    const row = await timeBlockService.updateTimeBlock(
      request.workspaceId,
      request.currentUser.idUser,
      parseId(request.params.idTimeBlock, 'timeBlock id'),
      request.body,
    );
    if (!row) throw notFound('TimeBlock');
    response.json(toTimeBlockDto(row));
  }),
);

// Delete
timeBlockRouter.delete(
  '/:idTimeBlock',
  asyncHandler(async (request, response) => {
    const deleted = await timeBlockService.deleteTimeBlock(
      request.workspaceId,
      request.currentUser.idUser,
      parseId(request.params.idTimeBlock, 'timeBlock id'),
    );
    if (!deleted) throw notFound('TimeBlock');
    response.status(204).send();
  }),
);
