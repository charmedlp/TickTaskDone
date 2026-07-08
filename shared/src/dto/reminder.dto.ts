import type { OccurrenceStatus } from '../validation/itemOccurrence.validation';

// An overdue reminder: a TASK occurrence still `todo` whose effective deadline has
// passed. The deadline is `dueDate` when set, otherwise the slot's `occurrenceDate`
// (a scheduled/recurring task is due at its slot time). Item context is embedded so
// the client can render without a lookup.
export interface ReminderDto {
  idItemOccurrence: number;
  itemId: number;
  title: string;
  occurrenceDate: string | null;
  dueDate: string | null;
  status: OccurrenceStatus;
}
