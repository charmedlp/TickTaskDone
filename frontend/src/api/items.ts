import type { ItemDto, UpdateItemInput } from '@ticktaskdone/shared';
import { workspaceId } from '@/config';
import { api } from './client';

export const listItems = (): Promise<ItemDto[]> => api.get<ItemDto[]>(`/workspaces/${workspaceId}/items`);

export const fetchItem = (idItem: number): Promise<ItemDto> =>
  api.get<ItemDto>(`/workspaces/${workspaceId}/items/${idItem}`);

export const updateItem = (idItem: number, input: UpdateItemInput): Promise<ItemDto> =>
  api.patch<ItemDto>(`/workspaces/${workspaceId}/items/${idItem}`, input);

export const deleteItem = (idItem: number): Promise<void> =>
  api.delete<void>(`/workspaces/${workspaceId}/items/${idItem}`);
