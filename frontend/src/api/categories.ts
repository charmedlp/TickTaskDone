import type { CategoryDto, CreateCategoryInput, UpdateCategoryInput } from '@ticktaskdone/shared';
import { workspaceId } from '@/config';
import { api } from './client';

export const listCategories = (): Promise<CategoryDto[]> =>
  api.get<CategoryDto[]>(`/workspaces/${workspaceId}/categories`);

export const createCategory = (input: CreateCategoryInput): Promise<CategoryDto> =>
  api.post<CategoryDto>(`/workspaces/${workspaceId}/categories`, input);

// Rename / recolor / re-parent (move). The DB trigger guards against cycles.
export const updateCategory = (idCategory: number, input: UpdateCategoryInput): Promise<CategoryDto> =>
  api.patch<CategoryDto>(`/workspaces/${workspaceId}/categories/${idCategory}`, input);

// Delete: assignments cascade off; children are re-parented to the root by the DB.
export const deleteCategory = (idCategory: number): Promise<void> =>
  api.delete<void>(`/workspaces/${workspaceId}/categories/${idCategory}`);
