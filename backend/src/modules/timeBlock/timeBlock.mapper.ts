import type { TimeBlockDto } from '@ticktaskdone/shared';
import type { TimeBlock } from '../../db/schema';

export const toTimeBlockDto = (row: TimeBlock): TimeBlockDto => ({
  idTimeBlock: row.idTimeBlock,
  itemOccurrenceId: row.itemOccurrenceId,
  userId: row.userId,
  timeStart: row.timeStart.toISOString(),
  timeEnd: row.timeEnd.toISOString(),
  allDay: row.allDay,
  isBlocking: row.isBlocking,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});
