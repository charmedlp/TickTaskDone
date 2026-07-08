import type { ItemType } from '../validation/item.validation';
import type { OccurrenceStatus } from '../validation/itemOccurrence.validation';
import type { TimeBlockDto } from './timeBlock.dto';
import type { TimeLogDto } from './timeLog.dto';

// One occurrence as seen on the calendar feed: the virtual/materialized merge for
// a date window. `idItemOccurrence` is null while the slot is still virtual; a
// virtual slot carries its recurrence datetime in `occurrenceDate` and an implicit
// `todo` status. Item context (type, title, color) is embedded so the calendar
// renders in a single round-trip. `timeBlocks` are the current user's PLANNED
// placements; `timeLogs` are the ACTUAL time spent (the planned/actual toggle picks
// which to render). Both are empty for an unscheduled or purely virtual slot.
export interface OccurrenceViewDto {
  itemId: number;
  type: ItemType;
  title: string;
  projectId: number | null; // null = ephemeral (no real project); drives the ALT-copy tree
  resolvedColor: string;
  estimatedMinutes: number | null;
  timezone: string | null; // the item's IANA id (for virtual-slot / dueDate wall-clock)
  isRecurrent: boolean; // has an rrule
  idItemOccurrence: number | null;
  occurrenceDate: string | null;
  status: OccurrenceStatus;
  dueDate: string | null;
  materialized: boolean;
  timeBlocks: TimeBlockDto[];
  timeLogs: TimeLogDto[];
}
