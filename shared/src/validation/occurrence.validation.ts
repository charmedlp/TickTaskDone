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

// Move a slot to a new time: materialize the occurrence (keeping its original
// occurrenceDate as the recurrence anchor) and place/replace its timeBlock.
export const moveOccurrenceInput = z
  .object({
    occurrenceDate: z.coerce.date().nullable(),
    timeStart: z.coerce.date(),
    timeEnd: z.coerce.date(),
    allDay: z.boolean().optional(),
    isBlocking: z.boolean().optional(),
  })
  .refine((value) => value.timeEnd > value.timeStart, {
    message: 'timeEnd must be after timeStart.',
  });

export type MoveOccurrenceInput = z.infer<typeof moveOccurrenceInput>;
