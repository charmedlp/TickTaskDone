import { resolveColor, type OccurrenceViewDto, type ReminderDto } from '@ticktaskdone/shared';
import { toTimeBlockDto } from '../timeBlock/timeBlock.mapper';
import { toTimeLogDto } from '../timeLog/timeLog.mapper';
import type { OccurrenceView, ReminderRow } from './occurrence.service';

export const toOccurrenceViewDto = (view: OccurrenceView): OccurrenceViewDto => ({
  itemId: view.item.idItem,
  type: view.item.type,
  title: view.item.title,
  projectId: view.item.projectId,
  resolvedColor: resolveColor(view.item.color, view.projectColor),
  estimatedMinutes: view.item.estimatedMinutes,
  timezone: view.item.timezone,
  isRecurrent: view.item.rrule !== null,
  idItemOccurrence: view.idItemOccurrence,
  occurrenceDate: view.occurrenceDate?.toISOString() ?? null,
  status: view.status,
  dueDate: view.dueDate?.toISOString() ?? null,
  materialized: view.materialized,
  timeBlocks: view.timeBlocks.map(toTimeBlockDto),
  timeLogs: view.timeLogs.map(toTimeLogDto),
});

export const toReminderDto = (row: ReminderRow): ReminderDto => ({
  idItemOccurrence: row.idItemOccurrence,
  itemId: row.itemId,
  title: row.title,
  resolvedColor: row.resolvedColor,
  occurrenceDate: row.occurrenceDate?.toISOString() ?? null,
  dueDate: row.dueDate?.toISOString() ?? null,
  effectiveDate: row.effectiveDate.toISOString(),
  status: row.status,
  isRecurrent: row.isRecurrent,
});
