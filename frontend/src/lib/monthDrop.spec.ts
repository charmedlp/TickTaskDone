import { describe, expect, it } from 'vitest';
import { startMinutesForInsert, type DropNeighbour } from './monthDrop';

const day = new Date('2026-07-08T00:00:00.000Z');
const at = (hour: number, minute = 0): Date => new Date(Date.UTC(2026, 6, 8, hour, minute, 0));
const timed = (startHour: number, startMin: number, endHour: number, endMin: number): DropNeighbour => ({
  start: at(startHour, startMin),
  end: at(endHour, endMin),
  allDay: false,
});
const allDay: DropNeighbour = { start: day, end: new Date('2026-07-09T00:00:00.000Z'), allDay: true };
// 22:00 -> next day 01:00 (overflows the day).
const overflow: DropNeighbour = { start: at(22, 0), end: new Date('2026-07-09T01:00:00.000Z'), allDay: false };

describe('startMinutesForInsert', () => {
  it('first position -> midnight', () => {
    expect(startMinutesForInsert([timed(9, 0, 10, 0)], day, 0)).toBe(0);
  });

  it('after a timed item -> its end time', () => {
    expect(startMinutesForInsert([timed(9, 0, 10, 0)], day, 1)).toBe(600); // 10:00
  });

  it('after the second of two items -> that one’s end', () => {
    expect(startMinutesForInsert([timed(9, 0, 10, 0), timed(10, 30, 11, 0)], day, 2)).toBe(660); // 11:00
  });

  it('after a full-day item -> midnight', () => {
    expect(startMinutesForInsert([allDay], day, 1)).toBe(0);
  });

  it('after an item overflowing the day -> its start time', () => {
    expect(startMinutesForInsert([overflow], day, 1)).toBe(1320); // 22:00
  });

  it('after an item ending exactly at midnight -> its start time (counts as overflow)', () => {
    const untilMidnight: DropNeighbour = { start: at(23, 0), end: new Date('2026-07-09T00:00:00.000Z'), allDay: false };
    expect(startMinutesForInsert([untilMidnight], day, 1)).toBe(1380); // 23:00
  });
});
