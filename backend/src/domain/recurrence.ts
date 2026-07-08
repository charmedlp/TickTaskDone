import { rrulestr } from 'rrule';
import type { ItemOccurrence } from '../db/schema';
import { instantToWallClock, wallClockToInstant, type WallClock } from './timezone';

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
// timezone is the IANA id the recurrence lives in (DST-correct); omitted/null = UTC.
export interface RecurrenceDefinition {
  rrule: string | null;
  recurrenceStart: Date | null;
  timezone?: string | null;
}

// A slot paired with its materialized row, if any.
export interface MergedOccurrence {
  occurrenceDate: Date;
  materialized: ItemOccurrence | null; // null => virtual (implicitly `todo`)
}

// A "floating" Date carries a wall-clock in its UTC fields (no timezone).
const toFloating = (wall: WallClock): Date =>
  new Date(Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second));
const fromFloating = (floating: Date): WallClock => ({
  year: floating.getUTCFullYear(),
  month: floating.getUTCMonth() + 1,
  day: floating.getUTCDate(),
  hour: floating.getUTCHours(),
  minute: floating.getUTCMinutes(),
  second: floating.getUTCSeconds(),
});

// Expand a recurrent definition into the slot instants within [from, to]
// (inclusive). Expansion runs on the wall-clock in the definition's timezone (so
// "every day at 09:00" keeps its wall-clock across a DST change), then each slot's
// wall-clock is converted back to an absolute instant. A non-recurrent definition
// (both fields null) yields no slots. With no timezone this is plain UTC.
export const expandRecurrence = (definition: RecurrenceDefinition, from: Date, to: Date): Date[] => {
  if (definition.rrule === null || definition.recurrenceStart === null) {
    return [];
  }
  const timeZone = definition.timezone ?? 'UTC';
  const dtstart = toFloating(instantToWallClock(definition.recurrenceStart, timeZone));
  const floatingFrom = toFloating(instantToWallClock(from, timeZone));
  const floatingTo = toFloating(instantToWallClock(to, timeZone));
  return rrulestr(definition.rrule, { dtstart })
    .between(floatingFrom, floatingTo, true)
    .map((slot) => wallClockToInstant(fromFloating(slot), timeZone));
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
