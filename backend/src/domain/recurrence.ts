import { rrulestr } from 'rrule';
import type { ItemOccurrence } from '../db/schema';

// =============================================================================
//  Pure recurrence logic (no database access) — the testable heart of Phase 3.
//
//  All recurrence math is done in UTC: `recurrenceStart` is the DTSTART anchor
//  and `rrule` is the RFC 5545 pattern (FREQ/INTERVAL/COUNT/UNTIL), stored
//  separately per the schema. When an occurrence is materialized the caller must
//  persist the exact slot Date produced here, so the value round-trips and the
//  merge below matches by timestamp.
// =============================================================================

// The minimal shape needed to expand a recurrence — decoupled from the full row.
export interface RecurrenceDefinition {
  rrule: string | null;
  recurrenceStart: Date | null;
}

// A slot paired with its materialized row, if any.
export interface MergedOccurrence {
  occurrenceDate: Date;
  materialized: ItemOccurrence | null; // null => virtual (implicitly `todo`)
}

// Expand a recurrent definition into the slot datetimes within [from, to]
// (inclusive). A non-recurrent definition (both fields null) yields no slots —
// its single occurrence has occurrenceDate = null and is handled by the caller.
export const expandRecurrence = (definition: RecurrenceDefinition, from: Date, to: Date): Date[] => {
  if (definition.rrule === null || definition.recurrenceStart === null) {
    return [];
  }
  return rrulestr(definition.rrule, { dtstart: definition.recurrenceStart }).between(from, to, true);
};

// Overlay materialized occurrences onto the virtual slots: for each slot, a
// materialized row on the same (itemId, occurrenceDate) wins; otherwise the slot
// stays virtual. Materialized rows also encode deviations — a skipped slot is a
// `cancelled` row, a moved slot keeps its original occurrenceDate — so they land
// on the right slot here.
export const mergeSlots = (slots: Date[], materialized: ItemOccurrence[]): MergedOccurrence[] => {
  const byTimestamp = new Map<number, ItemOccurrence>();
  for (const occurrence of materialized) {
    if (occurrence.occurrenceDate !== null) {
      byTimestamp.set(occurrence.occurrenceDate.getTime(), occurrence);
    }
  }
  return slots.map((slot) => ({ occurrenceDate: slot, materialized: byTimestamp.get(slot.getTime()) ?? null }));
};

// The most recent slot that has already started (<= now), or null if none has.
// Used by the reminder engine: any earlier slot of the same series that is still
// `todo` is superseded once this one has arrived.
export const latestArrivedSlot = (definition: RecurrenceDefinition, now: Date): Date | null => {
  if (definition.recurrenceStart === null) {
    return null;
  }
  const slots = expandRecurrence(definition, definition.recurrenceStart, now);
  return slots.length > 0 ? slots[slots.length - 1] : null;
};
