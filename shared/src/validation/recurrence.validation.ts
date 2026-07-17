import { z } from 'zod';

// Turn a non-recurring task into a recurring one (brief §3.2 A/B). The client sends
// the RFC 5545 pattern and, optionally, an explicit anchor ("À partir de …"): the
// DTSTART instant + its timezone that define when each occurrence falls. When omitted,
// the anchor and timezone are derived server-side from the task's earliest block.
// Removing recurrence (§3.2 C) needs no body.
export const enableRecurrenceInput = z.object({
  rrule: z.string().min(1).max(1000),
  recurrenceStart: z.coerce.date().optional(),
  timezone: z.string().max(64).optional(),
});

export type EnableRecurrenceInput = z.infer<typeof enableRecurrenceInput>;
