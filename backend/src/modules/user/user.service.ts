import { eq } from 'drizzle-orm';
import type { UpdateUserInput } from '@ticktaskdone/shared';
import { db } from '../../db/db';
import { user, workspace, workspaceUser, type User } from '../../db/schema';
import { notFound } from '../../http/errors';

// Creates a user together with their personal workspace and owner membership.
// Runs in a single transaction so the account is never left half-created. There is
// NO default "Task List" project: tasks with projectId = null are the backlog, a
// purely virtual grouping surfaced at render time (see Task List brief §1).
export const createUserWithDefaults = async (
  email: string,
): Promise<{ idUser: number; idWorkspace: number }> =>
  db.transaction(async (transaction) => {
    const [{ idUser }] = await transaction.insert(user).values({ email }).$returningId();

    const [{ idWorkspace }] = await transaction
      .insert(workspace)
      .values({ name: 'Personal', createdBy: idUser, updatedBy: idUser })
      .$returningId();

    await transaction
      .insert(workspaceUser)
      .values({ workspaceId: idWorkspace, userId: idUser, role: 'owner', createdBy: idUser, updatedBy: idUser });

    return { idUser, idWorkspace };
  });

export const readUser = async (idUser: number): Promise<User> => {
  const [row] = await db.select().from(user).where(eq(user.idUser, idUser)).limit(1);
  if (!row) {
    throw notFound('User');
  }
  return row;
};

export const updateUser = async (idUser: number, input: UpdateUserInput): Promise<User> => {
  await db.update(user).set({ locale: input.locale }).where(eq(user.idUser, idUser));
  return readUser(idUser);
};