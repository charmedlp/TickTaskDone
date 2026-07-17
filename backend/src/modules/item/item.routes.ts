import { Router } from 'express';
import type { RequestHandler } from 'express';
import { createItemInput, enableRecurrenceInput, updateItemInput } from '@ticktaskdone/shared';
import { asyncHandler } from '../../middleware/errorHandler';
import { validateBody } from '../../middleware/validate';
import { notFound } from '../../http/errors';
import { parseId } from '../../http/params';
import { itemOccurrenceRouter } from '../itemOccurrence/itemOccurrence.routes';
import * as itemService from './item.service';
import * as recurrenceService from './recurrence.service';
import { listTaskSummaries } from './taskSummary.service';
import { toItemDto } from './item.mapper';

// Mounted under /workspaces/:workspaceId/items — request.workspaceId is set.
export const itemRouter = Router({ mergeParams: true });

// Loads the parent item for nested occurrence routes, enforcing workspace scope
// once so the occurrence module can trust request.loadedItem.
export const loadItem: RequestHandler = (request, _response, next) => {
  itemService
    .readItem(request.workspaceId, parseId(request.params.idItem, 'item id'))
    .then((row) => {
      if (!row) throw notFound('Item');
      request.loadedItem = row.item;
      next();
    })
    .catch(next);
};

// List
itemRouter.get(
  '/',
  asyncHandler(async (request, response) => {
    const rows = await itemService.listItems(request.workspaceId);
    response.json(rows.map(toItemDto));
  }),
);

// Per-task rollups for the Projects view (§2/§4). Before '/:idItem' so "summaries"
// is not read as an id.
itemRouter.get(
  '/summaries',
  asyncHandler(async (request, response) => {
    const summaries = await listTaskSummaries(request.workspaceId, request.currentUser.idUser);
    response.json(summaries);
  }),
);

// Read
itemRouter.get(
  '/:idItem',
  asyncHandler(async (request, response) => {
    const row = await itemService.readItem(request.workspaceId, parseId(request.params.idItem, 'item id'));
    if (!row) throw notFound('Item');
    response.json(toItemDto(row));
  }),
);

// Create
itemRouter.post(
  '/',
  validateBody(createItemInput),
  asyncHandler(async (request, response) => {
    const row = await itemService.createItem(request.workspaceId, request.currentUser.idUser, request.body);
    response.status(201).json(toItemDto(row));
  }),
);

// Update
itemRouter.patch(
  '/:idItem',
  validateBody(updateItemInput),
  asyncHandler(async (request, response) => {
    const row = await itemService.updateItem(
      request.workspaceId,
      request.currentUser.idUser,
      parseId(request.params.idItem, 'item id'),
      request.body,
    );
    if (!row) throw notFound('Item');
    response.json(toItemDto(row));
  }),
);

// Delete
itemRouter.delete(
  '/:idItem',
  asyncHandler(async (request, response) => {
    const deleted = await itemService.deleteItem(request.workspaceId, parseId(request.params.idItem, 'item id'));
    if (!deleted) throw notFound('Item');
    response.status(204).send();
  }),
);

// Enable recurrence on a task (§3.2 A/B): blocks become the recurring occurrences.
itemRouter.post(
  '/:idItem/recurrence',
  validateBody(enableRecurrenceInput),
  asyncHandler(async (request, response) => {
    await recurrenceService.enableRecurrence(
      request.workspaceId,
      request.currentUser.idUser,
      parseId(request.params.idItem, 'item id'),
      request.body,
    );
    response.status(204).send();
  }),
);

// Remove recurrence (§3.2 C): each materialized occurrence becomes a separate task.
// Returns the number of tasks it split into.
itemRouter.delete(
  '/:idItem/recurrence',
  asyncHandler(async (request, response) => {
    const created = await recurrenceService.removeRecurrence(
      request.workspaceId,
      request.currentUser.idUser,
      parseId(request.params.idItem, 'item id'),
    );
    response.json({ tasks: created });
  }),
);

// Occurrences live under their parent item: /items/:idItem/occurrences
itemRouter.use('/:idItem/occurrences', loadItem, itemOccurrenceRouter);
