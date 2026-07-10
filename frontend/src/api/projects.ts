import type { CreateProjectInput, ProjectDto, UpdateProjectInput } from '@ticktaskdone/shared';
import { workspaceId } from '@/config';
import { api } from './client';

export const listProjects = (): Promise<ProjectDto[]> =>
  api.get<ProjectDto[]>(`/workspaces/${workspaceId}/projects`);

export const createProject = (input: CreateProjectInput): Promise<ProjectDto> =>
  api.post<ProjectDto>(`/workspaces/${workspaceId}/projects`, input);

export const updateProject = (idProject: number, input: UpdateProjectInput): Promise<ProjectDto> =>
  api.patch<ProjectDto>(`/workspaces/${workspaceId}/projects/${idProject}`, input);

export const deleteProject = (idProject: number): Promise<void> =>
  api.delete<void>(`/workspaces/${workspaceId}/projects/${idProject}`);
