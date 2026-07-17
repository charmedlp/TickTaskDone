import { and, eq, inArray } from 'drizzle-orm';
import type { EnableRecurrenceInput } from '@ticktaskdone/shared';
import { db } from '../../db/db';
import { item, itemCategory, itemOccurrence, timeBlock, timeLog } from '../../db/schema';
import { AppError, notFound } from '../../http/errors';

// The three recurrence toggles (brief §3.2). Each is a data transformation guarded so
// the "recurrence XOR split" invariant can never be violated. All run in one
// transaction — nothing is left half-converted.

// A / B — enable recurrence on a non-recurring task. The task's blocks become the
// occurrences of the new recurring item: the EARLIEST block anchors the rule
// (recurrenceStart) as the first occurrence; each other block becomes a custom
// (off-rule) occurrence with its single block. A single-block task (A) is just the
// N=1 case; a split task (B) is N>1. Nothing is destroyed.
export const enableRecurrence = async (
  workspaceId: number,
  userId: number,
  idItem: number,
  input: EnableRecurrenceInput,
): Promise<void> => {
  const { rrule } = input;
  await db.transaction(async (transaction) => {
    const [definition] = await transaction
      .select()
      .from(item)
      .where(and(eq(item.idItem, idItem), eq(item.workspaceId, workspaceId)))
      .limit(1);
    if (!definition) {
      throw notFound('Item');
    }
    if (definition.type !== 'task') {
      throw new AppError(400, 'ONLY_TASKS_CAN_RECUR');
    }
    if (definition.rrule !== null) {
      throw new AppError(400, 'TASK_ALREADY_RECURRING');
    }

    // A non-recurring task has a single occurrence (occurrenceDate null); create one
    // if it somehow has none (a pure backlog item never yet materialized).
    const occurrences = await transaction.select().from(itemOccurrence).where(eq(itemOccurrence.itemId, idItem));
    let anchor = occurrences[0];
    if (!anchor) {
      const [{ idItemOccurrence }] = await transaction
        .insert(itemOccurrence)
        .values({ itemId: idItem, occurrenceDate: null, createdBy: userId, updatedBy: userId })
        .$returningId();
      [anchor] = await transaction
        .select()
        .from(itemOccurrence)
        .where(eq(itemOccurrence.idItemOccurrence, idItemOccurrence))
        .limit(1);
    }

    const occurrenceIds = occurrences.map((occurrence) => occurrence.idItemOccurrence);
    const blocks = occurrenceIds.length
      ? await transaction.select().from(timeBlock).where(inArray(timeBlock.itemOccurrenceId, occurrenceIds))
      : [];
    const sorted = [...blocks].sort((left, right) => left.timeStart.getTime() - right.timeStart.getTime());

    // The rule anchor ("À partir de …"): the client's explicit value when given,
    // otherwise derived — earliest block's start, else the occurrence's dueDate, else now.
    const recurrenceStart = input.recurrenceStart ?? sorted[0]?.timeStart ?? anchor.dueDate ?? new Date();
    const timezone = input.timezone ?? sorted[0]?.timezone ?? definition.timezone ?? null;

    // The anchor occurrence becomes the first (on-rule) instance, keeping its status,
    // dueDate and earliest block.
    await transaction
      .update(itemOccurrence)
      .set({ occurrenceDate: recurrenceStart, updatedBy: userId })
      .where(eq(itemOccurrence.idItemOccurrence, anchor.idItemOccurrence));

    // Every other block becomes its own custom occurrence.
    for (const block of sorted.slice(1)) {
      const [{ idItemOccurrence }] = await transaction
        .insert(itemOccurrence)
        .values({ itemId: idItem, occurrenceDate: block.timeStart, createdBy: userId, updatedBy: userId })
        .$returningId();
      await transaction
        .update(timeBlock)
        .set({ itemOccurrenceId: idItemOccurrence, updatedBy: userId })
        .where(eq(timeBlock.idTimeBlock, block.idTimeBlock));
    }

    await transaction
      .update(item)
      .set({ rrule, recurrenceStart, timezone, updatedBy: userId })
      .where(eq(item.idItem, idItem));
  });
};

// C — remove recurrence. Each MATERIALIZED occurrence that carries data (a timeBlock,
// a timeLog, or a done status — custom occurrences always have a block) becomes its
// own separate non-recurring task, keeping its status/dueDate and its blocks/logs.
// Purely virtual (rule-only, untouched) slots have no row and simply vanish. The
// original item has no privileged status: it is deleted, and if NOTHING was preserved
// the task disappears entirely (no empty backlog shell). Returns how many tasks
// resulted, for the caller's confirmation copy.
export const removeRecurrence = async (workspaceId: number, userId: number, idItem: number): Promise<number> =>
  db.transaction(async (transaction) => {
    const [definition] = await transaction
      .select()
      .from(item)
      .where(and(eq(item.idItem, idItem), eq(item.workspaceId, workspaceId)))
      .limit(1);
    if (!definition) {
      throw notFound('Item');
    }
    if (definition.rrule === null) {
      throw new AppError(400, 'TASK_NOT_RECURRING');
    }

    const occurrences = await transaction.select().from(itemOccurrence).where(eq(itemOccurrence.itemId, idItem));
    const categoryIds = (
      await transaction.select({ categoryId: itemCategory.categoryId }).from(itemCategory).where(eq(itemCategory.itemId, idItem))
    ).map((row) => row.categoryId);

    let created = 0;
    for (const occurrence of occurrences) {
      const blocks = await transaction.select().from(timeBlock).where(eq(timeBlock.itemOccurrenceId, occurrence.idItemOccurrence));
      const logs = await transaction.select().from(timeLog).where(eq(timeLog.itemOccurrenceId, occurrence.idItemOccurrence));
      const carriesData = blocks.length > 0 || logs.length > 0 || occurrence.status === 'done';
      if (!carriesData) {
        continue; // virtual-like: dropped with the item
      }

      const [{ idItem: newItemId }] = await transaction
        .insert(item)
        .values({
          workspaceId,
          type: definition.type,
          projectId: definition.projectId,
          title: definition.title,
          description: definition.description,
          color: definition.color,
          estimatedMinutes: definition.estimatedMinutes,
          rrule: null,
          recurrenceStart: null,
          timezone: definition.timezone,
          createdBy: userId,
          updatedBy: userId,
        })
        .$returningId();

      for (const categoryId of categoryIds) {
        await transaction.insert(itemCategory).values({ itemId: newItemId, categoryId, createdBy: userId });
      }

      const [{ idItemOccurrence: newOccurrenceId }] = await transaction
        .insert(itemOccurrence)
        .values({
          itemId: newItemId,
          occurrenceDate: null,
          status: occurrence.status,
          dueDate: occurrence.dueDate,
          createdBy: userId,
          updatedBy: userId,
        })
        .$returningId();

      for (const block of blocks) {
        await transaction
          .update(timeBlock)
          .set({ itemOccurrenceId: newOccurrenceId, updatedBy: userId })
          .where(eq(timeBlock.idTimeBlock, block.idTimeBlock));
      }
      for (const log of logs) {
        await transaction
          .update(timeLog)
          .set({ itemOccurrenceId: newOccurrenceId, updatedBy: userId })
          .where(eq(timeLog.idTimeLog, log.idTimeLog));
      }
      created += 1;
    }

    // Delete the original: its now block/log-free occurrences (and any virtual-only
    // rows) cascade away; the reassigned blocks/logs live on under the new items.
    await transaction.delete(item).where(eq(item.idItem, idItem));
    return created;
  });
