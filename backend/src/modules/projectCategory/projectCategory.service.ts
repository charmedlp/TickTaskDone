import { eq, inArray } from 'drizzle-orm';
import { db, type Transaction } from '../../db/db';
import { projectCategory } from '../../db/schema';

// projectCategory helpers (mirror itemCategory): a project stores only the chosen
// category LEAVES (brief §2/§5); ancestors are deduced client-side. Same-workspace
// validity is checked with `assertCategoriesInWorkspace` (shared with items).

export const replaceProjectCategories = async (
  transaction: Transaction,
  userId: number,
  projectId: number,
  categoryIds: number[],
): Promise<void> => {
  await transaction.delete(projectCategory).where(eq(projectCategory.projectId, projectId));
  const unique = [...new Set(categoryIds)];
  if (unique.length > 0) {
    await transaction.insert(projectCategory).values(unique.map((categoryId) => ({ projectId, categoryId, createdBy: userId })));
  }
};

export const categoryIdsForProject = async (projectId: number): Promise<number[]> => {
  const rows = await db
    .select({ categoryId: projectCategory.categoryId })
    .from(projectCategory)
    .where(eq(projectCategory.projectId, projectId));
  return rows.map((row) => row.categoryId);
};

// One grouped query for a set of projects (no N+1 — Constitution).
export const categoryIdsByProject = async (projectIds: number[]): Promise<Map<number, number[]>> => {
  const grouped = new Map<number, number[]>();
  if (projectIds.length === 0) {
    return grouped;
  }
  const rows = await db
    .select({ projectId: projectCategory.projectId, categoryId: projectCategory.categoryId })
    .from(projectCategory)
    .where(inArray(projectCategory.projectId, projectIds));
  for (const row of rows) {
    const list = grouped.get(row.projectId) ?? [];
    list.push(row.categoryId);
    grouped.set(row.projectId, list);
  }
  return grouped;
};
