import { z } from 'zod';
import { createItemInput } from './item.validation';

// Composite create: an item, its first occurrence, and (optionally) one timeBlock,
// created atomically in a single backend transaction. Used by the calendar create
// gesture and by the ALT-copy "simple copy" cases (brief §2).
export const createScheduledItemInput = z.object({
  item: createItemInput,
  // Slot anchor of the created occurrence (null for a non-recurrent item; a
  // specific date when placing one instance of a recurrent item).
  occurrenceDate: z.coerce.date().nullable(),
  dueDate: z.coerce.date().nullable(),
  // null = leave the task unscheduled (backlog); otherwise place it on the grid.
  timeBlock: z
    .object({
      timeStart: z.coerce.date(),
      timeEnd: z.coerce.date(),
      allDay: z.boolean().optional(),
      isBlocking: z.boolean().optional(),
      timezone: z.string().max(64).nullable(),
    })
    .refine((value) => value.timeEnd > value.timeStart, { message: 'timeEnd must be after timeStart.' })
    .nullable(),
});

export type CreateScheduledItemInput = z.infer<typeof createScheduledItemInput>;
