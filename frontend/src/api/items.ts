import type {
  CreateItemInput,
  ItemDto,
  PlannedMomentsPageDto,
  TaskSummaryDto,
  UpdateItemInput,
} from '@ticktaskdone/shared';
import { workspaceId } from '@/config';
import { api } from './client';

export const listItems = (): Promise<ItemDto[]> => api.get<ItemDto[]>(`/workspaces/${workspaceId}/items`);

export const createItem = (input: CreateItemInput): Promise<ItemDto> =>
  api.post<ItemDto>(`/workspaces/${workspaceId}/items`, input);

// Per-task rollups (status / due / planned / hours) for the Projects view.
export const fetchTaskSummaries = (): Promise<TaskSummaryDto[]> =>
  api.get<TaskSummaryDto[]>(`/workspaces/${workspaceId}/items/summaries`);

// One cursor-paginated page of a task's planned moments (occurrences + the user's
// timeBlocks). `direction`/`cursor` navigate a potentially-infinite recurrent series.
export const fetchItemMoments = (
  idItem: number,
  page: { direction: 'start' | 'upcoming' | 'next' | 'prev'; cursor: string | null } = {
    direction: 'start',
    cursor: null,
  },
): Promise<PlannedMomentsPageDto> => {
  const query = new URLSearchParams({ direction: page.direction });
  if (page.cursor !== null) {
    query.set('cursor', page.cursor);
  }
  return api.get<PlannedMomentsPageDto>(
    `/workspaces/${workspaceId}/items/${idItem}/occurrences/moments?${query.toString()}`,
  );
};

export const fetchItem = (idItem: number): Promise<ItemDto> =>
  api.get<ItemDto>(`/workspaces/${workspaceId}/items/${idItem}`);

export const updateItem = (idItem: number, input: UpdateItemInput): Promise<ItemDto> =>
  api.patch<ItemDto>(`/workspaces/${workspaceId}/items/${idItem}`, input);

export const deleteItem = (idItem: number): Promise<void> =>
  api.delete<void>(`/workspaces/${workspaceId}/items/${idItem}`);

// Turn a task recurring (§3.2 A/B) — its blocks become the recurring occurrences.
// An explicit anchor (recurrenceStart + timezone) overrides the block-derived one.
export const enableRecurrence = (
  idItem: number,
  input: { rrule: string; recurrenceStart?: Date; timezone?: string },
): Promise<void> => api.post<void>(`/workspaces/${workspaceId}/items/${idItem}/recurrence`, input);

// Remove recurrence (§3.2 C) — the task splits into N separate tasks. Returns N.
export const removeRecurrence = (idItem: number): Promise<{ tasks: number }> =>
  api.delete<{ tasks: number }>(`/workspaces/${workspaceId}/items/${idItem}/recurrence`);
