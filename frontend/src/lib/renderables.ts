import type { OccurrenceViewDto, ReminderDto } from '@ticktaskdone/shared';
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
  timeBlockId: number | null; // null for a virtual preview or an actual-view log block
  timeLogId: number | null; // set only for an actual-view block (real time logged)
  start: Date;
  end: Date;
  allDay: boolean;
  isBlocking: boolean;
  isVirtual: boolean;
}

// Planned = the timeBlocks (the plan); Actual = the timeLogs (real time spent),
// placed at startedAt/endedAt. Per brief §6 events render identically in both views
// (they have no timeLogs); only tasks differ. Actual-view blocks are read-only —
// the timer (M4c) is the only writer of logs.
export type CalendarRenderMode = 'planned' | 'actual';

const plannedBlocks = (occurrence: OccurrenceViewDto): CalendarBlock[] => {
  if (occurrence.timeBlocks.length > 0) {
    return occurrence.timeBlocks.map((timeBlock) => ({
      key: `tb-${timeBlock.idTimeBlock}`,
      occurrence,
      timeBlockId: timeBlock.idTimeBlock,
      timeLogId: null,
      start: new Date(timeBlock.timeStart),
      end: new Date(timeBlock.timeEnd),
      allDay: timeBlock.allDay,
      isBlocking: timeBlock.isBlocking,
      isVirtual: false,
    }));
  }
  if (occurrence.occurrenceDate !== null) {
    const start = new Date(occurrence.occurrenceDate);
    const minutes = occurrence.estimatedMinutes ?? DEFAULT_VIRTUAL_DURATION_MINUTES;
    return [
      {
        key: `occ-${occurrence.itemId}-${occurrence.occurrenceDate}`,
        occurrence,
        timeBlockId: null,
        timeLogId: null,
        start,
        end: new Date(start.getTime() + minutes * 60_000),
        allDay: false,
        isBlocking: false,
        isVirtual: true,
      },
    ];
  }
  return [];
};

// A running segment (endedAt null) is drawn from its start to `now` so an in-progress
// timer shows a live extent.
const actualBlocks = (occurrence: OccurrenceViewDto, now: Date): CalendarBlock[] =>
  occurrence.timeLogs.map((log) => ({
    key: `tl-${log.idTimeLog}`,
    occurrence,
    timeBlockId: null,
    timeLogId: log.idTimeLog,
    start: new Date(log.startedAt),
    end: log.endedAt ? new Date(log.endedAt) : now,
    allDay: false,
    isBlocking: false,
    isVirtual: false,
  }));

export const toCalendarBlocks = (
  occurrences: OccurrenceViewDto[],
  mode: CalendarRenderMode = 'planned',
  now: Date = new Date(),
): CalendarBlock[] => {
  const blocks: CalendarBlock[] = [];
  for (const occurrence of occurrences) {
    // Events are planned-only entries — identical in both views.
    if (mode === 'actual' && occurrence.type === 'task') {
      blocks.push(...actualBlocks(occurrence, now));
    } else {
      blocks.push(...plannedBlocks(occurrence));
    }
  }
  return blocks;
};

// An overdue reminder rendered as a list entry, placed at its effective deadline
// (dueDate, else the slot's occurrenceDate). Used by the List view to surface all
// past-due tasks regardless of the visible-from date. It carries no timeBlock, so it
// behaves like a virtual-but-materialized entry for toggle/edit.
export const reminderToCalendarBlock = (reminder: ReminderDto): CalendarBlock => {
  const deadline = new Date(reminder.effectiveDate);
  const occurrence: OccurrenceViewDto = {
    itemId: reminder.itemId,
    type: 'task',
    title: reminder.title,
    projectId: null,
    resolvedColor: reminder.resolvedColor,
    estimatedMinutes: null,
    timezone: null,
    isRecurrent: reminder.isRecurrent,
    idItemOccurrence: reminder.idItemOccurrence,
    occurrenceDate: reminder.occurrenceDate,
    status: reminder.status,
    dueDate: reminder.dueDate,
    materialized: true,
    timeBlocks: [],
    timeLogs: [],
  };
  return {
    key: `rem-${reminder.idItemOccurrence}`,
    occurrence,
    timeBlockId: null,
    timeLogId: null,
    start: deadline,
    end: new Date(deadline.getTime() + 30 * 60_000),
    allDay: false,
    isBlocking: false,
    isVirtual: false,
  };
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

// All-day blocks are FLOATING: their instant carries a date at UTC midnight and
// they must not shift across the viewer's timezone. So their day is read from the
// UTC date and mapped to the equivalent LOCAL midnight (to align with grid days).
const allDayLocalStart = (block: CalendarBlock): Date =>
  new Date(block.start.getUTCFullYear(), block.start.getUTCMonth(), block.start.getUTCDate());
const allDayLocalEnd = (block: CalendarBlock): Date =>
  new Date(block.end.getUTCFullYear(), block.end.getUTCMonth(), block.end.getUTCDate());

// The local Date a block sorts / groups by (all-day = its floating date, timed = its instant).
export const displayStart = (block: CalendarBlock): Date => (block.allDay ? allDayLocalStart(block) : block.start);

const coversDay = (block: CalendarBlock, dayStart: Date, dayEnd: Date): boolean => {
  if (block.allDay) {
    return allDayLocalStart(block).getTime() <= dayStart.getTime() && dayStart.getTime() < allDayLocalEnd(block).getTime();
  }
  return block.start.getTime() < dayEnd.getTime() && block.end.getTime() > dayStart.getTime();
};

// All-day (and multi-day) blocks intersecting the given local day.
export const allDayBlocksForDay = (blocks: CalendarBlock[], dayStart: Date): CalendarBlock[] => {
  const dayEnd = addDays(dayStart, 1);
  return blocks.filter((block) => block.allDay && coversDay(block, dayStart, dayEnd));
};

// Any block (timed or all-day) intersecting the given day, all-day first then by
// start. Used by the Month and List views.
export const blocksForDay = (blocks: CalendarBlock[], dayStart: Date): CalendarBlock[] => {
  const dayEnd = addDays(dayStart, 1);
  return blocks
    .filter((block) => coversDay(block, dayStart, dayEnd))
    .sort((left, right) => Number(right.allDay) - Number(left.allDay) || displayStart(left).getTime() - displayStart(right).getTime());
};
