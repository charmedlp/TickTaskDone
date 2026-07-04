import type { ProjectDto } from '@ticktaskdone/shared';
import type { Project } from '../../db/schema';

export const toProjectDto = (row: Project): ProjectDto => ({
  idProject: row.idProject,
  workspaceId: row.workspaceId,
  parentProjectId: row.parentProjectId,
  name: row.name,
  color: row.color,
  income: Number(row.income),
  status: row.status,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});
