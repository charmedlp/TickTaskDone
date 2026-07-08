import { and, eq } from 'drizzle-orm';
import type { CreateTimeBlockInput, UpdateTimeBlockInput } from '@ticktaskdone/shared';
import { db } from '../../db/db';
import { item, itemOccurrence, timeBlock, type TimeBlock } from '../../db/schema';
import { AppError, notFound } from '../../http/errors';

// A timeBlock belongs to a user (personal schedule) while its occurrence's item
// belongs to a workspace. Every operation is therefore scoped by BOTH the current
// user and the workspace (via the occurrence -> item join). Order follows LRCUD.

// Joined base (block -> occurrence -> item) without a WHERE, so each caller adds
// its own filter on top of the common scope predicate.
const scopedBase = () =>
  db
    .select({ timeBlock })
    .from(timeBlock)
    .innerJoin(itemOccurrence, eq(timeBlock.itemOccurrenceId, itemOccurrence.idItemOccurrence))
    .innerJoin(item, eq(itemOccurrence.itemId, item.idItem));

// A block is in scope when it is the current user's and its item is in the workspace.
const inScope = (workspaceId: number, userId: number) =>
  and(eq(timeBlock.userId, userId), eq(item.workspaceId, workspaceId));

export const listTimeBlocks = async (workspaceId: number, userId: number): Promise<TimeBlock[]> =>
  (await scopedBase().where(inScope(workspaceId, userId))).map((row) => row.timeBlock);

export const readTimeBlock = async (
  workspaceId: number,
  userId: number,
  idTimeBlock: number,
): Promise<TimeBlock | undefined> => {
  const [row] = await scopedBase()
    .where(and(inScope(workspaceId, userId), eq(timeBlock.idTimeBlock, idTimeBlock)))
    .limit(1);
  return row?.timeBlock;
};

export const createTimeBlock = (
  workspaceId: number,
  userId: number,
  input: CreateTimeBlockInput,
): Promise<TimeBlock> =>
  db.transaction(async (transaction) => {
    // The referenced occurrence must belong to an item of this workspace.
    const [owner] = await transaction
      .select({ workspaceId: item.workspaceId })
      .from(itemOccurrence)
      .innerJoin(item, eq(itemOccurrence.itemId, item.idItem))
      .where(eq(itemOccurrence.idItemOccurrence, input.itemOccurrenceId))
      .limit(1);
    if (!owner || owner.workspaceId !== workspaceId) {
      throw notFound('Item occurrence');
    }

    const [{ idTimeBlock }] = await transaction
      .insert(timeBlock)
      .values({
        itemOccurrenceId: input.itemOccurrenceId,
        userId,
        timeStart: input.timeStart,
        timeEnd: input.timeEnd,
        allDay: input.allDay,
        isBlocking: input.isBlocking,
        timezone: input.timezone,
        createdBy: userId,
        updatedBy: userId,
      })
      .$returningId();

    const [row] = await transaction.select().from(timeBlock).where(eq(timeBlock.idTimeBlock, idTimeBlock)).limit(1);
    return row;
  });

export const updateTimeBlock = async (
  workspaceId: number,
  userId: number,
  idTimeBlock: number,
  input: UpdateTimeBlockInput,
): Promise<TimeBlock | undefined> => {
  const current = await readTimeBlock(workspaceId, userId, idTimeBlock);
  if (!current) {
    return undefined;
  }

  // Ordering is an invariant of the FINAL row, so check the merged bounds.
  const timeStart = input.timeStart ?? current.timeStart;
  const timeEnd = input.timeEnd ?? current.timeEnd;
  if (timeEnd <= timeStart) {
    throw new AppError(400, 'timeEnd must be after timeStart.');
  }

  await db
    .update(timeBlock)
    .set({ ...input, updatedBy: userId })
    .where(and(eq(timeBlock.idTimeBlock, idTimeBlock), eq(timeBlock.userId, userId)));
  return readTimeBlock(workspaceId, userId, idTimeBlock);
};

export const deleteTimeBlock = async (workspaceId: number, userId: number, idTimeBlock: number): Promise<boolean> => {
  // Confirm ownership + workspace scope before deleting by primary key.
  if (!(await readTimeBlock(workspaceId, userId, idTimeBlock))) {
    return false;
  }
  const [result] = await db
    .delete(timeBlock)
    .where(and(eq(timeBlock.idTimeBlock, idTimeBlock), eq(timeBlock.userId, userId)));
  return result.affectedRows > 0;
};
