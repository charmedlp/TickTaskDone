import { z } from 'zod';

// A timeBlock is a planned placement of an occurrence on the schedule. It belongs
// to the current user (set server-side); the parent occurrence is referenced by
// id. Multiple blocks per occurrence (task splitting) is Phase 5 — the schema
// already allows it. timeEnd must be after timeStart (final-state check also
// enforced in the service).
export const createTimeBlockInput = z
  .object({
    itemOccurrenceId: z.number().int().positive(),
    timeStart: z.coerce.date(),
    timeEnd: z.coerce.date(),
    allDay: z.boolean().optional(),
    isBlocking: z.boolean().optional(),
  })
  .refine((value) => value.timeEnd > value.timeStart, {
    message: 'timeEnd must be after timeStart.',
  });

export type CreateTimeBlockInput = z.infer<typeof createTimeBlockInput>;

// Partial update. The itemOccurrenceId is immutable (a block cannot hop to another
// occurrence), so it is omitted. When both bounds are provided they are ordered;
// the service re-checks the merged bounds against the stored values.
export const updateTimeBlockInput = z
  .object({
    timeStart: z.coerce.date(),
    timeEnd: z.coerce.date(),
    allDay: z.boolean(),
    isBlocking: z.boolean(),
  })
  .partial()
  .refine((value) => value.timeStart === undefined || value.timeEnd === undefined || value.timeEnd > value.timeStart, {
    message: 'When both bounds are provided, timeEnd must be after timeStart.',
  });

export type UpdateTimeBlockInput = z.infer<typeof updateTimeBlockInput>;
