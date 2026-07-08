import { Router } from 'express';
import { createTimeLogInput, updateTimeLogInput } from '@ticktaskdone/shared';
import { asyncHandler } from '../../middleware/errorHandler';
import { validateBody } from '../../middleware/validate';
import { notFound } from '../../http/errors';
import { parseId } from '../../http/params';
import * as timeLogService from './timeLog.service';
import { toTimeLogDto } from './timeLog.mapper';

// Mounted under /workspaces/:workspaceId/timelogs. Logs are personal, so the current
// user is always part of the scope alongside the workspace.
export const timeLogRouter = Router({ mergeParams: true });

// List
timeLogRouter.get(
  '/',
  asyncHandler(async (request, response) => {
    const rows = await timeLogService.listTimeLogs(request.workspaceId, request.currentUser.idUser);
    response.json(rows.map(toTimeLogDto));
  }),
);

// Read
timeLogRouter.get(
  '/:idTimeLog',
  asyncHandler(async (request, response) => {
    const row = await timeLogService.readTimeLog(
      request.workspaceId,
      request.currentUser.idUser,
      parseId(request.params.idTimeLog, 'timeLog id'),
    );
    if (!row) throw notFound('TimeLog');
    response.json(toTimeLogDto(row));
  }),
);

// Create
timeLogRouter.post(
  '/',
  validateBody(createTimeLogInput),
  asyncHandler(async (request, response) => {
    const row = await timeLogService.createTimeLog(request.workspaceId, request.currentUser.idUser, request.body);
    response.status(201).json(toTimeLogDto(row));
  }),
);

// Update
timeLogRouter.patch(
  '/:idTimeLog',
  validateBody(updateTimeLogInput),
  asyncHandler(async (request, response) => {
    const row = await timeLogService.updateTimeLog(
      request.workspaceId,
      request.currentUser.idUser,
      parseId(request.params.idTimeLog, 'timeLog id'),
      request.body,
    );
    if (!row) throw notFound('TimeLog');
    response.json(toTimeLogDto(row));
  }),
);

// Delete
timeLogRouter.delete(
  '/:idTimeLog',
  asyncHandler(async (request, response) => {
    const deleted = await timeLogService.deleteTimeLog(
      request.workspaceId,
      request.currentUser.idUser,
      parseId(request.params.idTimeLog, 'timeLog id'),
    );
    if (!deleted) throw notFound('TimeLog');
    response.status(204).send();
  }),
);
