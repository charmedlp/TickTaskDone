import { and, eq, isNull } from 'drizzle-orm';
import { resolveColor, type BacklogTaskDto } from '@ticktaskdone/shared';
import { db } from '../../db/db';
import { item, itemOccurrence, project, timeBlock } from '../../db/schema';

// The backlog: non-recurrent tasks with no timeBlock for the current user. A
// recurrent task lives on the calendar via its rule, so it is not backlog; a task
// with any block is scheduled. Tasks never materialized (no occurrence row) count
// as unscheduled too. dueDate comes from the single occurrence when it exists.
export const listBacklog = async (workspaceId: number, userId: number): Promise<BacklogTaskDto[]> => {
  const rows = await db
    .select({ item, projectColor: project.color, dueDate: itemOccurrence.dueDate })
    .from(item)
    .leftJoin(project, eq(item.projectId, project.idProject))
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
      ),
    );

  return rows.map((row) => ({
    itemId: row.item.idItem,
    title: row.item.title,
    projectId: row.item.projectId,
    resolvedColor: resolveColor(row.item.color, row.projectColor),
    estimatedMinutes: row.item.estimatedMinutes,
    dueDate: row.dueDate?.toISOString() ?? null,
  }));
};
