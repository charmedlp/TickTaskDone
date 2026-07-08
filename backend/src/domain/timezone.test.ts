import { describe, expect, it } from 'vitest';
import { instantToWallClock, wallClockToInstant, type WallClock } from './timezone';

const wall = (year: number, month: number, day: number, hour: number, minute = 0, second = 0): WallClock => ({
  year,
  month,
  day,
  hour,
  minute,
  second,
});

const MONTREAL = 'America/Montreal';

describe('wallClockToInstant', () => {
  it('applies the summer (EDT, -4) offset', () => {
    // 2026-07-08 09:00 Montreal (EDT) = 13:00 UTC.
    expect(wallClockToInstant(wall(2026, 7, 8, 9), MONTREAL).toISOString()).toBe('2026-07-08T13:00:00.000Z');
  });

  it('applies the winter (EST, -5) offset', () => {
    // 2026-01-08 09:00 Montreal (EST) = 14:00 UTC.
    expect(wallClockToInstant(wall(2026, 1, 8, 9), MONTREAL).toISOString()).toBe('2026-01-08T14:00:00.000Z');
  });

  it('keeps a UTC wall-clock as-is', () => {
    expect(wallClockToInstant(wall(2026, 7, 8, 9), 'UTC').toISOString()).toBe('2026-07-08T09:00:00.000Z');
  });

  it('round-trips with instantToWallClock', () => {
    const instant = wallClockToInstant(wall(2026, 3, 15, 14, 30), MONTREAL);
    const back = instantToWallClock(instant, MONTREAL);
    expect([back.year, back.month, back.day, back.hour, back.minute]).toEqual([2026, 3, 15, 14, 30]);
  });
});

describe('instantToWallClock', () => {
  it('shows a UTC instant in Montreal summer time', () => {
    const back = instantToWallClock(new Date('2026-07-08T13:00:00.000Z'), MONTREAL);
    expect([back.year, back.month, back.day, back.hour, back.minute]).toEqual([2026, 7, 8, 9, 0]);
  });
});
