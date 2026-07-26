import type { BacklogTaskDto } from '@ticktaskdone/shared';
import { workspaceId } from '@/config';
import { api } from './client';

// Unscheduled non-recurrent tasks (no timeBlock) for the current user.
export const fetchBacklog = (): Promise<BacklogTaskDto[]> =>
  api.get<BacklogTaskDto[]>(`/workspaces/${workspaceId}/backlog`);

// Recurring tasks with no occurrence in [from, to] — draggable to add one here.
export const fetchRecurringUnplanned = (from: Date, to: Date): Promise<BacklogTaskDto[]> =>
  api.get<BacklogTaskDto[]>(
    `/workspaces/${workspaceId}/backlog/recurring?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`,
  );
