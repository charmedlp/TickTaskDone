import { and, eq } from 'drizzle-orm';
import type { CreateProjectInput, UpdateProjectInput } from '@ticktaskdone/shared';
import { db } from '../../db/db';
import { project, type Project } from '../../db/schema';

// Every operation is scoped by workspaceId. Order follows LRCUD.
// `income` is a DB decimal (string); the input carries a number, so it is
// converted at the boundary.

export const listProjects = (workspaceId: number): Promise<Project[]> =>
  db.select().from(project).where(eq(project.workspaceId, workspaceId));

export const readProject = async (workspaceId: number, idProject: number): Promise<Project | undefined> => {
  const [row] = await db
    .select()
    .from(project)
    .where(and(eq(project.workspaceId, workspaceId), eq(project.idProject, idProject)))
    .limit(1);
  return row;
};

export const createProject = (workspaceId: number, userId: number, input: CreateProjectInput): Promise<Project> =>
  db.transaction(async (transaction) => {
    const [{ idProject }] = await transaction
      .insert(project)
      .values({
        workspaceId,
        parentProjectId: input.parentProjectId,
        name: input.name,
        color: input.color,
        income: input.income?.toFixed(2),
        status: input.status,
        createdBy: userId,
        updatedBy: userId,
      })
      .$returningId();

    const [row] = await transaction.select().from(project).where(eq(project.idProject, idProject)).limit(1);
    return row;
  });

export const updateProject = (
  workspaceId: number,
  userId: number,
  idProject: number,
  input: UpdateProjectInput,
): Promise<Project | undefined> =>
  db.transaction(async (transaction) => {
    // Spread only the keys the client sent (Zod partial omits the rest), so an
    // absent field is never overwritten. `income` is converted to the DB decimal.
    const { income, ...rest } = input;
    await transaction
      .update(project)
      .set({ ...rest, ...(income === undefined ? {} : { income: income.toFixed(2) }), updatedBy: userId })
      .where(and(eq(project.workspaceId, workspaceId), eq(project.idProject, idProject)));

    const [row] = await transaction
      .select()
      .from(project)
      .where(and(eq(project.workspaceId, workspaceId), eq(project.idProject, idProject)))
      .limit(1);
    return row;
  });

export const deleteProject = async (workspaceId: number, idProject: number): Promise<boolean> => {
  const [result] = await db
    .delete(project)
    .where(and(eq(project.workspaceId, workspaceId), eq(project.idProject, idProject)));
  return result.affectedRows > 0;
};
