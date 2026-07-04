import { Router } from 'express';
import { createProjectInput, updateProjectInput } from '@ticktaskdone/shared';
import { asyncHandler } from '../../middleware/errorHandler';
import { validateBody } from '../../middleware/validate';
import { notFound } from '../../http/errors';
import { parseId } from '../../http/params';
import * as projectService from './project.service';
import { toProjectDto } from './project.mapper';

// Mounted under /workspaces/:workspaceId/projects — request.workspaceId is set.
export const projectRouter = Router({ mergeParams: true });

// List
projectRouter.get(
  '/',
  asyncHandler(async (request, response) => {
    const rows = await projectService.listProjects(request.workspaceId);
    response.json(rows.map(toProjectDto));
  }),
);

// Read
projectRouter.get(
  '/:idProject',
  asyncHandler(async (request, response) => {
    const row = await projectService.readProject(request.workspaceId, parseId(request.params.idProject, 'project id'));
    if (!row) throw notFound('Project');
    response.json(toProjectDto(row));
  }),
);

// Create
projectRouter.post(
  '/',
  validateBody(createProjectInput),
  asyncHandler(async (request, response) => {
    const row = await projectService.createProject(request.workspaceId, request.currentUser.idUser, request.body);
    response.status(201).json(toProjectDto(row));
  }),
);

// Update
projectRouter.patch(
  '/:idProject',
  validateBody(updateProjectInput),
  asyncHandler(async (request, response) => {
    const row = await projectService.updateProject(
      request.workspaceId,
      request.currentUser.idUser,
      parseId(request.params.idProject, 'project id'),
      request.body,
    );
    if (!row) throw notFound('Project');
    response.json(toProjectDto(row));
  }),
);

// Delete
projectRouter.delete(
  '/:idProject',
  asyncHandler(async (request, response) => {
    const deleted = await projectService.deleteProject(request.workspaceId, parseId(request.params.idProject, 'project id'));
    if (!deleted) throw notFound('Project');
    response.status(204).send();
  }),
);
