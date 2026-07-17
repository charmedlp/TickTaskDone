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

const parseRruleParams = (rrule: string): Map<string, string> => {
  const params = new Map<string, string>();
  for (const part of rrule.split(';')) {
    const equals = part.indexOf('=');
    if (equals > 0) {
      params.set(part.slice(0, equals).trim().toUpperCase(), part.slice(equals + 1).trim());
    }
  }
  return params;
};

// Days in a 1-based month (day 0 of the next month = the last day of this one).
const daysInMonth = (year: number, month: number): number => new Date(Date.UTC(year, month, 0)).getUTCDate();

// RFC 5545 UNTIL ("YYYYMMDD" or "YYYYMMDDTHHMMSS[Z]") -> a floating Date (wall-clock in
// its UTC fields), to compare against floating slots. Returns null if unparseable.
const parseUntilFloating = (raw: string): Date | null => {
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z?)?$/.exec(raw.trim());
  if (!match) {
    return null;
  }
  const [, year, month, day, hour = '00', minute = '00', second = '00'] = match;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)));
};

const isSimpleMonthly = (params: Map<string, string>): boolean =>
  params.get('FREQ') === 'MONTHLY' && ![...params.keys()].some((key) => key.startsWith('BY'));

// Core generator for the "same day-of-month as the anchor" monthly shape — the only
// monthly form this app emits. RFC/rrule SKIPS months without that day (no Feb 31), but
// users expect the occurrence to CLAMP to the month's last day instead (Jan 31 -> Feb
// 28/29 -> Apr 30 -> May 31 …; a 29th/30th anchor -> Feb 28/29). Invokes `visit(slot)`
// for each floating slot in ascending order until it returns false. INTERVAL/COUNT/
// UNTIL are honoured. NOTE: unbounded rules (no COUNT/UNTIL) run until `visit` stops.
const forEachMonthlyClamped = (anchor: WallClock, params: Map<string, string>, visit: (slot: Date) => boolean): void => {
  const interval = Math.max(1, Number(params.get('INTERVAL') ?? '1') || 1);
  const rawCount = Number(params.get('COUNT'));
  const count = Number.isFinite(rawCount) && rawCount > 0 ? rawCount : null;
  const rawUntil = params.get('UNTIL');
  const until = rawUntil ? parseUntilFloating(rawUntil) : null;
  for (let step = 0; count === null || step < count; step += 1) {
    const monthsFromAnchor = anchor.month - 1 + step * interval;
    const year = anchor.year + Math.floor(monthsFromAnchor / 12);
    const month = (monthsFromAnchor % 12) + 1; // 1-12
    const day = Math.min(anchor.day, daysInMonth(year, month));
    const slot = toFloating({ year, month, day, hour: anchor.hour, minute: anchor.minute, second: anchor.second });
    if (until !== null && slot.getTime() > until.getTime()) {
      return;
    }
    if (!visit(slot)) {
      return;
    }
  }
};

// Clamped monthly slots within [floatingFrom, floatingTo] (inclusive).
const monthlyClampedWindow = (anchor: WallClock, params: Map<string, string>, floatingFrom: Date, floatingTo: Date): Date[] => {
  const fromMs = floatingFrom.getTime();
  const toMs = floatingTo.getTime();
  const slots: Date[] = [];
  forEachMonthlyClamped(anchor, params, (slot) => {
    const ms = slot.getTime();
    if (ms > toMs) {
      return false; // months only move forward
    }
    if (ms >= fromMs) {
      slots.push(slot);
    }
    return true;
  });
  return slots;
};

// Up to `limit` clamped monthly slots on/after `floatingFrom` (or strictly after, when
// `inclusive` is false), ascending.
const monthlyClampedForward = (
  anchor: WallClock,
  params: Map<string, string>,
  floatingFrom: Date,
  limit: number,
  inclusive: boolean,
): Date[] => {
  const fromMs = floatingFrom.getTime();
  const slots: Date[] = [];
  forEachMonthlyClamped(anchor, params, (slot) => {
    const ms = slot.getTime();
    if (inclusive ? ms >= fromMs : ms > fromMs) {
      slots.push(slot);
    }
    return slots.length < limit;
  });
  return slots;
};

// Up to `limit` clamped monthly slots strictly before `floatingBefore`, ascending (the
// latest ones).
const monthlyClampedBefore = (anchor: WallClock, params: Map<string, string>, floatingBefore: Date, limit: number): Date[] => {
  const beforeMs = floatingBefore.getTime();
  const buffer: Date[] = [];
  forEachMonthlyClamped(anchor, params, (slot) => {
    if (slot.getTime() >= beforeMs) {
      return false;
    }
    buffer.push(slot);
    return true;
  });
  return buffer.slice(-limit);
};

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
  const anchor = instantToWallClock(definition.recurrenceStart, timeZone);
  const dtstart = toFloating(anchor);
  const floatingFrom = toFloating(instantToWallClock(from, timeZone));
  const floatingTo = toFloating(instantToWallClock(to, timeZone));

  // Simple monthly-by-anchor-day (no BY* parts): clamp short months instead of skipping.
  const params = parseRruleParams(definition.rrule);
  if (isSimpleMonthly(params)) {
    return monthlyClampedWindow(anchor, params, floatingFrom, floatingTo).map((slot) =>
      wallClockToInstant(fromFloating(slot), timeZone),
    );
  }

  return rrulestr(definition.rrule, { dtstart })
    .between(floatingFrom, floatingTo, true)
    .map((slot) => wallClockToInstant(fromFloating(slot), timeZone));
};

// Forward pagination primitive: up to `limit` slot instants from `from` (inclusive by
// default; pass `inclusive=false` to page strictly after a cursor), ascending. For an
// unbounded rule this is finite (capped at `limit`). Note `from` is compared at
// second precision (wall-clock), so use `inclusive` rather than a ±1ms nudge.
export const slotsFrom = (definition: RecurrenceDefinition, from: Date, limit: number, inclusive = true): Date[] => {
  if (definition.rrule === null || definition.recurrenceStart === null || limit <= 0) {
    return [];
  }
  const timeZone = definition.timezone ?? 'UTC';
  const anchor = instantToWallClock(definition.recurrenceStart, timeZone);
  const dtstart = toFloating(anchor);
  const floatingFrom = toFloating(instantToWallClock(from, timeZone));
  const toInstant = (slot: Date): Date => wallClockToInstant(fromFloating(slot), timeZone);

  const params = parseRruleParams(definition.rrule);
  if (isSimpleMonthly(params)) {
    return monthlyClampedForward(anchor, params, floatingFrom, limit, inclusive).map(toInstant);
  }
  const rule = rrulestr(definition.rrule, { dtstart });
  const slots: Date[] = [];
  let next = rule.after(floatingFrom, inclusive);
  while (next !== null && slots.length < limit) {
    slots.push(toInstant(next));
    next = rule.after(next, false);
  }
  return slots;
};

// Backward pagination primitive: up to `limit` slot instants strictly before `before`,
// ascending (the latest ones). Naturally bounded below by the series' first slot.
export const slotsBefore = (definition: RecurrenceDefinition, before: Date, limit: number): Date[] => {
  if (definition.rrule === null || definition.recurrenceStart === null || limit <= 0) {
    return [];
  }
  const timeZone = definition.timezone ?? 'UTC';
  const anchor = instantToWallClock(definition.recurrenceStart, timeZone);
  const dtstart = toFloating(anchor);
  const floatingBefore = toFloating(instantToWallClock(before, timeZone));
  const toInstant = (slot: Date): Date => wallClockToInstant(fromFloating(slot), timeZone);

  const params = parseRruleParams(definition.rrule);
  if (isSimpleMonthly(params)) {
    return monthlyClampedBefore(anchor, params, floatingBefore, limit).map(toInstant);
  }
  const rule = rrulestr(definition.rrule, { dtstart });
  const reversed: Date[] = [];
  let prev = rule.before(floatingBefore, false); // exclusive of `before`
  while (prev !== null && reversed.length < limit) {
    reversed.push(toInstant(prev));
    prev = rule.before(prev, false);
  }
  return reversed.reverse(); // ascending
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
