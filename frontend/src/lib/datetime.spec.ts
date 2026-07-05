import { describe, expect, it } from 'vitest';
import { daysInWindow, startOfWeek, stepAnchor, windowForView } from './datetime';

const utc = (iso: string): Date => new Date(iso);
const isoOf = (date: Date): string => date.toISOString();

describe('startOfWeek', () => {
  it('anchors to Monday by default', () => {
    // 2026-07-08 is a Wednesday -> Monday is 2026-07-06.
    expect(isoOf(startOfWeek(utc('2026-07-08T14:00:00.000Z')))).toBe('2026-07-06T00:00:00.000Z');
  });

  it('keeps a Monday as its own week start', () => {
    expect(isoOf(startOfWeek(utc('2026-07-06T23:59:00.000Z')))).toBe('2026-07-06T00:00:00.000Z');
  });

  it('supports a Sunday-first week', () => {
    expect(isoOf(startOfWeek(utc('2026-07-08T00:00:00.000Z'), 0))).toBe('2026-07-05T00:00:00.000Z');
  });
});

describe('windowForView', () => {
  const anchor = utc('2026-07-08T10:00:00.000Z'); // Wednesday

  it('day spans a single UTC day', () => {
    const { from, to } = windowForView('day', anchor);
    expect([isoOf(from), isoOf(to)]).toEqual(['2026-07-08T00:00:00.000Z', '2026-07-09T00:00:00.000Z']);
  });

  it('week spans Monday..Monday (7 days)', () => {
    const { from, to } = windowForView('week', anchor);
    expect([isoOf(from), isoOf(to)]).toEqual(['2026-07-06T00:00:00.000Z', '2026-07-13T00:00:00.000Z']);
  });

  it('workWeek is Monday-anchored and spans 5 days', () => {
    const { from, to } = windowForView('workWeek', anchor);
    expect([isoOf(from), isoOf(to)]).toEqual(['2026-07-06T00:00:00.000Z', '2026-07-11T00:00:00.000Z']);
    expect(daysInWindow({ from, to })).toHaveLength(5);
  });

  it('month covers whole weeks around the month', () => {
    const { from, to } = windowForView('month', anchor);
    // July 2026 starts Wed 1st -> grid starts Mon Jun 29; ends after the last week.
    expect(isoOf(from)).toBe('2026-06-29T00:00:00.000Z');
    expect(daysInWindow({ from, to }).length % 7).toBe(0);
  });
});

describe('stepAnchor', () => {
  it('steps a week by 7 days', () => {
    expect(isoOf(stepAnchor('week', utc('2026-07-08T00:00:00.000Z'), 1))).toBe('2026-07-15T00:00:00.000Z');
  });

  it('steps a month by one calendar month', () => {
    expect(isoOf(stepAnchor('month', utc('2026-07-15T00:00:00.000Z'), -1))).toBe('2026-06-15T00:00:00.000Z');
  });
});
