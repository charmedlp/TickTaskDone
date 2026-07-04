import { and, eq } from 'drizzle-orm';
import type { CreateItemInput, UpdateItemInput } from '@ticktaskdone/shared';
import { db } from '../../db/db';
import { item, project, type Item } from '../../db/schema';
import { AppError } from '../../http/errors';

// An item plus the color of its (optional) project, so the color cascade can be
// resolved without a second round-trip. See guide §7 and the color helper.
export interface ItemWithProjectColor {
  item: Item;
  projectColor: string | null;
}

// Left join so items without a project still appear (projectColor = null).
const selectWithProjectColor = () =>
  db
    .select({ item, projectColor: project.color })
    .from(item)
    .leftJoin(project, eq(item.projectId, project.idProject));

// Every operation is scoped by workspaceId. Order follows LRCUD.

export const listItems = (workspaceId: number): Promise<ItemWithProjectColor[]> =>
  selectWithProjectColor().where(eq(item.workspaceId, workspaceId));

export const readItem = async (workspaceId: number, idItem: number): Promise<ItemWithProjectColor | undefined> => {
  const [row] = await selectWithProjectColor()
    .where(and(eq(item.workspaceId, workspaceId), eq(item.idItem, idItem)))
    .limit(1);
  return row;
};

export const createItem = (workspaceId: number, userId: number, input: CreateItemInput): Promise<ItemWithProjectColor> =>
  db.transaction(async (transaction) => {
    const [{ idItem }] = await transaction
      .insert(item)
      .values({
        workspaceId,
        type: input.type,
        projectId: input.projectId,
        title: input.title,
        description: input.description,
        color: input.color,
        estimatedMinutes: input.estimatedMinutes,
        rrule: input.rrule,
        recurrenceStart: input.recurrenceStart,
        createdBy: userId,
        updatedBy: userId,
      })
      .$returningId();

    const [row] = await transaction
      .select({ item, projectColor: project.color })
      .from(item)
      .leftJoin(project, eq(item.projectId, project.idProject))
      .where(eq(item.idItem, idItem))
      .limit(1);
    return row;
  });

export const updateItem = (
  workspaceId: number,
  userId: number,
  idItem: number,
  input: UpdateItemInput,
): Promise<ItemWithProjectColor | undefined> =>
  db.transaction(async (transaction) => {
    // Read the current recurrence pair first: pairing is an invariant of the FINAL
    // row, so it must be checked on the body merged with what already exists — not
    // on the partial body alone. Updating only `rrule` on an already-recurrent item
    // must stay legal, while clearing just one side must be rejected.
    const [current] = await transaction
      .select({ rrule: item.rrule, recurrenceStart: item.recurrenceStart })
      .from(item)
      .where(and(eq(item.workspaceId, workspaceId), eq(item.idItem, idItem)))
      .limit(1);
    if (!current) return undefined;

    const rrule = 'rrule' in input ? input.rrule : current.rrule;
    const recurrenceStart = 'recurrenceStart' in input ? input.recurrenceStart : current.recurrenceStart;
    if ((rrule == null) !== (recurrenceStart == null)) {
      throw new AppError(400, 'rrule and recurrenceStart must both be set or both be null.');
    }

    // Spread only the keys the client sent (Zod partial omits the rest).
    await transaction
      .update(item)
      .set({ ...input, updatedBy: userId })
      .where(and(eq(item.workspaceId, workspaceId), eq(item.idItem, idItem)));

    const [row] = await transaction
      .select({ item, projectColor: project.color })
      .from(item)
      .leftJoin(project, eq(item.projectId, project.idProject))
      .where(and(eq(item.workspaceId, workspaceId), eq(item.idItem, idItem)))
      .limit(1);
    return row;
  });

export const deleteItem = async (workspaceId: number, idItem: number): Promise<boolean> => {
  const [result] = await db.delete(item).where(and(eq(item.workspaceId, workspaceId), eq(item.idItem, idItem)));
  return result.affectedRows > 0;
};
