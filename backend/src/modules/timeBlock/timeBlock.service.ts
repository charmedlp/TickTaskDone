import { and, eq, gt, lt, ne } from 'drizzle-orm';
import type { CreateTimeBlockInput, UpdateTimeBlockInput } from '@ticktaskdone/shared';
import { db, type Transaction } from '../../db/db';
import { item, itemOccurrence, timeBlock, type TimeBlock } from '../../db/schema';
import { AppError, conflict, notFound } from '../../http/errors';

// A timeBlock belongs to a user (personal schedule) while its occurrence's item
// belongs to a workspace. Every operation is therefore scoped by BOTH the current
// user and the workspace (via the occurrence -> item join). Order follows LRCUD.

// -----------------------------------------------------------------------------
//  Blocking invariant (shared by every write path)
// -----------------------------------------------------------------------------

export interface OverlapCheck {
  workspaceId: number;
  userId: number;
  timeStart: Date;
  timeEnd: Date;
  isBlocking: boolean;
  allDay?: boolean;
  excludeTimeBlockId?: number; // the block being moved/edited, ignored in the search
}

// Enforce: two TIMED blocks of the same user in the workspace may not overlap when
// EITHER is blocking. A blocking block reserves its slot exclusively; a non-blocking
// block only clashes with blocking ones. All-day items float (no timed slot) and are
// exempt. Throws 409 on the first conflict. Runs inside the caller's transaction so
// the check and the write are atomic.
export const assertNoBlockingOverlap = async (transaction: Transaction, check: OverlapCheck): Promise<void> => {
  if (check.allDay) {
    return;
  }
  const conditions = [
    eq(item.workspaceId, check.workspaceId),
    eq(timeBlock.userId, check.userId),
    eq(timeBlock.allDay, false),
    lt(timeBlock.timeStart, check.timeEnd),
    gt(timeBlock.timeEnd, check.timeStart),
  ];
  if (!check.isBlocking) {
    conditions.push(eq(timeBlock.isBlocking, true)); // non-blocking only clashes with blocking
  }
  if (check.excludeTimeBlockId !== undefined) {
    conditions.push(ne(timeBlock.idTimeBlock, check.excludeTimeBlockId));
  }

  const [clash] = await transaction
    .select({ title: item.title })
    .from(timeBlock)
    .innerJoin(itemOccurrence, eq(timeBlock.itemOccurrenceId, itemOccurrence.idItemOccurrence))
    .innerJoin(item, eq(itemOccurrence.itemId, item.idItem))
    .where(and(...conditions))
    .limit(1);

  if (clash) {
    throw conflict(`Blocking items can't overlap other items — this time conflicts with "${clash.title}".`);
  }
};

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

    await assertNoBlockingOverlap(transaction, {
      workspaceId,
      userId,
      timeStart: input.timeStart,
      timeEnd: input.timeEnd,
      isBlocking: input.isBlocking ?? false,
      allDay: input.allDay ?? false,
    });

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

  // Ordering + the blocking invariant hold on the FINAL row, so check the merged
  // values (input over current). The overlap check and the write share a transaction.
  const timeStart = input.timeStart ?? current.timeStart;
  const timeEnd = input.timeEnd ?? current.timeEnd;
  if (timeEnd <= timeStart) {
    throw new AppError(400, 'timeEnd must be after timeStart.');
  }
  const isBlocking = input.isBlocking ?? current.isBlocking;
  const allDay = input.allDay ?? current.allDay;

  await db.transaction(async (transaction) => {
    await assertNoBlockingOverlap(transaction, {
      workspaceId,
      userId,
      timeStart,
      timeEnd,
      isBlocking,
      allDay,
      excludeTimeBlockId: idTimeBlock,
    });
    await transaction
      .update(timeBlock)
      .set({ ...input, updatedBy: userId })
      .where(and(eq(timeBlock.idTimeBlock, idTimeBlock), eq(timeBlock.userId, userId)));
  });
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
