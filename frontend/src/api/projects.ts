import type { ProjectDto } from '@ticktaskdone/shared';
import { workspaceId } from '@/config';
import { api } from './client';

export const listProjects = (): Promise<ProjectDto[]> =>
  api.get<ProjectDto[]>(`/workspaces/${workspaceId}/projects`);
