import { and, eq } from 'drizzle-orm';
import type { CreateItemInput, UpdateItemInput } from '@ticktaskdone/shared';
import { db } from '../../db/db';
import { item, itemCategory, project, type Item } from '../../db/schema';
import { AppError } from '../../http/errors';
import {
  assertCategoriesInWorkspace,
  categoryIdsByItem,
  categoryIdsForItem,
  replaceItemCategories,
} from '../itemCategory/itemCategory.service';

// An item plus the color of its (optional) project and its stored category leaves.
export interface ItemWithProjectColor {
  item: Item;
  projectColor: string | null;
  categoryIds: number[];
}

// Left join so items without a project still appear (projectColor = null).
const selectWithProjectColor = () =>
  db
    .select({ item, projectColor: project.color })
    .from(item)
    .leftJoin(project, eq(item.projectId, project.idProject));

// Every operation is scoped by workspaceId. Order follows LRCUD.

export const listItems = async (workspaceId: number): Promise<ItemWithProjectColor[]> => {
  const rows = await selectWithProjectColor().where(eq(item.workspaceId, workspaceId));
  const byItem = await categoryIdsByItem(rows.map((row) => row.item.idItem));
  return rows.map((row) => ({ ...row, categoryIds: byItem.get(row.item.idItem) ?? [] }));
};

export const readItem = async (workspaceId: number, idItem: number): Promise<ItemWithProjectColor | undefined> => {
  const [row] = await selectWithProjectColor()
    .where(and(eq(item.workspaceId, workspaceId), eq(item.idItem, idItem)))
    .limit(1);
  return row ? { ...row, categoryIds: await categoryIdsForItem(row.item.idItem) } : undefined;
};

export const createItem = async (
  workspaceId: number,
  userId: number,
  input: CreateItemInput,
): Promise<ItemWithProjectColor> => {
  await assertCategoriesInWorkspace(workspaceId, input.categoryIds ?? []);

  return db.transaction(async (transaction) => {
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
        createdBy: userId,
        updatedBy: userId,
      })
      .$returningId();

    await replaceItemCategories(transaction, userId, idItem, input.categoryIds ?? []);

    const [row] = await transaction
      .select({ item, projectColor: project.color })
      .from(item)
      .leftJoin(project, eq(item.projectId, project.idProject))
      .where(eq(item.idItem, idItem))
      .limit(1);
    return { ...row, categoryIds: [...new Set(input.categoryIds ?? [])] };
  });
};

export const updateItem = async (
  workspaceId: number,
  userId: number,
  idItem: number,
  input: UpdateItemInput,
): Promise<ItemWithProjectColor | undefined> => {
  if (input.categoryIds !== undefined) {
    await assertCategoriesInWorkspace(workspaceId, input.categoryIds);
  }

  return db.transaction(async (transaction) => {
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
      throw new AppError(400, 'rrule and recurrenceStart must both be set or both be null.');
    }

    await transaction
      .update(item)
      .set({ ...columns, updatedBy: userId })
      .where(and(eq(item.workspaceId, workspaceId), eq(item.idItem, idItem)));

    if (categoryIds !== undefined) {
      await replaceItemCategories(transaction, userId, idItem, categoryIds);
    }

    const [row] = await transaction
      .select({ item, projectColor: project.color })
      .from(item)
      .leftJoin(project, eq(item.projectId, project.idProject))
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
          ).map((link) => link.categoryId);
    return { ...row, categoryIds: finalCategoryIds };
  });
};

export const deleteItem = async (workspaceId: number, idItem: number): Promise<boolean> => {
  const [result] = await db.delete(item).where(and(eq(item.workspaceId, workspaceId), eq(item.idItem, idItem)));
  return result.affectedRows > 0;
};
