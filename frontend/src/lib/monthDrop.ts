import { MINUTES_PER_DAY, startOfDay } from './datetime';

// Start time (minutes from the day's midnight) implied by dropping an item at
// `insertIndex` among a day's already-sorted items, in the Month view:
//  - first position, or right after a full-day item -> midnight (0);
//  - right after a timed item -> that item's END time;
//  - unless that item overflows the day (ends at/after next midnight) -> its START.
export interface DropNeighbour {
  start: Date;
  end: Date;
  allDay: boolean;
}

export const startMinutesForInsert = (items: DropNeighbour[], day: Date, insertIndex: number): number => {
  if (insertIndex <= 0) {
    return 0;
  }
  const previous = items[insertIndex - 1];
  if (!previous || previous.allDay) {
    return 0;
  }
  const dayStart = startOfDay(day).getTime();
  const endMinutes = (previous.end.getTime() - dayStart) / 60_000;
  if (endMinutes >= MINUTES_PER_DAY || endMinutes < 0) {
    const startMinutes = (previous.start.getTime() - dayStart) / 60_000;
    return Math.max(0, Math.min(Math.round(startMinutes), MINUTES_PER_DAY - 1));
  }
  return Math.round(endMinutes);
};
