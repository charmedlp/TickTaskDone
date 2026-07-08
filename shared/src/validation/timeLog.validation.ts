import { z } from 'zod';

// A timeLog is REAL time spent on an occurrence (one per timer segment, or a manual
// entry). It belongs to the current user (set server-side); the parent occurrence is
// referenced by id. `endedAt` is null while a timer segment is still running (closed
// later by an update). `source` distinguishes timer-captured from manual entries.
export const timeLogSources = ['timer', 'manual'] as const;
export type TimeLogSource = (typeof timeLogSources)[number];

export const createTimeLogInput = z
  .object({
    itemOccurrenceId: z.number().int().positive(),
    startedAt: z.coerce.date(),
    endedAt: z.coerce.date().nullable(),
    source: z.enum(timeLogSources).optional(),
    timezone: z.string().max(64).nullable(), // IANA id of the capture timezone
  })
  .refine((value) => value.endedAt === null || value.endedAt > value.startedAt, {
    message: 'endedAt must be after startedAt.',
  });

export type CreateTimeLogInput = z.infer<typeof createTimeLogInput>;

// Partial update. The itemOccurrenceId is immutable (a log cannot hop occurrences).
// Closing a running segment sets `endedAt`; ordering is re-checked against the
// stored bounds in the service.
export const updateTimeLogInput = z
  .object({
    startedAt: z.coerce.date(),
    endedAt: z.coerce.date().nullable(),
    source: z.enum(timeLogSources),
    timezone: z.string().max(64).nullable(),
  })
  .partial()
  .refine(
    (value) => value.startedAt === undefined || value.endedAt === undefined || value.endedAt === null || value.endedAt > value.startedAt,
    { message: 'When both bounds are provided, endedAt must be after startedAt.' },
  );

export type UpdateTimeLogInput = z.infer<typeof updateTimeLogInput>;
