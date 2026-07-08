import { and, eq } from 'drizzle-orm';
import type { CreateTimeLogInput, UpdateTimeLogInput } from '@ticktaskdone/shared';
import { db } from '../../db/db';
import { item, itemOccurrence, timeLog, type TimeLog } from '../../db/schema';
import { AppError, notFound } from '../../http/errors';

// A timeLog is REAL time spent; like a timeBlock it belongs to a user (personal)
// while its occurrence's item belongs to a workspace. Every operation is therefore
// scoped by BOTH the current user and the workspace (via occurrence -> item). Order
// follows LRCUD.

// Joined base (log -> occurrence -> item) without a WHERE, so each caller adds its
// own filter on top of the common scope predicate.
const scopedBase = () =>
  db
    .select({ timeLog })
    .from(timeLog)
    .innerJoin(itemOccurrence, eq(timeLog.itemOccurrenceId, itemOccurrence.idItemOccurrence))
    .innerJoin(item, eq(itemOccurrence.itemId, item.idItem));

// A log is in scope when it is the current user's and its item is in the workspace.
const inScope = (workspaceId: number, userId: number) =>
  and(eq(timeLog.userId, userId), eq(item.workspaceId, workspaceId));

export const listTimeLogs = async (workspaceId: number, userId: number): Promise<TimeLog[]> =>
  (await scopedBase().where(inScope(workspaceId, userId))).map((row) => row.timeLog);

export const readTimeLog = async (
  workspaceId: number,
  userId: number,
  idTimeLog: number,
): Promise<TimeLog | undefined> => {
  const [row] = await scopedBase()
    .where(and(inScope(workspaceId, userId), eq(timeLog.idTimeLog, idTimeLog)))
    .limit(1);
  return row?.timeLog;
};

export const createTimeLog = (workspaceId: number, userId: number, input: CreateTimeLogInput): Promise<TimeLog> =>
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

    const [{ idTimeLog }] = await transaction
      .insert(timeLog)
      .values({
        itemOccurrenceId: input.itemOccurrenceId,
        userId,
        startedAt: input.startedAt,
        endedAt: input.endedAt,
        source: input.source,
        timezone: input.timezone,
        createdBy: userId,
        updatedBy: userId,
      })
      .$returningId();

    const [row] = await transaction.select().from(timeLog).where(eq(timeLog.idTimeLog, idTimeLog)).limit(1);
    return row;
  });

export const updateTimeLog = async (
  workspaceId: number,
  userId: number,
  idTimeLog: number,
  input: UpdateTimeLogInput,
): Promise<TimeLog | undefined> => {
  const current = await readTimeLog(workspaceId, userId, idTimeLog);
  if (!current) {
    return undefined;
  }

  // Ordering is an invariant of the FINAL row, so check the merged bounds. A null
  // endedAt (running segment) is allowed and skips the ordering check.
  const startedAt = input.startedAt ?? current.startedAt;
  const endedAt = input.endedAt === undefined ? current.endedAt : input.endedAt;
  if (endedAt !== null && endedAt <= startedAt) {
    throw new AppError(400, 'endedAt must be after startedAt.');
  }

  await db
    .update(timeLog)
    .set({ ...input, updatedBy: userId })
    .where(and(eq(timeLog.idTimeLog, idTimeLog), eq(timeLog.userId, userId)));
  return readTimeLog(workspaceId, userId, idTimeLog);
};

export const deleteTimeLog = async (workspaceId: number, userId: number, idTimeLog: number): Promise<boolean> => {
  // Confirm ownership + workspace scope before deleting by primary key.
  if (!(await readTimeLog(workspaceId, userId, idTimeLog))) {
    return false;
  }
  const [result] = await db
    .delete(timeLog)
    .where(and(eq(timeLog.idTimeLog, idTimeLog), eq(timeLog.userId, userId)));
  return result.affectedRows > 0;
};
