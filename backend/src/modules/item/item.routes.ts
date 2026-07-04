import { Router } from 'express';
import type { RequestHandler } from 'express';
import { createItemInput, updateItemInput } from '@ticktaskdone/shared';
import { asyncHandler } from '../../middleware/errorHandler';
import { validateBody } from '../../middleware/validate';
import { notFound } from '../../http/errors';
import { parseId } from '../../http/params';
import { itemOccurrenceRouter } from '../itemOccurrence/itemOccurrence.routes';
import * as itemService from './item.service';
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

// Occurrences live under their parent item: /items/:idItem/occurrences
itemRouter.use('/:idItem/occurrences', loadItem, itemOccurrenceRouter);
