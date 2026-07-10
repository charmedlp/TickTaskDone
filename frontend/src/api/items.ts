import type { ItemDto, PlannedMomentDto, TaskSummaryDto, UpdateItemInput } from '@ticktaskdone/shared';
import { workspaceId } from '@/config';
import { api } from './client';

export const listItems = (): Promise<ItemDto[]> => api.get<ItemDto[]>(`/workspaces/${workspaceId}/items`);

// Per-task rollups (status / due / planned / hours) for the Projects view.
export const fetchTaskSummaries = (): Promise<TaskSummaryDto[]> =>
  api.get<TaskSummaryDto[]>(`/workspaces/${workspaceId}/items/summaries`);

// A task's materialized planned moments (occurrences + the user's timeBlocks).
export const fetchItemMoments = (idItem: number): Promise<PlannedMomentDto[]> =>
  api.get<PlannedMomentDto[]>(`/workspaces/${workspaceId}/items/${idItem}/occurrences/moments`);

export const fetchItem = (idItem: number): Promise<ItemDto> =>
  api.get<ItemDto>(`/workspaces/${workspaceId}/items/${idItem}`);

export const updateItem = (idItem: number, input: UpdateItemInput): Promise<ItemDto> =>
  api.patch<ItemDto>(`/workspaces/${workspaceId}/items/${idItem}`, input);

export const deleteItem = (idItem: number): Promise<void> =>
  api.delete<void>(`/workspaces/${workspaceId}/items/${idItem}`);

// Turn a task recurring (§3.2 A/B) — its blocks become the recurring occurrences.
export const enableRecurrence = (idItem: number, rrule: string): Promise<void> =>
  api.post<void>(`/workspaces/${workspaceId}/items/${idItem}/recurrence`, { rrule });

// Remove recurrence (§3.2 C) — the task splits into N separate tasks. Returns N.
export const removeRecurrence = (idItem: number): Promise<{ tasks: number }> =>
  api.delete<{ tasks: number }>(`/workspaces/${workspaceId}/items/${idItem}/recurrence`);
