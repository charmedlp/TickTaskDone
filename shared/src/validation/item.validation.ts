import { z } from 'zod';

export const itemTypes = ['task', 'event'] as const;
export type ItemType = (typeof itemTypes)[number];

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

// Shared field shape. Kept as a plain object (not refined) so `.partial()` stays
// available for the update schema. Workspace scope comes from the URL, not the body.
const itemFields = z.object({
  type: z.enum(itemTypes),
  projectId: z.number().int().positive().nullable(),
  title: z.string().min(1).max(255),
  description: z.string().nullable(),
  color: hexColor.nullable(),
  estimatedMinutes: z.number().int().positive().nullable(),
  rrule: z.string().max(1000).nullable(), // RFC 5545 pattern (without DTSTART)
  recurrenceStart: z.coerce.date().nullable(), // the DTSTART anchor
});

// Category assignments (the chosen leaves only — never their ancestors). Optional:
// omitted = leave unchanged (update) / none (create).
const categoryIds = z.array(z.number().int().positive());

// Recurrence pairing: rrule and recurrenceStart are both null or both set.
const bothNullOrBothSet = (rrule: string | null | undefined, recurrenceStart: Date | null | undefined): boolean =>
  (rrule === null || rrule === undefined) === (recurrenceStart === null || recurrenceStart === undefined);

export const createItemInput = itemFields.extend({ categoryIds: categoryIds.optional() }).refine(
  (value) => bothNullOrBothSet(value.rrule, value.recurrenceStart),
  { message: 'rrule and recurrenceStart must both be set or both be null.' },
);

export type CreateItemInput = z.infer<typeof createItemInput>;

// On update, the recurrence pairing is an invariant of the FINAL row (body merged
// with the existing values), which a schema over the partial body cannot see:
// sending only `rrule` to retune an already-recurrent item is legitimate. So the
// schema only fast-fails the unambiguous case — both keys present but mismatched.
// The authoritative check on the merged state lives in the item service (and the
// DB CHECK constraint is the final backstop).
export const updateItemInput = itemFields.extend({ categoryIds: categoryIds.optional() }).partial().refine(
  (value) =>
    !('rrule' in value && 'recurrenceStart' in value) || bothNullOrBothSet(value.rrule, value.recurrenceStart),
  { message: 'When both rrule and recurrenceStart are provided, they must be both set or both null.' },
);

export type UpdateItemInput = z.infer<typeof updateItemInput>;
