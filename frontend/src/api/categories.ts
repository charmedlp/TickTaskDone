import type { CategoryDto, CreateCategoryInput } from '@ticktaskdone/shared';
import { workspaceId } from '@/config';
import { api } from './client';

export const listCategories = (): Promise<CategoryDto[]> =>
  api.get<CategoryDto[]>(`/workspaces/${workspaceId}/categories`);

export const createCategory = (input: CreateCategoryInput): Promise<CategoryDto> =>
  api.post<CategoryDto>(`/workspaces/${workspaceId}/categories`, input);
