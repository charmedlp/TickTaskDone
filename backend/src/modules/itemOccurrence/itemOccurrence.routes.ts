import { Router } from 'express';
import {
  createItemOccurrenceInput,
  moveOccurrenceInput,
  setOccurrenceStatusInput,
  updateItemOccurrenceInput,
} from '@ticktaskdone/shared';
import { asyncHandler } from '../../middleware/errorHandler';
import { validateBody } from '../../middleware/validate';
import { notFound } from '../../http/errors';
import { parseId } from '../../http/params';
import * as occurrenceService from '../occurrence/occurrence.service';
import { toTimeBlockDto } from '../timeBlock/timeBlock.mapper';
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

// --- Phase 3 deviations: act on a slot (virtual or materialized), materializing
// lazily. The slot is addressed by occurrenceDate in the body (null = the single
// slot of a non-recurrent item). ---

// Set status (complete = done, start = doing, reopen = todo, skip = cancelled).
itemOccurrenceRouter.post(
  '/status',
  validateBody(setOccurrenceStatusInput),
  asyncHandler(async (request, response) => {
    const row = await occurrenceService.setOccurrenceStatus(
      request.loadedItem,
      request.currentUser.idUser,
      request.body.occurrenceDate,
      request.body.status,
    );
    response.json(toItemOccurrenceDto(row));
  }),
);

// Move: materialize and place/replace the current user's timeBlock at a new time.
itemOccurrenceRouter.post(
  '/move',
  validateBody(moveOccurrenceInput),
  asyncHandler(async (request, response) => {
    const moved = await occurrenceService.moveOccurrence(request.loadedItem, request.currentUser.idUser, request.body);
    response.json({
      occurrence: toItemOccurrenceDto(moved.occurrence),
      timeBlocks: moved.timeBlocks.map(toTimeBlockDto),
    });
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
