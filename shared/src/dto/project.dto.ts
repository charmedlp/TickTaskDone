import type { ProjectStatus } from '../validation/project.validation';

// API contract for a project. `income` is a number (the DB decimal is serialized).
export interface ProjectDto {
  idProject: number;
  workspaceId: number;
  parentProjectId: number | null;
  name: string;
  color: string;
  income: number;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
}
