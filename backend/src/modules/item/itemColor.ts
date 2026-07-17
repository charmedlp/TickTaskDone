import { eq } from 'drizzle-orm';
import { type ColorNode, lineageColor, resolveColor } from '@ticktaskdone/shared';
import { db } from '../../db/db';
import { category, item, itemCategory, project } from '../../db/schema';

// Everything needed to resolve an item's effective color under the full cascade
// (guide §7): item.color (custom) -> effective project color (nearest colored ancestor
// project) -> effective color of the FIRST category (smallest idItemCategory; nearest
// colored ancestor category) -> default. Both hierarchies are rebuilt in memory once
// per request so resolution is dynamic — nothing is copied onto the item.
export interface ColorContext {
  projectColors: Map<number, ColorNode>;
  categoryColors: Map<number, ColorNode>;
  firstCategoryByItem: Map<number, number>; // itemId -> primary (first-added) category id
}

export const loadColorContext = async (workspaceId: number): Promise<ColorContext> => {
  const [projects, categories, links] = await Promise.all([
    db
      .select({ id: project.idProject, parentId: project.parentProjectId, color: project.color })
      .from(project)
      .where(eq(project.workspaceId, workspaceId)),
    db
      .select({ id: category.idCategory, parentId: category.parentCategoryId, color: category.color })
      .from(category)
      .where(eq(category.workspaceId, workspaceId)),
    // The primary category is the first tag added = smallest idItemCategory, so order
    // by it and keep the first link seen per item.
    db
      .select({ itemId: itemCategory.itemId, categoryId: itemCategory.categoryId })
      .from(itemCategory)
      .innerJoin(item, eq(itemCategory.itemId, item.idItem))
      .where(eq(item.workspaceId, workspaceId))
      .orderBy(itemCategory.idItemCategory),
  ]);

  const projectColors = new Map<number, ColorNode>(projects.map((row) => [row.id, { parentId: row.parentId, color: row.color }]));
  const categoryColors = new Map<number, ColorNode>(categories.map((row) => [row.id, { parentId: row.parentId, color: row.color }]));
  const firstCategoryByItem = new Map<number, number>();
  for (const link of links) {
    if (!firstCategoryByItem.has(link.itemId)) {
      firstCategoryByItem.set(link.itemId, link.categoryId);
    }
  }
  return { projectColors, categoryColors, firstCategoryByItem };
};

// The effective color of an item under the full cascade. `item` needs only its id,
// own color and projectId — every hierarchy walk uses the preloaded context.
export const resolveItemColor = (
  target: { idItem: number; color: string | null; projectId: number | null },
  context: ColorContext,
): string => {
  const projectColor = lineageColor(target.projectId, context.projectColors);
  const firstCategory = context.firstCategoryByItem.get(target.idItem) ?? null;
  const categoryColor = lineageColor(firstCategory, context.categoryColors);
  return resolveColor(target.color, projectColor, categoryColor);
};
