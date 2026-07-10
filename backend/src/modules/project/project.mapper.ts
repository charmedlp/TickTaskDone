import type { ProjectDto } from '@ticktaskdone/shared';
import type { ProjectWithCategories } from './project.service';

export const toProjectDto = ({ project, categoryIds }: ProjectWithCategories): ProjectDto => ({
  idProject: project.idProject,
  workspaceId: project.workspaceId,
  parentProjectId: project.parentProjectId,
  name: project.name,
  color: project.color,
  income: Number(project.income),
  status: project.status,
  categoryIds,
  createdAt: project.createdAt.toISOString(),
  updatedAt: project.updatedAt.toISOString(),
});
