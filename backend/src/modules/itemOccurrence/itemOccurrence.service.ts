import { and, eq } from 'drizzle-orm';
import type { CreateItemOccurrenceInput, UpdateItemOccurrenceInput } from '@ticktaskdone/shared';
import { db } from '../../db/db';
import { itemOccurrence, type ItemOccurrence } from '../../db/schema';

// Scoped by itemId (the parent item's workspace membership is checked upstream by
// `loadItem`). Order follows LRCUD.

export const listItemOccurrences = (itemId: number): Promise<ItemOccurrence[]> =>
  db.select().from(itemOccurrence).where(eq(itemOccurrence.itemId, itemId));

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
