import type { ItemOccurrenceDto } from '@ticktaskdone/shared';
import type { ItemOccurrence } from '../../db/schema';

export const toItemOccurrenceDto = (row: ItemOccurrence): ItemOccurrenceDto => ({
  idItemOccurrence: row.idItemOccurrence,
  itemId: row.itemId,
  occurrenceDate: row.occurrenceDate?.toISOString() ?? null,
  status: row.status,
  dueDate: row.dueDate?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});
