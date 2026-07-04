import { Router } from 'express';
import { createCategoryInput, updateCategoryInput } from '@ticktaskdone/shared';
import { asyncHandler } from '../../middleware/errorHandler';
import { validateBody } from '../../middleware/validate';
import { notFound } from '../../http/errors';
import { parseId } from '../../http/params';
import * as categoryService from './category.service';
import { toCategoryDto } from './category.mapper';

// Mounted under /workspaces/:workspaceId/categories — request.workspaceId is set.
// mergeParams lets this router read the parent :workspaceId route parameter.
export const categoryRouter = Router({ mergeParams: true });

// List
categoryRouter.get(
  '/',
  asyncHandler(async (request, response) => {
    const rows = await categoryService.listCategories(request.workspaceId);
    response.json(rows.map(toCategoryDto));
  }),
);

// Read
categoryRouter.get(
  '/:idCategory',
  asyncHandler(async (request, response) => {
    const row = await categoryService.readCategory(request.workspaceId, parseId(request.params.idCategory, 'category id'));
    if (!row) throw notFound('Category');
    response.json(toCategoryDto(row));
  }),
);

// Create
categoryRouter.post(
  '/',
  validateBody(createCategoryInput),
  asyncHandler(async (request, response) => {
    const row = await categoryService.createCategory(request.workspaceId, request.currentUser.idUser, request.body);
    response.status(201).json(toCategoryDto(row));
  }),
);

// Update
categoryRouter.patch(
  '/:idCategory',
  validateBody(updateCategoryInput),
  asyncHandler(async (request, response) => {
    const row = await categoryService.updateCategory(
      request.workspaceId,
      request.currentUser.idUser,
      parseId(request.params.idCategory, 'category id'),
      request.body,
    );
    if (!row) throw notFound('Category');
    response.json(toCategoryDto(row));
  }),
);

// Delete
categoryRouter.delete(
  '/:idCategory',
  asyncHandler(async (request, response) => {
    const deleted = await categoryService.deleteCategory(request.workspaceId, parseId(request.params.idCategory, 'category id'));
    if (!deleted) throw notFound('Category');
    response.status(204).send();
  }),
);
