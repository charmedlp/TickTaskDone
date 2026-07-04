import { and, eq } from 'drizzle-orm';
import type { CreateCategoryInput, UpdateCategoryInput } from '@ticktaskdone/shared';
import { db } from '../../db/db';
import { category, type Category } from '../../db/schema';

// Every operation is scoped by workspaceId so a caller can never reach another
// tenant's rows, even by guessing an id. Order follows LRCUD.

export const listCategories = (workspaceId: number): Promise<Category[]> =>
  db.select().from(category).where(eq(category.workspaceId, workspaceId));

export const readCategory = async (workspaceId: number, idCategory: number): Promise<Category | undefined> => {
  const [row] = await db
    .select()
    .from(category)
    .where(and(eq(category.workspaceId, workspaceId), eq(category.idCategory, idCategory)))
    .limit(1);
  return row;
};

export const createCategory = (workspaceId: number, userId: number, input: CreateCategoryInput): Promise<Category> =>
  db.transaction(async (transaction) => {
    const [{ idCategory }] = await transaction
      .insert(category)
      .values({
        workspaceId,
        parentCategoryId: input.parentCategoryId,
        name: input.name,
        color: input.color,
        createdBy: userId,
        updatedBy: userId,
      })
      .$returningId();

    const [row] = await transaction.select().from(category).where(eq(category.idCategory, idCategory)).limit(1);
    return row;
  });

export const updateCategory = (
  workspaceId: number,
  userId: number,
  idCategory: number,
  input: UpdateCategoryInput,
): Promise<Category | undefined> =>
  db.transaction(async (transaction) => {
    await transaction
      .update(category)
      .set({ ...input, updatedBy: userId })
      .where(and(eq(category.workspaceId, workspaceId), eq(category.idCategory, idCategory)));

    // Re-read within the transaction: absent row means it did not exist (404).
    const [row] = await transaction
      .select()
      .from(category)
      .where(and(eq(category.workspaceId, workspaceId), eq(category.idCategory, idCategory)))
      .limit(1);
    return row;
  });

export const deleteCategory = async (workspaceId: number, idCategory: number): Promise<boolean> => {
  const [result] = await db
    .delete(category)
    .where(and(eq(category.workspaceId, workspaceId), eq(category.idCategory, idCategory)));
  return result.affectedRows > 0;
};
