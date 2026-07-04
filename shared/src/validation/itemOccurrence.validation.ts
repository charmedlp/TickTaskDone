import { z } from 'zod';

export const occurrenceStatuses = ['todo', 'doing', 'done', 'cancelled'] as const;
export type OccurrenceStatus = (typeof occurrenceStatuses)[number];

// occurrenceDate is the recurrence slot anchor (null for a non-recurrent item);
// dueDate is null for events. Both are explicit so the caller states intent.
// The parent item comes from the URL, not the body.
export const createItemOccurrenceInput = z.object({
  occurrenceDate: z.coerce.date().nullable(),
  status: z.enum(occurrenceStatuses).optional(),
  dueDate: z.coerce.date().nullable(),
});

export type CreateItemOccurrenceInput = z.infer<typeof createItemOccurrenceInput>;

export const updateItemOccurrenceInput = createItemOccurrenceInput.partial();

export type UpdateItemOccurrenceInput = z.infer<typeof updateItemOccurrenceInput>;
