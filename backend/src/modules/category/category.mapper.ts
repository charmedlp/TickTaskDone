import type { CategoryDto } from '@ticktaskdone/shared';
import type { Category } from '../../db/schema';

export const toCategoryDto = (row: Category): CategoryDto => ({
  idCategory: row.idCategory,
  workspaceId: row.workspaceId,
  parentCategoryId: row.parentCategoryId,
  name: row.name,
  color: row.color,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});
