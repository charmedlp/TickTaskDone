import { and, eq, inArray } from 'drizzle-orm';
import { db, type Transaction } from '../../db/db';
import { category, itemCategory } from '../../db/schema';
import { AppError } from '../../http/errors';

// itemCategory helpers, reused by the item create/update transactions. Only the
// chosen leaves are stored (brief §2); ancestors are deduced client-side.

// Validates every category belongs to the workspace (the DB same-workspace trigger
// is the final backstop, but the Constitution requires an app-level check too).
export const assertCategoriesInWorkspace = async (workspaceId: number, categoryIds: number[]): Promise<void> => {
  const unique = [...new Set(categoryIds)];
  if (unique.length === 0) {
    return;
  }
  const valid = await db
    .select({ idCategory: category.idCategory })
    .from(category)
    .where(and(eq(category.workspaceId, workspaceId), inArray(category.idCategory, unique)));
  if (valid.length !== unique.length) {
    throw new AppError(400, 'CATEGORIES_WRONG_WORKSPACE');
  }
};

// Replaces an item's category links inside an existing transaction.
export const replaceItemCategories = async (
  transaction: Transaction,
  userId: number,
  itemId: number,
  categoryIds: number[],
): Promise<void> => {
  await transaction.delete(itemCategory).where(eq(itemCategory.itemId, itemId));
  const unique = [...new Set(categoryIds)];
  if (unique.length > 0) {
    await transaction.insert(itemCategory).values(unique.map((categoryId) => ({ itemId, categoryId, createdBy: userId })));
  }
};

// Ordered by idItemCategory so the first id is the primary (first-added) category —
// the one that feeds the color cascade (guide §7).
export const categoryIdsForItem = async (itemId: number): Promise<number[]> => {
  const rows = await db
    .select({ categoryId: itemCategory.categoryId })
    .from(itemCategory)
    .where(eq(itemCategory.itemId, itemId))
    .orderBy(itemCategory.idItemCategory);
  return rows.map((row) => row.categoryId);
};

// One grouped query for a set of items (no N+1 — Constitution). Ordered by
// idItemCategory so each list stays primary-first.
export const categoryIdsByItem = async (itemIds: number[]): Promise<Map<number, number[]>> => {
  const grouped = new Map<number, number[]>();
  if (itemIds.length === 0) {
    return grouped;
  }
  const rows = await db
    .select({ itemId: itemCategory.itemId, categoryId: itemCategory.categoryId })
    .from(itemCategory)
    .where(inArray(itemCategory.itemId, itemIds))
    .orderBy(itemCategory.idItemCategory);
  for (const row of rows) {
    const list = grouped.get(row.itemId) ?? [];
    list.push(row.categoryId);
    grouped.set(row.itemId, list);
  }
  return grouped;
};
