import type { BacklogTaskDto } from '@ticktaskdone/shared';
import { workspaceId } from '@/config';
import { api } from './client';

// Unscheduled non-recurrent tasks (no timeBlock) for the current user.
export const fetchBacklog = (): Promise<BacklogTaskDto[]> =>
  api.get<BacklogTaskDto[]>(`/workspaces/${workspaceId}/backlog`);
