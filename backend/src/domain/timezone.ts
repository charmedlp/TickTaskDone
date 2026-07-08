// Timezone conversions using the platform Intl database (no external dependency).
// We store absolute instants (UTC) plus an IANA timezone id per row; recurrence is
// expanded in the item's timezone so it stays DST-correct ("every day at 09:00
// local" keeps its wall-clock across a DST change).

export interface WallClock {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();
const formatterFor = (timeZone: string): Intl.DateTimeFormat => {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
};

// The wall-clock an instant shows as in the given timezone.
export const instantToWallClock = (instant: Date, timeZone: string): WallClock => {
  const parts = formatterFor(timeZone).formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');
  const hour = value('hour');
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: hour === 24 ? 0 : hour, // some engines format midnight as 24 under h23
    minute: value('minute'),
    second: value('second'),
  };
};

// Timezone offset (ms) at an instant: (wall-clock read as if UTC) - instant.
const offsetAt = (instant: Date, timeZone: string): number => {
  const wall = instantToWallClock(instant, timeZone);
  return Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second) - instant.getTime();
};

// The UTC instant for a wall-clock in the given timezone (two-step, DST-aware).
export const wallClockToInstant = (wall: WallClock, timeZone: string): Date => {
  const naive = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  // Estimate the offset at the naive instant, then refine once at the corrected
  // instant so a DST boundary between the two resolves correctly.
  const firstOffset = offsetAt(new Date(naive), timeZone);
  const secondOffset = offsetAt(new Date(naive - firstOffset), timeZone);
  return new Date(naive - secondOffset);
};
