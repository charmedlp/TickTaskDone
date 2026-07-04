import type { OccurrenceStatus } from '../validation/itemOccurrence.validation';

// An overdue reminder: a materialized occurrence still `todo` whose dueDate has
// passed. Item context is embedded so the client can render without a lookup.
export interface ReminderDto {
  idItemOccurrence: number;
  itemId: number;
  title: string;
  occurrenceDate: string | null;
  dueDate: string;
  status: OccurrenceStatus;
}
