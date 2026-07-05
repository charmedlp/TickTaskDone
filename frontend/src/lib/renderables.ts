import type { OccurrenceViewDto } from '@ticktaskdone/shared';
import { addDays } from './datetime';

// A single paintable block on the grid. A materialized occurrence yields one
// block per timeBlock (a split task appears several times); a virtual recurring
// slot yields one preview block at its occurrenceDate. Per brief §4 the virtual
// vs materialized distinction is invisible to the user, so nothing marks it here
// beyond `isVirtual` (kept for later edit-time materialization).
export const DEFAULT_VIRTUAL_DURATION_MINUTES = 30;

export interface CalendarBlock {
  key: string;
  occurrence: OccurrenceViewDto;
  timeBlockId: number | null; // null for a virtual (not-yet-materialized) preview
  start: Date;
  end: Date;
  allDay: boolean;
  isBlocking: boolean;
  isVirtual: boolean;
}

export const toCalendarBlocks = (occurrences: OccurrenceViewDto[]): CalendarBlock[] => {
  const blocks: CalendarBlock[] = [];
  for (const occurrence of occurrences) {
    if (occurrence.timeBlocks.length > 0) {
      for (const timeBlock of occurrence.timeBlocks) {
        blocks.push({
          key: `tb-${timeBlock.idTimeBlock}`,
          occurrence,
          timeBlockId: timeBlock.idTimeBlock,
          start: new Date(timeBlock.timeStart),
          end: new Date(timeBlock.timeEnd),
          allDay: timeBlock.allDay,
          isBlocking: timeBlock.isBlocking,
          isVirtual: false,
        });
      }
    } else if (occurrence.occurrenceDate !== null) {
      const start = new Date(occurrence.occurrenceDate);
      const minutes = occurrence.estimatedMinutes ?? DEFAULT_VIRTUAL_DURATION_MINUTES;
      blocks.push({
        key: `occ-${occurrence.itemId}-${occurrence.occurrenceDate}`,
        occurrence,
        timeBlockId: null,
        start,
        end: new Date(start.getTime() + minutes * 60_000),
        allDay: false,
        isBlocking: false,
        isVirtual: true,
      });
    }
  }
  return blocks;
};

export interface DayTimedEntry {
  block: CalendarBlock;
  startMinutes: number;
  endMinutes: number;
}

// Timed blocks overlapping the given day, clamped to it for vertical extent so a
// multi-day block renders in each day column it covers.
export const timedBlocksForDay = (blocks: CalendarBlock[], dayStart: Date): DayTimedEntry[] => {
  const dayEnd = addDays(dayStart, 1);
  const entries: DayTimedEntry[] = [];
  for (const block of blocks) {
    if (block.allDay) {
      continue;
    }
    const start = block.start < dayStart ? dayStart : block.start;
    const end = block.end > dayEnd ? dayEnd : block.end;
    if (end <= start) {
      continue;
    }
    entries.push({
      block,
      startMinutes: (start.getTime() - dayStart.getTime()) / 60_000,
      endMinutes: (end.getTime() - dayStart.getTime()) / 60_000,
    });
  }
  return entries;
};

// All-day (and multi-day) blocks intersecting the given day.
export const allDayBlocksForDay = (blocks: CalendarBlock[], dayStart: Date): CalendarBlock[] => {
  const dayEnd = addDays(dayStart, 1);
  return blocks.filter((block) => block.allDay && block.start < dayEnd && block.end > dayStart);
};
