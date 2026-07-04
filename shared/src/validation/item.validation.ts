import { z } from 'zod';

export const createItemInput = z
  .object({
    type: z.enum(['task', 'event']),
    projectId: z.number().int().positive().nullable(),
    title: z.string().min(1).max(255),
    description: z.string().nullable(),
    color: z.string().max(30).nullable(),
    estimatedMinutes: z.number().int().positive().nullable(),
    rrule: z.string().max(1000).nullable(),
    recurrenceStart: z.coerce.date().nullable(),
  })
  .refine((value) => (value.rrule === null) === (value.recurrenceStart === null), {
    message: 'rrule and recurrenceStart must both be set or both be null.',
  });

export type CreateItemInput = z.infer<typeof createItemInput>;