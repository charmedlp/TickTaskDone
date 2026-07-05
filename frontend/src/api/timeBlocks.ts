import type { CreateTimeBlockInput, TimeBlockDto, UpdateTimeBlockInput } from '@ticktaskdone/shared';
import { workspaceId } from '@/config';
import { api } from './client';

export const createTimeBlock = (input: CreateTimeBlockInput): Promise<TimeBlockDto> =>
  api.post<TimeBlockDto>(`/workspaces/${workspaceId}/timeblocks`, input);

export const updateTimeBlock = (idTimeBlock: number, input: UpdateTimeBlockInput): Promise<TimeBlockDto> =>
  api.patch<TimeBlockDto>(`/workspaces/${workspaceId}/timeblocks/${idTimeBlock}`, input);

export const deleteTimeBlock = (idTimeBlock: number): Promise<void> =>
  api.delete<void>(`/workspaces/${workspaceId}/timeblocks/${idTimeBlock}`);
