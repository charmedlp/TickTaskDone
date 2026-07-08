import { eq } from 'drizzle-orm';
import type { CreateScheduledItemInput } from '@ticktaskdone/shared';
import { db } from '../../db/db';
import { item, itemOccurrence, project, timeBlock, type TimeBlock } from '../../db/schema';
import { assertCategoriesInWorkspace, replaceItemCategories } from '../itemCategory/itemCategory.service';
import type { OccurrenceView } from '../occurrence/occurrence.service';

// Creates an item, its first occurrence, and optionally one timeBlock, atomically.
// Returns the assembled OccurrenceView so the caller renders it without a refetch.
export const createScheduledItem = async (
  workspaceId: number,
  userId: number,
  input: CreateScheduledItemInput,
): Promise<OccurrenceView> => {
  await assertCategoriesInWorkspace(workspaceId, input.item.categoryIds ?? []);

  return db.transaction(async (transaction) => {
    const [{ idItem }] = await transaction
      .insert(item)
      .values({
        workspaceId,
        type: input.item.type,
        projectId: input.item.projectId,
        title: input.item.title,
        description: input.item.description,
        color: input.item.color,
        estimatedMinutes: input.item.estimatedMinutes,
        rrule: input.item.rrule,
        recurrenceStart: input.item.recurrenceStart,
        timezone: input.item.timezone,
        createdBy: userId,
        updatedBy: userId,
      })
      .$returningId();

    await replaceItemCategories(transaction, userId, idItem, input.item.categoryIds ?? []);

    const [{ idItemOccurrence }] = await transaction
      .insert(itemOccurrence)
      .values({
        itemId: idItem,
        occurrenceDate: input.occurrenceDate,
        dueDate: input.dueDate,
        createdBy: userId,
        updatedBy: userId,
      })
      .$returningId();

    if (input.timeBlock) {
      await transaction.insert(timeBlock).values({
        itemOccurrenceId: idItemOccurrence,
        userId,
        timeStart: input.timeBlock.timeStart,
        timeEnd: input.timeBlock.timeEnd,
        allDay: input.timeBlock.allDay,
        isBlocking: input.timeBlock.isBlocking,
        timezone: input.timeBlock.timezone,
        createdBy: userId,
        updatedBy: userId,
      });
    }

    const [row] = await transaction
      .select({ item, projectColor: project.color })
      .from(item)
      .leftJoin(project, eq(item.projectId, project.idProject))
      .where(eq(item.idItem, idItem))
      .limit(1);
    const [occurrence] = await transaction
      .select()
      .from(itemOccurrence)
      .where(eq(itemOccurrence.idItemOccurrence, idItemOccurrence))
      .limit(1);
    const timeBlocks: TimeBlock[] = await transaction
      .select()
      .from(timeBlock)
      .where(eq(timeBlock.itemOccurrenceId, idItemOccurrence));

    return {
      item: row.item,
      projectColor: row.projectColor,
      idItemOccurrence: occurrence.idItemOccurrence,
      occurrenceDate: occurrence.occurrenceDate,
      status: occurrence.status,
      dueDate: occurrence.dueDate,
      materialized: true,
      timeBlocks,
      timeLogs: [], // a freshly created scheduled item has no real time yet
    };
  });
};
