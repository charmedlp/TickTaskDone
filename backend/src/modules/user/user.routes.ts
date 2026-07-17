import { Router } from 'express';
import { updateUserInput } from '@ticktaskdone/shared';
import { asyncHandler } from '../../middleware/errorHandler';
import { validateBody } from '../../middleware/validate';
import * as userService from './user.service';
import { toUserDto } from './user.mapper';

// Mounted at /me, behind the currentUser middleware (request.currentUser is set).
// Not workspace-scoped: this is about the authenticated identity itself.
export const userRouter = Router();

// The authenticated user (the frontend reads `locale` at startup — i18n brief §2.3).
userRouter.get(
  '/',
  asyncHandler(async (request, response) => {
    const row = await userService.readUser(request.currentUser.idUser);
    response.json(toUserDto(row));
  }),
);

// Update the current user's preferences (locale only, for now).
userRouter.patch(
  '/',
  validateBody(updateUserInput),
  asyncHandler(async (request, response) => {
    const row = await userService.updateUser(request.currentUser.idUser, request.body);
    response.json(toUserDto(row));
  }),
);
