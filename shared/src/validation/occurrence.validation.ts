import { z } from 'zod';
import { occurrenceStatuses } from './itemOccurrence.validation';

// Date window for the calendar feed (query string). `to` must not precede `from`.
export const occurrenceWindowQuery = z
  .object({
    from: z.coerce.date(),
    to: z.coerce.date(),
  })
  .refine((value) => value.to >= value.from, {
    message: 'to must be the same as or after from.',
  });

export type OccurrenceWindowQuery = z.infer<typeof occurrenceWindowQuery>;

// A deviation/action targets one slot of an item, addressed by its occurrenceDate
// (null for a non-recurrent item's single slot). The occurrence is materialized
// lazily by the action if it is still virtual.

// Set status = complete (`done`), start (`doing`), reopen (`todo`) or skip
// (`cancelled`). Skip is simply a status action with `cancelled`.
export const setOccurrenceStatusInput = z.object({
  occurrenceDate: z.coerce.date().nullable(),
  status: z.enum(occurrenceStatuses),
});

export type SetOccurrenceStatusInput = z.infer<typeof setOccurrenceStatusInput>;

// Materialize a slot (find-or-create) without any other change, returning the
// occurrence row. Used by the timer, which must attach real time logs to a concrete
// occurrence even when the task is still a virtual recurring slot.
export const materializeOccurrenceInput = z.object({
  occurrenceDate: z.coerce.date().nullable(),
});

export type MaterializeOccurrenceInput = z.infer<typeof materializeOccurrenceInput>;

// Move a slot to a new time: materialize the occurrence (keeping its original
// occurrenceDate as the recurrence anchor) and place/replace its timeBlock.
export const moveOccurrenceInput = z
  .object({
    occurrenceDate: z.coerce.date().nullable(),
    timeStart: z.coerce.date(),
    timeEnd: z.coerce.date(),
    allDay: z.boolean().optional(),
    isBlocking: z.boolean().optional(),
    timezone: z.string().max(64).nullable(),
  })
  .refine((value) => value.timeEnd > value.timeStart, {
    message: 'timeEnd must be after timeStart.',
  });

export type MoveOccurrenceInput = z.infer<typeof moveOccurrenceInput>;

// Schedule an existing item onto the calendar: materialize the occurrence and ADD
// a timeBlock (never replace). A recurrent item -> a new custom off-rule occurrence
// (occurrenceDate = the drop); a non-recurrent item -> another block on its single
// occurrence (occurrenceDate = null) = a split. This is the shared primitive behind
// the ALT-copy "customOccurrence"/"split" cases and scheduling from the item picker.
export const scheduleOccurrenceInput = z
  .object({
    occurrenceDate: z.coerce.date().nullable(),
    timeStart: z.coerce.date(),
    timeEnd: z.coerce.date(),
    allDay: z.boolean().optional(),
    isBlocking: z.boolean().optional(),
    dueDate: z.coerce.date().nullable(),
    timezone: z.string().max(64).nullable(),
  })
  .refine((value) => value.timeEnd > value.timeStart, { message: 'timeEnd must be after timeStart.' });

export type ScheduleOccurrenceInput = z.infer<typeof scheduleOccurrenceInput>;
