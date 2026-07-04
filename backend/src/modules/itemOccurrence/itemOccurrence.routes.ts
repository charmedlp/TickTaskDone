import { Router } from 'express';
import { createItemOccurrenceInput, updateItemOccurrenceInput } from '@ticktaskdone/shared';
import { asyncHandler } from '../../middleware/errorHandler';
import { validateBody } from '../../middleware/validate';
import { notFound } from '../../http/errors';
import { parseId } from '../../http/params';
import * as itemOccurrenceService from './itemOccurrence.service';
import { toItemOccurrenceDto } from './itemOccurrence.mapper';

// Mounted under /workspaces/:workspaceId/items/:idItem/occurrences.
// `loadItem` has already validated the parent item and set request.loadedItem.
export const itemOccurrenceRouter = Router({ mergeParams: true });

// List
itemOccurrenceRouter.get(
  '/',
  asyncHandler(async (request, response) => {
    const rows = await itemOccurrenceService.listItemOccurrences(request.loadedItem.idItem);
    response.json(rows.map(toItemOccurrenceDto));
  }),
);

// Read
itemOccurrenceRouter.get(
  '/:idItemOccurrence',
  asyncHandler(async (request, response) => {
    const row = await itemOccurrenceService.readItemOccurrence(
      request.loadedItem.idItem,
      parseId(request.params.idItemOccurrence, 'occurrence id'),
    );
    if (!row) throw notFound('Item occurrence');
    response.json(toItemOccurrenceDto(row));
  }),
);

// Create
itemOccurrenceRouter.post(
  '/',
  validateBody(createItemOccurrenceInput),
  asyncHandler(async (request, response) => {
    const row = await itemOccurrenceService.createItemOccurrence(
      request.loadedItem.idItem,
      request.currentUser.idUser,
      request.body,
    );
    response.status(201).json(toItemOccurrenceDto(row));
  }),
);

// Update
itemOccurrenceRouter.patch(
  '/:idItemOccurrence',
  validateBody(updateItemOccurrenceInput),
  asyncHandler(async (request, response) => {
    const row = await itemOccurrenceService.updateItemOccurrence(
      request.loadedItem.idItem,
      request.currentUser.idUser,
      parseId(request.params.idItemOccurrence, 'occurrence id'),
      request.body,
    );
    if (!row) throw notFound('Item occurrence');
    response.json(toItemOccurrenceDto(row));
  }),
);

// Delete
itemOccurrenceRouter.delete(
  '/:idItemOccurrence',
  asyncHandler(async (request, response) => {
    const deleted = await itemOccurrenceService.deleteItemOccurrence(
      request.loadedItem.idItem,
      parseId(request.params.idItemOccurrence, 'occurrence id'),
    );
    if (!deleted) throw notFound('Item occurrence');
    response.status(204).send();
  }),
);
