import type { ItemOccurrenceDto, PlannedMomentDto } from '@ticktaskdone/shared';
import type { ItemOccurrence } from '../../db/schema';
import { toTimeBlockDto } from '../timeBlock/timeBlock.mapper';
import type { ItemMoment } from './itemOccurrence.service';

export const toItemOccurrenceDto = (row: ItemOccurrence): ItemOccurrenceDto => ({
  idItemOccurrence: row.idItemOccurrence,
  itemId: row.itemId,
  occurrenceDate: row.occurrenceDate?.toISOString() ?? null,
  status: row.status,
  dueDate: row.dueDate?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

export const toPlannedMomentDto = (moment: ItemMoment): PlannedMomentDto => ({
  idItemOccurrence: moment.idItemOccurrence,
  occurrenceDate: moment.occurrenceDate?.toISOString() ?? null,
  status: moment.status,
  dueDate: moment.dueDate?.toISOString() ?? null,
  timeBlocks: moment.timeBlocks.map(toTimeBlockDto),
  materialized: moment.materialized,
});
