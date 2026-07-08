import type { CreateTimeLogInput, TimeLogDto, UpdateTimeLogInput } from '@ticktaskdone/shared';
import { workspaceId } from '@/config';
import { api } from './client';

export const createTimeLog = (input: CreateTimeLogInput): Promise<TimeLogDto> =>
  api.post<TimeLogDto>(`/workspaces/${workspaceId}/timelogs`, input);

export const updateTimeLog = (idTimeLog: number, input: UpdateTimeLogInput): Promise<TimeLogDto> =>
  api.patch<TimeLogDto>(`/workspaces/${workspaceId}/timelogs/${idTimeLog}`, input);

export const deleteTimeLog = (idTimeLog: number): Promise<void> =>
  api.delete<void>(`/workspaces/${workspaceId}/timelogs/${idTimeLog}`);
