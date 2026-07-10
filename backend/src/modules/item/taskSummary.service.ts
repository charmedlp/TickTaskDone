import { and, eq, inArray } from 'drizzle-orm';
import type { TaskSummaryDto } from '@ticktaskdone/shared';
import { db } from '../../db/db';
import { item, itemOccurrence, timeBlock, timeLog } from '../../db/schema';

const minutesBetween = (start: Date, end: Date): number => Math.max(0, (end.getTime() - start.getTime()) / 60_000);

// Per-task rollups for the whole workspace (brief §2/§4), computed with a handful of
// grouped queries — never per-task (Constitution: no N+1). Blocks/logs are the current
// user's (a personal schedule). All-day blocks are excluded from planned hours (they
// float; they are not timed work).
export const listTaskSummaries = async (workspaceId: number, userId: number): Promise<TaskSummaryDto[]> => {
  const items = await db
    .select()
    .from(item)
    .where(and(eq(item.workspaceId, workspaceId), eq(item.type, 'task')));
  if (items.length === 0) {
    return [];
  }

  const occurrences = await db
    .select()
    .from(itemOccurrence)
    .where(inArray(itemOccurrence.itemId, items.map((row) => row.idItem)));
  const occurrenceIds = occurrences.map((occurrence) => occurrence.idItemOccurrence);
  const itemOfOccurrence = new Map(occurrences.map((occurrence) => [occurrence.idItemOccurrence, occurrence.itemId]));

  const blocks = occurrenceIds.length
    ? await db.select().from(timeBlock).where(and(inArray(timeBlock.itemOccurrenceId, occurrenceIds), eq(timeBlock.userId, userId)))
    : [];
  const logs = occurrenceIds.length
    ? await db.select().from(timeLog).where(and(inArray(timeLog.itemOccurrenceId, occurrenceIds), eq(timeLog.userId, userId)))
    : [];

  // Aggregate per item.
  const plannedMinutes = new Map<number, number>();
  const hasBlock = new Set<number>();
  for (const block of blocks) {
    const itemId = itemOfOccurrence.get(block.itemOccurrenceId);
    if (itemId === undefined) {
      continue;
    }
    hasBlock.add(itemId);
    if (!block.allDay) {
      plannedMinutes.set(itemId, (plannedMinutes.get(itemId) ?? 0) + minutesBetween(block.timeStart, block.timeEnd));
    }
  }
  const loggedMinutes = new Map<number, number>();
  for (const log of logs) {
    const itemId = itemOfOccurrence.get(log.itemOccurrenceId);
    if (itemId === undefined || log.endedAt === null) {
      continue;
    }
    loggedMinutes.set(itemId, (loggedMinutes.get(itemId) ?? 0) + minutesBetween(log.startedAt, log.endedAt));
  }
  // A non-recurring task's single occurrence (occurrenceDate null).
  const singleOccurrence = new Map<number, (typeof occurrences)[number]>();
  for (const occurrence of occurrences) {
    if (occurrence.occurrenceDate === null) {
      singleOccurrence.set(occurrence.itemId, occurrence);
    }
  }

  return items.map((row) => {
    const isRecurrent = row.rrule !== null;
    const single = isRecurrent ? undefined : singleOccurrence.get(row.idItem);
    return {
      itemId: row.idItem,
      projectId: row.projectId,
      title: row.title,
      isRecurrent,
      status: single?.status ?? null,
      dueDate: single?.dueDate?.toISOString() ?? null,
      planned: hasBlock.has(row.idItem),
      estimatedMinutes: row.estimatedMinutes,
      plannedMinutes: Math.round(plannedMinutes.get(row.idItem) ?? 0),
      loggedMinutes: Math.round(loggedMinutes.get(row.idItem) ?? 0),
    };
  });
};
