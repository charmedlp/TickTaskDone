import type { ItemType } from '../validation/item.validation';
import type { OccurrenceStatus } from '../validation/itemOccurrence.validation';
import type { TimeBlockDto } from './timeBlock.dto';

// One occurrence as seen on the calendar feed: the virtual/materialized merge for
// a date window. `idItemOccurrence` is null while the slot is still virtual; a
// virtual slot carries its recurrence datetime in `occurrenceDate` and an implicit
// `todo` status. Item context (type, title, color) is embedded so the calendar
// renders in a single round-trip. `timeBlocks` are the current user's placements
// (empty for an unscheduled or purely virtual slot; the client can render a
// virtual slot at `occurrenceDate` for `estimatedMinutes`).
export interface OccurrenceViewDto {
  itemId: number;
  type: ItemType;
  title: string;
  resolvedColor: string;
  estimatedMinutes: number | null;
  idItemOccurrence: number | null;
  occurrenceDate: string | null;
  status: OccurrenceStatus;
  dueDate: string | null;
  materialized: boolean;
  timeBlocks: TimeBlockDto[];
}
