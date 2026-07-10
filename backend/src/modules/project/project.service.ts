import { and, eq } from 'drizzle-orm';
import type { CreateProjectInput, UpdateProjectInput } from '@ticktaskdone/shared';
import { db } from '../../db/db';
import { project, type Project } from '../../db/schema';
import { assertCategoriesInWorkspace } from '../itemCategory/itemCategory.service';
import {
  categoryIdsByProject,
  categoryIdsForProject,
  replaceProjectCategories,
} from '../projectCategory/projectCategory.service';

// Every operation is scoped by workspaceId. Order follows LRCUD.
// `income` is a DB decimal (string); the input carries a number, so it is
// converted at the boundary.

export interface ProjectWithCategories {
  project: Project;
  categoryIds: number[]; // stored leaves; ancestors are deduced client-side
}

export const listProjects = async (workspaceId: number): Promise<ProjectWithCategories[]> => {
  const rows = await db.select().from(project).where(eq(project.workspaceId, workspaceId));
  const byProject = await categoryIdsByProject(rows.map((row) => row.idProject));
  return rows.map((row) => ({ project: row, categoryIds: byProject.get(row.idProject) ?? [] }));
};

export const readProject = async (
  workspaceId: number,
  idProject: number,
): Promise<ProjectWithCategories | undefined> => {
  const [row] = await db
    .select()
    .from(project)
    .where(and(eq(project.workspaceId, workspaceId), eq(project.idProject, idProject)))
    .limit(1);
  return row ? { project: row, categoryIds: await categoryIdsForProject(idProject) } : undefined;
};

export const createProject = async (
  workspaceId: number,
  userId: number,
  input: CreateProjectInput,
): Promise<ProjectWithCategories> => {
  await assertCategoriesInWorkspace(workspaceId, input.categoryIds ?? []);
  return db.transaction(async (transaction) => {
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

    await replaceProjectCategories(transaction, userId, idProject, input.categoryIds ?? []);

    const [row] = await transaction.select().from(project).where(eq(project.idProject, idProject)).limit(1);
    return { project: row, categoryIds: input.categoryIds ?? [] };
  });
};

export const updateProject = async (
  workspaceId: number,
  userId: number,
  idProject: number,
  input: UpdateProjectInput,
): Promise<ProjectWithCategories | undefined> => {
  if (input.categoryIds !== undefined) {
    await assertCategoriesInWorkspace(workspaceId, input.categoryIds);
  }
  return db.transaction(async (transaction) => {
    // Spread only the keys the client sent (Zod partial omits the rest), so an absent
    // field is never overwritten. `income` -> DB decimal; `categoryIds` is not a column.
    const { income, categoryIds, ...rest } = input;
    await transaction
      .update(project)
      .set({ ...rest, ...(income === undefined ? {} : { income: income.toFixed(2) }), updatedBy: userId })
      .where(and(eq(project.workspaceId, workspaceId), eq(project.idProject, idProject)));

    if (categoryIds !== undefined) {
      await replaceProjectCategories(transaction, userId, idProject, categoryIds);
    }

    const [row] = await transaction
      .select()
      .from(project)
      .where(and(eq(project.workspaceId, workspaceId), eq(project.idProject, idProject)))
      .limit(1);
    if (!row) {
      return undefined;
    }
    return { project: row, categoryIds: categoryIds ?? (await categoryIdsForProject(idProject)) };
  });
};

export const deleteProject = async (workspaceId: number, idProject: number): Promise<boolean> => {
  const [result] = await db
    .delete(project)
    .where(and(eq(project.workspaceId, workspaceId), eq(project.idProject, idProject)));
  return result.affectedRows > 0;
};
