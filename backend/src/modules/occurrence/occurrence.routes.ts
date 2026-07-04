import { Router } from 'express';
import { occurrenceWindowQuery } from '@ticktaskdone/shared';
import { asyncHandler } from '../../middleware/errorHandler';
import { AppError } from '../../http/errors';
import * as occurrenceService from './occurrence.service';
import { toOccurrenceViewDto, toReminderDto } from './occurrence.mapper';

// Calendar window feed — mounted under /workspaces/:workspaceId/occurrences.
export const occurrenceRouter = Router({ mergeParams: true });

// GET /occurrences?from=&to= : virtual + materialized occurrences for the window.
occurrenceRouter.get(
  '/',
  asyncHandler(async (request, response) => {
    const parsed = occurrenceWindowQuery.safeParse(request.query);
    if (!parsed.success) {
      throw new AppError(400, parsed.error.issues[0]?.message ?? 'Invalid date window.');
    }
    const views = await occurrenceService.getWindowOccurrences(
      request.workspaceId,
      request.currentUser.idUser,
      parsed.data.from,
      parsed.data.to,
    );
    response.json(views.map(toOccurrenceViewDto));
  }),
);

// Overdue reminders — mounted under /workspaces/:workspaceId/reminders.
export const reminderRouter = Router({ mergeParams: true });

reminderRouter.get(
  '/',
  asyncHandler(async (request, response) => {
    const rows = await occurrenceService.listReminders(request.workspaceId, request.currentUser.idUser, new Date());
    response.json(rows.map(toReminderDto));
  }),
);
