import type { OccurrenceStatus } from '../validation/itemOccurrence.validation';
import type { TimeBlockDto } from './timeBlock.dto';

// One PLANNED moment of a task (brief §3.1): a materialized occurrence and the
// current user's timeBlocks on it. A non-recurrent task has a single occurrence with
// possibly several blocks (splits); a recurrent task has one occurrence per
// materialized slot, each with at most one block. Purely virtual future slots are
// NOT included (they are not materialized rows).
export interface PlannedMomentDto {
  idItemOccurrence: number;
  occurrenceDate: string | null;
  status: OccurrenceStatus;
  dueDate: string | null;
  timeBlocks: TimeBlockDto[];
}
