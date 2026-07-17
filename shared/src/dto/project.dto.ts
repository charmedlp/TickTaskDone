import type { ProjectStatus } from '../validation/project.validation';

// API contract for a project. `income` is a number (the DB decimal is serialized).
export interface ProjectDto {
  idProject: number;
  workspaceId: number;
  parentProjectId: number | null;
  name: string;
  color: string | null; // null = inherits from the nearest colored ancestor (§7)
  income: number;
  status: ProjectStatus;
  categoryIds: number[]; // stored leaves; ancestors are deduced client-side
  createdAt: string;
  updatedAt: string;
}
