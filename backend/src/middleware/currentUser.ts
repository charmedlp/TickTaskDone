import { eq } from 'drizzle-orm';
import type { RequestHandler } from 'express';
import { db } from '../db/db';
import { user, workspaceUser } from '../db/schema';
import { AppError } from '../http/errors';

// The authenticated identity attached to every request. Definitional queries are
// scoped to `workspaceIds`; personal scheduling (Phase 5) will use `idUser`.
export interface CurrentUser {
  idUser: number;
  workspaceIds: number[];
}

// TEMPORARY (Phase 2): resolves a hard-coded development user seeded by
// `createUserWithDefaults` (run `npm run db:seed`). Phase 10 replaces this with
// real authentication; nothing else in the codebase depends on how the identity
// is obtained — only on `request.currentUser`.
const developmentUserEmail = process.env.DEV_USER_EMAIL ?? 'dev@ticktaskdone.local';

export const currentUser: RequestHandler = (request, _response, next) => {
  db.transaction(async (transaction) => {
    const [account] = await transaction
      .select({ idUser: user.idUser })
      .from(user)
      .where(eq(user.email, developmentUserEmail))
      .limit(1);

    if (!account) {
      throw new AppError(500, 'Development user not found. Run `npm run db:seed`.');
    }

    const memberships = await transaction
      .select({ workspaceId: workspaceUser.workspaceId })
      .from(workspaceUser)
      .where(eq(workspaceUser.userId, account.idUser));

    request.currentUser = {
      idUser: account.idUser,
      workspaceIds: memberships.map((membership) => membership.workspaceId),
    };
  })
    .then(() => next())
    .catch(next);
};
