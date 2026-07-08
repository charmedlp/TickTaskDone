import type { TimeLogDto } from '@ticktaskdone/shared';
import type { TimeLog } from '../../db/schema';

export const toTimeLogDto = (row: TimeLog): TimeLogDto => ({
  idTimeLog: row.idTimeLog,
  itemOccurrenceId: row.itemOccurrenceId,
  userId: row.userId,
  startedAt: row.startedAt.toISOString(),
  endedAt: row.endedAt?.toISOString() ?? null,
  source: row.source,
  timezone: row.timezone,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});
