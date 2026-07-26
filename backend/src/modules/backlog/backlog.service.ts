import { and, eq, gte, isNotNull, isNull, lte, notInArray, or } from 'drizzle-orm';
import type { BacklogTaskDto } from '@ticktaskdone/shared';
import { db } from '../../db/db';
import { item, itemOccurrence, timeBlock } from '../../db/schema';
import { expandRecurrence } from '../../domain/recurrence';
import { loadColorContext, resolveItemColor } from '../item/itemColor';

// The backlog: non-recurrent tasks with no timeBlock for the current user, still to do.
// A recurrent task lives on the calendar via its rule, so it is not backlog; a task with
// any block is scheduled. Tasks never materialized (no occurrence row) count as
// unscheduled too. Resolved tasks (done/cancelled) are excluded even when unscheduled —
// they are no longer "to plan". dueDate comes from the single occurrence when it exists.
export const listBacklog = async (workspaceId: number, userId: number): Promise<BacklogTaskDto[]> => {
  const rows = await db
    .select({ item, dueDate: itemOccurrence.dueDate })
    .from(item)
    .leftJoin(itemOccurrence, and(eq(itemOccurrence.itemId, item.idItem), isNull(itemOccurrence.occurrenceDate)))
    .leftJoin(
      timeBlock,
      and(eq(timeBlock.itemOccurrenceId, itemOccurrence.idItemOccurrence), eq(timeBlock.userId, userId)),
    )
    .where(
      and(
        eq(item.workspaceId, workspaceId),
        eq(item.type, 'task'),
        isNull(item.rrule),
        isNull(timeBlock.idTimeBlock),
        // No occurrence yet (null) is fine; a materialized one must still be actionable.
        or(isNull(itemOccurrence.status), notInArray(itemOccurrence.status, ['done', 'cancelled'])),
      ),
    );

  const colorContext = await loadColorContext(workspaceId);
  return rows.map((row) => ({
    itemId: row.item.idItem,
    title: row.item.title,
    projectId: row.item.projectId,
    resolvedColor: resolveItemColor(row.item, colorContext),
    estimatedMinutes: row.item.estimatedMinutes,
    dueDate: row.dueDate?.toISOString() ?? null,
  }));
};

// Recurring tasks with NO presence in the given window — no rule slot, no materialized
// occurrence, and no timeBlock inside [from, to]. Surfaced in a second tray so a task
// already scheduled in another week can be dragged in to add a one-off occurrence here.
export const listRecurringUnplanned = async (
  workspaceId: number,
  userId: number,
  from: Date,
  to: Date,
): Promise<BacklogTaskDto[]> => {
  const recurring = await db
    .select({ item })
    .from(item)
    .where(and(eq(item.workspaceId, workspaceId), eq(item.type, 'task'), isNotNull(item.rrule)));

  // Items with a materialized occurrence whose slot falls in the window.
  const occInWindow = await db
    .select({ itemId: itemOccurrence.itemId })
    .from(itemOccurrence)
    .innerJoin(item, eq(itemOccurrence.itemId, item.idItem))
    .where(and(eq(item.workspaceId, workspaceId), gte(itemOccurrence.occurrenceDate, from), lte(itemOccurrence.occurrenceDate, to)));
  const hasOccInWindow = new Set(occInWindow.map((row) => row.itemId));

  // Items with one of the user's blocks overlapping the window (a moved slot counts).
  const blockInWindow = await db
    .select({ itemId: item.idItem })
    .from(timeBlock)
    .innerJoin(itemOccurrence, eq(timeBlock.itemOccurrenceId, itemOccurrence.idItemOccurrence))
    .innerJoin(item, eq(itemOccurrence.itemId, item.idItem))
    .where(and(eq(item.workspaceId, workspaceId), eq(timeBlock.userId, userId), lte(timeBlock.timeStart, to), gte(timeBlock.timeEnd, from)));
  const hasBlockInWindow = new Set(blockInWindow.map((row) => row.itemId));

  const colorContext = await loadColorContext(workspaceId);
  return recurring
    .filter(({ item: it }) => {
      if (hasOccInWindow.has(it.idItem) || hasBlockInWindow.has(it.idItem)) return false;
      return expandRecurrence(it, from, to).length === 0; // the rule itself yields nothing here
    })
    .map(({ item: it }) => ({
      itemId: it.idItem,
      title: it.title,
      projectId: it.projectId,
      resolvedColor: resolveItemColor(it, colorContext),
      estimatedMinutes: it.estimatedMinutes,
      dueDate: null,
    }));
};
