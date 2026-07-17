import type { OccurrenceStatus } from '../validation/itemOccurrence.validation';
import type { TimeBlockDto } from './timeBlock.dto';

// One PLANNED moment of a task (brief §3.1): the current user's timeBlocks on an
// occurrence. A non-recurrent task has a single occurrence with possibly several
// blocks (splits); a recurrent task has one moment per slot. For a recurrent task the
// list also includes UPCOMING virtual slots (expanded from the rule, not yet
// materialized) so the user sees what's coming — those carry `materialized: false`,
// `idItemOccurrence: null` and no timeBlocks. Their start is `occurrenceDate` (the
// slot's wall-clock) and their duration is the item's estimate.
export interface PlannedMomentDto {
  idItemOccurrence: number | null; // null = virtual (not materialized yet)
  occurrenceDate: string | null;
  status: OccurrenceStatus;
  dueDate: string | null;
  timeBlocks: TimeBlockDto[];
  materialized: boolean;
}

// One page of a task's planned moments. A recurrent series can be infinite, so
// navigation is cursor-based (start / next / previous) with no total or page number:
// `hasPrev`/`hasNext` say whether the arrows are live. A non-recurrent task returns all
// its moments in a single page (both flags false).
export interface PlannedMomentsPageDto {
  moments: PlannedMomentDto[];
  hasPrev: boolean;
  hasNext: boolean;
  // A next event (>= now) exists AND is not already on this page — gate the "jump to
  // next event" shortcut on it.
  canJumpToUpcoming: boolean;
}
