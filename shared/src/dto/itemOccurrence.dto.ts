import type { OccurrenceStatus } from '../validation/itemOccurrence.validation';

// API contract for an item occurrence (the state of one instance of an item).
export interface ItemOccurrenceDto {
  idItemOccurrence: number;
  itemId: number;
  occurrenceDate: string | null;
  status: OccurrenceStatus;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
}
