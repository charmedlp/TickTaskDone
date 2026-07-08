import { describe, expect, it } from 'vitest';
import type { ItemOccurrence } from '../db/schema';
import { expandRecurrence, latestArrivedSlot, mergeSlots, type RecurrenceDefinition } from './recurrence';

// All dates are UTC so assertions are timezone-independent.
const utc = (year: number, month: number, day: number, hour = 0, minute = 0): Date =>
  new Date(Date.UTC(year, month - 1, day, hour, minute, 0));

const iso = (dates: Date[]): string[] => dates.map((date) => date.toISOString());

// Builds a full, valid ItemOccurrence row for merge tests.
const materialized = (overrides: Partial<ItemOccurrence>): ItemOccurrence => ({
  idItemOccurrence: 1,
  itemId: 10,
  occurrenceDate: null,
  status: 'todo',
  dueDate: null,
  createdAt: utc(2026, 1, 1),
  updatedAt: utc(2026, 1, 1),
  createdBy: 1,
  updatedBy: 1,
  ...overrides,
});

describe('expandRecurrence', () => {
  it('returns no slots for a non-recurrent definition', () => {
    const definition: RecurrenceDefinition = { rrule: null, recurrenceStart: null };
    expect(expandRecurrence(definition, utc(2026, 1, 1), utc(2026, 12, 31))).toEqual([]);
  });

  it('expands a weekly COUNT recurrence, keeping the anchor time of day', () => {
    const definition: RecurrenceDefinition = { rrule: 'FREQ=WEEKLY;COUNT=3', recurrenceStart: utc(2026, 1, 5, 9, 0) };
    expect(iso(expandRecurrence(definition, utc(2026, 1, 1), utc(2026, 2, 1)))).toEqual([
      '2026-01-05T09:00:00.000Z',
      '2026-01-12T09:00:00.000Z',
      '2026-01-19T09:00:00.000Z',
    ]);
  });

  it('honours INTERVAL and clips to the requested window', () => {
    const definition: RecurrenceDefinition = { rrule: 'FREQ=DAILY;INTERVAL=2', recurrenceStart: utc(2026, 1, 1, 8, 0) };
    // Window starts after the anchor: only slots inside [from, to] are returned.
    expect(iso(expandRecurrence(definition, utc(2026, 1, 4), utc(2026, 1, 8)))).toEqual([
      '2026-01-05T08:00:00.000Z',
      '2026-01-07T08:00:00.000Z',
    ]);
  });

  it('stops at an UNTIL bound (non-permanent recurrence)', () => {
    const definition: RecurrenceDefinition = {
      rrule: 'FREQ=WEEKLY;UNTIL=20260115T000000Z',
      recurrenceStart: utc(2026, 1, 1, 0, 0),
    };
    expect(iso(expandRecurrence(definition, utc(2026, 1, 1), utc(2026, 3, 1)))).toEqual([
      '2026-01-01T00:00:00.000Z',
      '2026-01-08T00:00:00.000Z',
      '2026-01-15T00:00:00.000Z',
    ]);
  });

  it('keeps the wall-clock across a DST change in the definition timezone', () => {
    // Daily 09:00 America/Montreal from Mar 6 2026 (EST, -5). Spring-forward is
    // Mar 8, so from Mar 8 the same 09:00 wall-clock is EDT (-4) — the instant
    // shifts from 14:00Z to 13:00Z but the local time stays 09:00.
    const definition: RecurrenceDefinition = {
      rrule: 'FREQ=DAILY;COUNT=4',
      recurrenceStart: new Date('2026-03-06T14:00:00.000Z'), // 09:00 Montreal (EST)
      timezone: 'America/Montreal',
    };
    expect(iso(expandRecurrence(definition, utc(2026, 3, 1), utc(2026, 3, 15)))).toEqual([
      '2026-03-06T14:00:00.000Z',
      '2026-03-07T14:00:00.000Z',
      '2026-03-08T13:00:00.000Z',
      '2026-03-09T13:00:00.000Z',
    ]);
  });
});

describe('mergeSlots', () => {
  const slots = [utc(2026, 1, 5, 9, 0), utc(2026, 1, 12, 9, 0), utc(2026, 1, 19, 9, 0)];

  it('marks every slot virtual when nothing is materialized', () => {
    const merged = mergeSlots(slots, []);
    expect(merged.map((entry) => entry.materialized)).toEqual([null, null, null]);
    expect(iso(merged.map((entry) => entry.occurrenceDate))).toEqual(iso(slots));
  });

  it('lets a materialized row win on its matching slot only', () => {
    const done = materialized({ idItemOccurrence: 99, occurrenceDate: utc(2026, 1, 12, 9, 0), status: 'done' });
    const merged = mergeSlots(slots, [done]);
    expect(merged[0].materialized).toBeNull();
    expect(merged[1].materialized).toBe(done);
    expect(merged[2].materialized).toBeNull();
  });

  it('surfaces a skipped (cancelled) deviation on its slot', () => {
    const skipped = materialized({ idItemOccurrence: 42, occurrenceDate: utc(2026, 1, 5, 9, 0), status: 'cancelled' });
    expect(mergeSlots(slots, [skipped])[0].materialized?.status).toBe('cancelled');
  });

  it('ignores materialized rows whose slot is outside the expanded window', () => {
    const stray = materialized({ occurrenceDate: utc(2026, 2, 2, 9, 0) });
    expect(mergeSlots(slots, [stray]).every((entry) => entry.materialized === null)).toBe(true);
  });
});

describe('latestArrivedSlot', () => {
  const definition: RecurrenceDefinition = { rrule: 'FREQ=WEEKLY', recurrenceStart: utc(2026, 1, 5, 9, 0) };

  it('returns null before the first slot has started', () => {
    expect(latestArrivedSlot(definition, utc(2026, 1, 1))).toBeNull();
  });

  it('returns the most recent slot that has already started', () => {
    expect(latestArrivedSlot(definition, utc(2026, 1, 20))?.toISOString()).toBe('2026-01-19T09:00:00.000Z');
  });

  it('returns null for a non-recurrent definition', () => {
    expect(latestArrivedSlot({ rrule: null, recurrenceStart: null }, utc(2026, 1, 20))).toBeNull();
  });
});
