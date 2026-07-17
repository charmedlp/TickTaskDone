import { and, eq } from 'drizzle-orm';
import type { CreateItemInput, UpdateItemInput } from '@ticktaskdone/shared';
import { db } from '../../db/db';
import { item, itemCategory, type Item } from '../../db/schema';
import { AppError } from '../../http/errors';
import {
  assertCategoriesInWorkspace,
  categoryIdsByItem,
  categoryIdsForItem,
  replaceItemCategories,
} from '../itemCategory/itemCategory.service';
import { loadColorContext, resolveItemColor } from './itemColor';

// An item plus its fully-resolved display color and its stored category leaves.
// `resolvedColor` follows the full cascade (guide §7): item.color -> effective project
// color -> effective first-category color -> default.
export interface ItemWithColor {
  item: Item;
  resolvedColor: string;
  categoryIds: number[];
}

// Every operation is scoped by workspaceId. Order follows LRCUD.

export const listItems = async (workspaceId: number): Promise<ItemWithColor[]> => {
  const rows = await db.select({ item }).from(item).where(eq(item.workspaceId, workspaceId));
  const [byItem, colorContext] = await Promise.all([
    categoryIdsByItem(rows.map((row) => row.item.idItem)),
    loadColorContext(workspaceId),
  ]);
  return rows.map((row) => ({
    item: row.item,
    resolvedColor: resolveItemColor(row.item, colorContext),
    categoryIds: byItem.get(row.item.idItem) ?? [],
  }));
};

export const readItem = async (workspaceId: number, idItem: number): Promise<ItemWithColor | undefined> => {
  const [row] = await db
    .select({ item })
    .from(item)
    .where(and(eq(item.workspaceId, workspaceId), eq(item.idItem, idItem)))
    .limit(1);
  if (!row) {
    return undefined;
  }
  const colorContext = await loadColorContext(workspaceId);
  return {
    item: row.item,
    resolvedColor: resolveItemColor(row.item, colorContext),
    categoryIds: await categoryIdsForItem(row.item.idItem),
  };
};

export const createItem = async (
  workspaceId: number,
  userId: number,
  input: CreateItemInput,
): Promise<ItemWithColor> => {
  await assertCategoriesInWorkspace(workspaceId, input.categoryIds ?? []);

  const created = await db.transaction(async (transaction) => {
    const [{ idItem }] = await transaction
      .insert(item)
      .values({
        workspaceId,
        type: input.type,
        projectId: input.projectId,
        title: input.title,
        description: input.description,
        color: input.color,
        estimatedMinutes: input.estimatedMinutes,
        rrule: input.rrule,
        recurrenceStart: input.recurrenceStart,
        timezone: input.timezone,
        createdBy: userId,
        updatedBy: userId,
      })
      .$returningId();

    await replaceItemCategories(transaction, userId, idItem, input.categoryIds ?? []);

    const [row] = await transaction.select({ item }).from(item).where(eq(item.idItem, idItem)).limit(1);
    return { item: row.item, categoryIds: [...new Set(input.categoryIds ?? [])] };
  });

  // Resolve color AFTER commit: the cascade reads the item's category links, which are
  // only visible to a fresh connection once the transaction has committed.
  const colorContext = await loadColorContext(workspaceId);
  return { ...created, resolvedColor: resolveItemColor(created.item, colorContext) };
};

export const updateItem = async (
  workspaceId: number,
  userId: number,
  idItem: number,
  input: UpdateItemInput,
): Promise<ItemWithColor | undefined> => {
  if (input.categoryIds !== undefined) {
    await assertCategoriesInWorkspace(workspaceId, input.categoryIds);
  }

  const updated = await db.transaction(async (transaction) => {
    const [current] = await transaction
      .select({ rrule: item.rrule, recurrenceStart: item.recurrenceStart })
      .from(item)
      .where(and(eq(item.workspaceId, workspaceId), eq(item.idItem, idItem)))
      .limit(1);
    if (!current) {
      return undefined;
    }

    // categoryIds is not an item column — keep it out of the column update.
    const { categoryIds, ...columns } = input;

    // Recurrence pairing is an invariant of the FINAL row (body merged with what
    // already exists), so validate the merge, not the partial body alone.
    const rrule = 'rrule' in columns ? columns.rrule : current.rrule;
    const recurrenceStart = 'recurrenceStart' in columns ? columns.recurrenceStart : current.recurrenceStart;
    if ((rrule == null) !== (recurrenceStart == null)) {
      throw new AppError(400, 'RRULE_RECURRENCE_MISMATCH');
    }

    await transaction
      .update(item)
      .set({ ...columns, updatedBy: userId })
      .where(and(eq(item.workspaceId, workspaceId), eq(item.idItem, idItem)));

    if (categoryIds !== undefined) {
      await replaceItemCategories(transaction, userId, idItem, categoryIds);
    }

    const [row] = await transaction
      .select({ item })
      .from(item)
      .where(and(eq(item.workspaceId, workspaceId), eq(item.idItem, idItem)))
      .limit(1);
    const finalCategoryIds =
      categoryIds !== undefined
        ? [...new Set(categoryIds)]
        : (
            await transaction
              .select({ categoryId: itemCategory.categoryId })
              .from(itemCategory)
              .where(eq(itemCategory.itemId, idItem))
              .orderBy(itemCategory.idItemCategory)
          ).map((link) => link.categoryId);
    return { item: row.item, categoryIds: finalCategoryIds };
  });

  if (!updated) {
    return undefined;
  }
  // Resolve color AFTER commit so the cascade sees the final category links.
  const colorContext = await loadColorContext(workspaceId);
  return { ...updated, resolvedColor: resolveItemColor(updated.item, colorContext) };
};

export const deleteItem = async (workspaceId: number, idItem: number): Promise<boolean> => {
  const [result] = await db.delete(item).where(and(eq(item.workspaceId, workspaceId), eq(item.idItem, idItem)));
  return result.affectedRows > 0;
};
