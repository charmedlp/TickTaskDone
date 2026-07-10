import { and, eq } from 'drizzle-orm';
import type { CreateItemOccurrenceInput, UpdateItemOccurrenceInput } from '@ticktaskdone/shared';
import { db } from '../../db/db';
import { itemOccurrence, timeBlock, type ItemOccurrence, type TimeBlock } from '../../db/schema';

// Scoped by itemId (the parent item's workspace membership is checked upstream by
// `loadItem`). Order follows LRCUD.

export const listItemOccurrences = (itemId: number): Promise<ItemOccurrence[]> =>
  db.select().from(itemOccurrence).where(eq(itemOccurrence.itemId, itemId));

// A materialized occurrence with the current user's blocks on it (brief §3.1).
export interface ItemMoment {
  occurrence: ItemOccurrence;
  timeBlocks: TimeBlock[];
}

// All materialized moments of a task: every occurrence row + the user's timeBlocks,
// grouped. Virtual future slots are not included (they have no row).
export const listItemMoments = async (itemId: number, userId: number): Promise<ItemMoment[]> => {
  const occurrences = await db.select().from(itemOccurrence).where(eq(itemOccurrence.itemId, itemId));
  const blockRows = await db
    .select({ block: timeBlock })
    .from(timeBlock)
    .innerJoin(itemOccurrence, eq(timeBlock.itemOccurrenceId, itemOccurrence.idItemOccurrence))
    .where(and(eq(itemOccurrence.itemId, itemId), eq(timeBlock.userId, userId)));

  const blocksByOccurrence = new Map<number, TimeBlock[]>();
  for (const { block } of blockRows) {
    const list = blocksByOccurrence.get(block.itemOccurrenceId) ?? [];
    list.push(block);
    blocksByOccurrence.set(block.itemOccurrenceId, list);
  }
  return occurrences.map((occurrence) => ({
    occurrence,
    timeBlocks: blocksByOccurrence.get(occurrence.idItemOccurrence) ?? [],
  }));
};

export const readItemOccurrence = async (itemId: number, idItemOccurrence: number): Promise<ItemOccurrence | undefined> => {
  const [row] = await db
    .select()
    .from(itemOccurrence)
    .where(and(eq(itemOccurrence.itemId, itemId), eq(itemOccurrence.idItemOccurrence, idItemOccurrence)))
    .limit(1);
  return row;
};

export const createItemOccurrence = (
  itemId: number,
  userId: number,
  input: CreateItemOccurrenceInput,
): Promise<ItemOccurrence> =>
  db.transaction(async (transaction) => {
    const [{ idItemOccurrence }] = await transaction
      .insert(itemOccurrence)
      .values({
        itemId,
        occurrenceDate: input.occurrenceDate,
        status: input.status,
        dueDate: input.dueDate,
        createdBy: userId,
        updatedBy: userId,
      })
      .$returningId();

    const [row] = await transaction
      .select()
      .from(itemOccurrence)
      .where(eq(itemOccurrence.idItemOccurrence, idItemOccurrence))
      .limit(1);
    return row;
  });

export const updateItemOccurrence = (
  itemId: number,
  userId: number,
  idItemOccurrence: number,
  input: UpdateItemOccurrenceInput,
): Promise<ItemOccurrence | undefined> =>
  db.transaction(async (transaction) => {
    await transaction
      .update(itemOccurrence)
      .set({ ...input, updatedBy: userId })
      .where(and(eq(itemOccurrence.itemId, itemId), eq(itemOccurrence.idItemOccurrence, idItemOccurrence)));

    const [row] = await transaction
      .select()
      .from(itemOccurrence)
      .where(and(eq(itemOccurrence.itemId, itemId), eq(itemOccurrence.idItemOccurrence, idItemOccurrence)))
      .limit(1);
    return row;
  });

export const deleteItemOccurrence = async (itemId: number, idItemOccurrence: number): Promise<boolean> => {
  const [result] = await db
    .delete(itemOccurrence)
    .where(and(eq(itemOccurrence.itemId, itemId), eq(itemOccurrence.idItemOccurrence, idItemOccurrence)));
  return result.affectedRows > 0;
};
