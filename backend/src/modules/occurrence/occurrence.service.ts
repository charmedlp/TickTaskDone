import { and, eq, gte, isNotNull, isNull, lt, lte, or } from 'drizzle-orm';
import type { MoveOccurrenceInput, OccurrenceStatus, ScheduleOccurrenceInput } from '@ticktaskdone/shared';
import { db, type Transaction } from '../../db/db';
import {
  item,
  itemOccurrence,
  project,
  timeBlock,
  timeLog,
  type Item,
  type ItemOccurrence,
  type TimeBlock,
  type TimeLog,
} from '../../db/schema';
import { expandRecurrence, latestArrivedSlot, mergeSlots } from '../../domain/recurrence';

// One occurrence assembled for the calendar feed: the item context, the merge
// state (virtual vs materialized) and the current user's placements.
export interface OccurrenceView {
  item: Item;
  projectColor: string | null;
  idItemOccurrence: number | null;
  occurrenceDate: Date | null;
  status: OccurrenceStatus;
  dueDate: Date | null;
  materialized: boolean;
  timeBlocks: TimeBlock[];
  timeLogs: TimeLog[];
}

export interface ReminderRow {
  idItemOccurrence: number;
  itemId: number;
  title: string;
  occurrenceDate: Date | null;
  dueDate: Date | null; // null = overdue by its slot time (occurrenceDate), not a dueDate
  status: OccurrenceStatus;
}

export interface MovedOccurrence {
  occurrence: ItemOccurrence;
  timeBlocks: TimeBlock[];
}

const buildView = (
  definition: Item,
  projectColor: string | null,
  occurrence: ItemOccurrence,
  blocksByOccurrence: Map<number, TimeBlock[]>,
  logsByOccurrence: Map<number, TimeLog[]>,
): OccurrenceView => ({
  item: definition,
  projectColor,
  idItemOccurrence: occurrence.idItemOccurrence,
  occurrenceDate: occurrence.occurrenceDate,
  status: occurrence.status,
  dueDate: occurrence.dueDate,
  materialized: true,
  timeBlocks: blocksByOccurrence.get(occurrence.idItemOccurrence) ?? [],
  timeLogs: logsByOccurrence.get(occurrence.idItemOccurrence) ?? [],
});

// -----------------------------------------------------------------------------
//  Lazy materialization — the shared primitive behind every deviation/action.
// -----------------------------------------------------------------------------

// Find-or-create the occurrence row for (item, slot). A non-recurrent item has a
// single occurrence with occurrenceDate = null, matched with IS NULL (a unique
// index treats NULLs as distinct, so we must not rely on it there).
export const materializeOccurrence = async (
  transaction: Transaction,
  definition: Item,
  occurrenceDate: Date | null,
  userId: number,
): Promise<ItemOccurrence> => {
  const slotFilter =
    occurrenceDate === null
      ? and(eq(itemOccurrence.itemId, definition.idItem), isNull(itemOccurrence.occurrenceDate))
      : and(eq(itemOccurrence.itemId, definition.idItem), eq(itemOccurrence.occurrenceDate, occurrenceDate));

  const [existing] = await transaction.select().from(itemOccurrence).where(slotFilter).limit(1);
  if (existing) {
    return existing;
  }

  const [{ idItemOccurrence }] = await transaction
    .insert(itemOccurrence)
    .values({ itemId: definition.idItem, occurrenceDate, createdBy: userId, updatedBy: userId })
    .$returningId();
  const [created] = await transaction
    .select()
    .from(itemOccurrence)
    .where(eq(itemOccurrence.idItemOccurrence, idItemOccurrence))
    .limit(1);
  return created;
};

// Ensure a concrete occurrence exists for (item, slot) and return it, with no other
// change. Standalone (own transaction) wrapper over `materializeOccurrence` — the
// timer uses it to obtain an occurrence id before logging real time on a virtual slot.
export const ensureOccurrence = (
  definition: Item,
  userId: number,
  occurrenceDate: Date | null,
): Promise<ItemOccurrence> =>
  db.transaction((transaction) => materializeOccurrence(transaction, definition, occurrenceDate, userId));

// -----------------------------------------------------------------------------
//  Deviations / actions on a slot.
// -----------------------------------------------------------------------------

// Complete (`done`), start (`doing`), reopen (`todo`) or skip (`cancelled`).
export const setOccurrenceStatus = (
  definition: Item,
  userId: number,
  occurrenceDate: Date | null,
  status: OccurrenceStatus,
): Promise<ItemOccurrence> =>
  db.transaction(async (transaction) => {
    const occurrence = await materializeOccurrence(transaction, definition, occurrenceDate, userId);
    await transaction
      .update(itemOccurrence)
      .set({ status, updatedBy: userId })
      .where(eq(itemOccurrence.idItemOccurrence, occurrence.idItemOccurrence));
    const [row] = await transaction
      .select()
      .from(itemOccurrence)
      .where(eq(itemOccurrence.idItemOccurrence, occurrence.idItemOccurrence))
      .limit(1);
    return row;
  });

// Move a slot to a new time: materialize the occurrence (keeping its original
// occurrenceDate anchor) and place/replace the current user's timeBlock. Single
// block for now; multi-block splitting is Phase 5.
export const moveOccurrence = (definition: Item, userId: number, input: MoveOccurrenceInput): Promise<MovedOccurrence> =>
  db.transaction(async (transaction) => {
    const occurrence = await materializeOccurrence(transaction, definition, input.occurrenceDate, userId);

    const [existing] = await transaction
      .select()
      .from(timeBlock)
      .where(and(eq(timeBlock.itemOccurrenceId, occurrence.idItemOccurrence), eq(timeBlock.userId, userId)))
      .limit(1);

    if (existing) {
      const placement: Partial<typeof timeBlock.$inferInsert> = {
        timeStart: input.timeStart,
        timeEnd: input.timeEnd,
        updatedBy: userId,
      };
      if (input.allDay !== undefined) placement.allDay = input.allDay;
      if (input.isBlocking !== undefined) placement.isBlocking = input.isBlocking;
      if (input.timezone !== undefined) placement.timezone = input.timezone;
      await transaction.update(timeBlock).set(placement).where(eq(timeBlock.idTimeBlock, existing.idTimeBlock));
    } else {
      await transaction.insert(timeBlock).values({
        itemOccurrenceId: occurrence.idItemOccurrence,
        userId,
        timeStart: input.timeStart,
        timeEnd: input.timeEnd,
        allDay: input.allDay,
        isBlocking: input.isBlocking,
        timezone: input.timezone,
        createdBy: userId,
        updatedBy: userId,
      });
    }

    const timeBlocks = await transaction
      .select()
      .from(timeBlock)
      .where(and(eq(timeBlock.itemOccurrenceId, occurrence.idItemOccurrence), eq(timeBlock.userId, userId)));
    return { occurrence, timeBlocks };
  });

// Schedule an existing item: materialize the occurrence (find-or-create) and ADD a
// timeBlock. Recurrent -> occurrenceDate = drop (new custom occurrence); non-recurrent
// -> occurrenceDate = null (a split on its single occurrence).
export const scheduleOccurrence = (
  definition: Item,
  userId: number,
  input: ScheduleOccurrenceInput,
): Promise<OccurrenceView> =>
  db.transaction(async (transaction) => {
    const occurrence = await materializeOccurrence(transaction, definition, input.occurrenceDate, userId);

    if (input.dueDate !== null) {
      await transaction
        .update(itemOccurrence)
        .set({ dueDate: input.dueDate, updatedBy: userId })
        .where(eq(itemOccurrence.idItemOccurrence, occurrence.idItemOccurrence));
    }

    await transaction.insert(timeBlock).values({
      itemOccurrenceId: occurrence.idItemOccurrence,
      userId,
      timeStart: input.timeStart,
      timeEnd: input.timeEnd,
      allDay: input.allDay,
      isBlocking: input.isBlocking,
      timezone: input.timezone,
      createdBy: userId,
      updatedBy: userId,
    });

    const [row] = await transaction
      .select({ item, projectColor: project.color })
      .from(item)
      .leftJoin(project, eq(item.projectId, project.idProject))
      .where(eq(item.idItem, definition.idItem))
      .limit(1);
    const [fresh] = await transaction
      .select()
      .from(itemOccurrence)
      .where(eq(itemOccurrence.idItemOccurrence, occurrence.idItemOccurrence))
      .limit(1);
    const timeBlocks = await transaction
      .select()
      .from(timeBlock)
      .where(and(eq(timeBlock.itemOccurrenceId, occurrence.idItemOccurrence), eq(timeBlock.userId, userId)));

    return {
      item: row.item,
      projectColor: row.projectColor,
      idItemOccurrence: fresh.idItemOccurrence,
      occurrenceDate: fresh.occurrenceDate,
      status: fresh.status,
      dueDate: fresh.dueDate,
      materialized: true,
      timeBlocks,
      timeLogs: [], // a freshly scheduled occurrence has no real time yet
    };
  });

// -----------------------------------------------------------------------------
//  Reminder engine.
// -----------------------------------------------------------------------------

// Maintenance for each recurrent series (§11):
//  1. Materialize the latest ARRIVED slot as `todo` (find-or-create) so an ignored
//     recurring task still has a row and thus surfaces as an overdue reminder. Only
//     this one slot is materialized — never the whole history — so there is no row
//     explosion. A slot already actioned (done/cancelled) is left as-is.
//  2. Auto-cancel superseded occurrences: any `todo` slot preceding that latest slot
//     is cancelled — you will not do last week's instance once this week's arrived.
export const runReminderMaintenance = async (workspaceId: number, userId: number, now: Date): Promise<void> => {
  const recurrent = await db
    .select({ item })
    .from(item)
    .where(and(eq(item.workspaceId, workspaceId), isNotNull(item.rrule)));

  for (const { item: definition } of recurrent) {
    const latest = latestArrivedSlot(definition, now);
    if (latest === null) {
      continue;
    }
    if (definition.type === 'task') {
      await ensureOccurrence(definition, userId, latest);
    }
    await db
      .update(itemOccurrence)
      .set({ status: 'cancelled', updatedBy: userId })
      .where(
        and(
          eq(itemOccurrence.itemId, definition.idItem),
          eq(itemOccurrence.status, 'todo'),
          lt(itemOccurrence.occurrenceDate, latest),
        ),
      );
  }
};

// Overdue reminders: TASK occurrences still `todo` whose effective deadline has
// passed. The deadline is the explicit `dueDate` when set, otherwise the slot's
// `occurrenceDate` (a scheduled/recurring task is due at its slot time). Events are
// excluded — they are not "todo" work.
export const listReminders = async (workspaceId: number, userId: number, now: Date): Promise<ReminderRow[]> => {
  await runReminderMaintenance(workspaceId, userId, now);

  const rows = await db
    .select({ occurrence: itemOccurrence, title: item.title })
    .from(itemOccurrence)
    .innerJoin(item, eq(itemOccurrence.itemId, item.idItem))
    .where(
      and(
        eq(item.workspaceId, workspaceId),
        eq(item.type, 'task'),
        eq(itemOccurrence.status, 'todo'),
        or(lt(itemOccurrence.dueDate, now), and(isNull(itemOccurrence.dueDate), lt(itemOccurrence.occurrenceDate, now))),
      ),
    );

  return rows.map((row) => ({
    idItemOccurrence: row.occurrence.idItemOccurrence,
    itemId: row.occurrence.itemId,
    title: row.title,
    occurrenceDate: row.occurrence.occurrenceDate,
    dueDate: row.occurrence.dueDate,
    status: row.occurrence.status,
  }));
};

// -----------------------------------------------------------------------------
//  Calendar window feed — expansion + virtual/materialized merge in one call.
// -----------------------------------------------------------------------------

export interface ItemContext {
  item: Item;
  projectColor: string | null;
}

// PURE assembly of the window feed (no DB) — extracted so the subtle merge /
// dedup / catch-up logic is unit-testable, since this is where calendar bugs hide.
//
// Invariants enforced here:
//  - Deduplication is by materialized id ONLY (a real number). Virtual slots
//    (idItemOccurrence = null) are never added to the `emitted` set, so two
//    distinct virtuals can never collide on null; each expanded slot is emitted
//    exactly once and cannot reappear in the catch-up pass (it has no block).
//  - A materialized row masks the virtual on its slot (via mergeSlots).
//  - The catch-up pass adds occurrences whose block OR log is in-window but whose
//    slot was not produced by expansion (non-recurrent scheduled items, moved slots,
//    or an occurrence with only real time logged in the window).
export const assembleWindow = (
  definitions: ItemContext[],
  materializedByItem: Map<number, ItemOccurrence[]>,
  occurrenceWithPlacement: Map<number, ItemOccurrence>,
  blocksByOccurrence: Map<number, TimeBlock[]>,
  logsByOccurrence: Map<number, TimeLog[]>,
  from: Date,
  to: Date,
): OccurrenceView[] => {
  const contextByItem = new Map(definitions.map((context) => [context.item.idItem, context]));
  const views: OccurrenceView[] = [];
  const emitted = new Set<number>();

  // Recurrent series: expand the window and overlay materialized rows.
  for (const { item: definition, projectColor } of definitions) {
    if (definition.rrule === null || definition.recurrenceStart === null) {
      continue;
    }
    const merged = mergeSlots(expandRecurrence(definition, from, to), materializedByItem.get(definition.idItem) ?? []);
    for (const entry of merged) {
      if (entry.materialized) {
        emitted.add(entry.materialized.idItemOccurrence);
        views.push(buildView(definition, projectColor, entry.materialized, blocksByOccurrence, logsByOccurrence));
      } else {
        views.push({
          item: definition,
          projectColor,
          idItemOccurrence: null,
          occurrenceDate: entry.occurrenceDate,
          status: 'todo',
          dueDate: null,
          materialized: false,
          timeBlocks: [],
          timeLogs: [],
        });
      }
    }
  }

  // Occurrences with a block or log in the window but not produced by expansion above.
  for (const [idItemOccurrence, occurrence] of occurrenceWithPlacement) {
    if (emitted.has(idItemOccurrence)) {
      continue;
    }
    const context = contextByItem.get(occurrence.itemId);
    if (!context) {
      continue;
    }
    emitted.add(idItemOccurrence);
    views.push(buildView(context.item, context.projectColor, occurrence, blocksByOccurrence, logsByOccurrence));
  }

  return views;
};

export const getWindowOccurrences = async (
  workspaceId: number,
  userId: number,
  from: Date,
  to: Date,
): Promise<OccurrenceView[]> => {
  await runReminderMaintenance(workspaceId, userId, new Date());

  // Item definitions (+ project color for the cascade).
  const definitions = await db
    .select({ item, projectColor: project.color })
    .from(item)
    .leftJoin(project, eq(item.projectId, project.idProject))
    .where(eq(item.workspaceId, workspaceId));

  // Materialized occurrences whose recurrence slot falls inside the window.
  const windowOccurrences = await db
    .select({ occurrence: itemOccurrence })
    .from(itemOccurrence)
    .innerJoin(item, eq(itemOccurrence.itemId, item.idItem))
    .where(
      and(
        eq(item.workspaceId, workspaceId),
        gte(itemOccurrence.occurrenceDate, from),
        lte(itemOccurrence.occurrenceDate, to),
      ),
    );
  const materializedByItem = new Map<number, ItemOccurrence[]>();
  for (const { occurrence } of windowOccurrences) {
    const list = materializedByItem.get(occurrence.itemId) ?? [];
    list.push(occurrence);
    materializedByItem.set(occurrence.itemId, list);
  }

  // Current user's blocks overlapping the window, with their occurrence. This
  // both attaches placements and surfaces occurrences whose block is in-window
  // but whose slot is not (non-recurrent scheduled items, moved recurring slots).
  const blockRows = await db
    .select({ timeBlock, occurrence: itemOccurrence })
    .from(timeBlock)
    .innerJoin(itemOccurrence, eq(timeBlock.itemOccurrenceId, itemOccurrence.idItemOccurrence))
    .innerJoin(item, eq(itemOccurrence.itemId, item.idItem))
    .where(
      and(
        eq(item.workspaceId, workspaceId),
        eq(timeBlock.userId, userId),
        lte(timeBlock.timeStart, to),
        gte(timeBlock.timeEnd, from),
      ),
    );
  const blocksByOccurrence = new Map<number, TimeBlock[]>();
  const occurrenceWithPlacement = new Map<number, ItemOccurrence>();
  for (const row of blockRows) {
    const list = blocksByOccurrence.get(row.occurrence.idItemOccurrence) ?? [];
    list.push(row.timeBlock);
    blocksByOccurrence.set(row.occurrence.idItemOccurrence, list);
    occurrenceWithPlacement.set(row.occurrence.idItemOccurrence, row.occurrence);
  }

  // Current user's real time logs overlapping the window, with their occurrence. A
  // running segment (endedAt null) overlaps as soon as it started before `to`. This
  // both attaches the actual-view data and surfaces occurrences that have only a log
  // in the window (no block).
  const logRows = await db
    .select({ timeLog, occurrence: itemOccurrence })
    .from(timeLog)
    .innerJoin(itemOccurrence, eq(timeLog.itemOccurrenceId, itemOccurrence.idItemOccurrence))
    .innerJoin(item, eq(itemOccurrence.itemId, item.idItem))
    .where(
      and(
        eq(item.workspaceId, workspaceId),
        eq(timeLog.userId, userId),
        lte(timeLog.startedAt, to),
        or(isNull(timeLog.endedAt), gte(timeLog.endedAt, from)),
      ),
    );
  const logsByOccurrence = new Map<number, TimeLog[]>();
  for (const row of logRows) {
    const list = logsByOccurrence.get(row.occurrence.idItemOccurrence) ?? [];
    list.push(row.timeLog);
    logsByOccurrence.set(row.occurrence.idItemOccurrence, list);
    occurrenceWithPlacement.set(row.occurrence.idItemOccurrence, row.occurrence);
  }

  return assembleWindow(definitions, materializedByItem, occurrenceWithPlacement, blocksByOccurrence, logsByOccurrence, from, to);
};
