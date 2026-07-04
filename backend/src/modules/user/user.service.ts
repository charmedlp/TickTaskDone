import { db } from '../../db/db';
import { user, workspace, workspaceUser, project } from '../../db/schema';

// Creates a user together with their personal workspace and default project.
// Runs in a single transaction so the account is never left half-created.
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

    // Default project hosting unscheduled / ephemeral tasks (the backlog).
    await transaction
      .insert(project)
      .values({ workspaceId: idWorkspace, name: 'Task List', color: '#808080', createdBy: idUser, updatedBy: idUser });

    return { idUser, idWorkspace };
  });