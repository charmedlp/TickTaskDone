import type { RequestHandler } from 'express';
import { AppError } from '../http/errors';

// Reads `:workspaceId` from the URL, checks the current user is a member, and
// exposes it as `request.workspaceId` for the scoped modules. A non-member gets
// 404 (not 403) so the API never reveals that a workspace exists.
export const scopeWorkspace: RequestHandler = (request, _response, next) => {
  const workspaceId = Number(request.params.workspaceId);
  if (!Number.isInteger(workspaceId) || workspaceId <= 0) {
    return next(new AppError(400, 'Invalid workspace id.'));
  }
  if (!request.currentUser.workspaceIds.includes(workspaceId)) {
    return next(new AppError(404, 'Workspace not found.'));
  }
  request.workspaceId = workspaceId;
  next();
};
