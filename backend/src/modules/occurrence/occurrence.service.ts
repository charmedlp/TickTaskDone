import { and, eq, gte, isNotNull, isNull, lt, lte } from 'drizzle-orm';
import type { MoveOccurrenceInput, OccurrenceStatus } from '@ticktaskdone/shared';
import { db, type Transaction } from '../../db/db';
import {
  item,
  itemOccurrence,
  project,
  timeBlock,
  type Item,
  type ItemOccurrence,
  type TimeBlock,
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
}

export interface ReminderRow {
  idItemOccurrence: number;
  itemId: number;
  title: string;
  occurrenceDate: Date | null;
  dueDate: Date;
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
): OccurrenceView => ({
  item: definition,
  projectColor,
  idItemOccurrence: occurrence.idItemOccurrence,
  occurrenceDate: occurrence.occurrenceDate,
  status: occurrence.status,
  dueDate: occurrence.dueDate,
  materialized: true,
  timeBlocks: blocksByOccurrence.get(occurrence.idItemOccurrence) ?? [],
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
      await transaction.update(timeBlock).set(placement).where(eq(timeBlock.idTimeBlock, existing.idTimeBlock));
    } else {
      await transaction.insert(timeBlock).values({
        itemOccurrenceId: occurrence.idItemOccurrence,
        userId,
        timeStart: input.timeStart,
        timeEnd: input.timeEnd,
        allDay: input.allDay,
        isBlocking: input.isBlocking,
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

// -----------------------------------------------------------------------------
//  Reminder engine.
// -----------------------------------------------------------------------------

// Auto-cancel superseded occurrences: for each recurrent series, any materialized
// occurrence still `todo` whose slot precedes the most recent arrived slot is
// cancelled — you will not do last week's instance once this week's has arrived.
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

// Overdue reminders: materialized occurrences still `todo` past their dueDate.
export const listReminders = async (workspaceId: number, userId: number, now: Date): Promise<ReminderRow[]> => {
  await runReminderMaintenance(workspaceId, userId, now);

  const rows = await db
    .select({ occurrence: itemOccurrence, title: item.title })
    .from(itemOccurrence)
    .innerJoin(item, eq(itemOccurrence.itemId, item.idItem))
    .where(and(eq(item.workspaceId, workspaceId), eq(itemOccurrence.status, 'todo'), lt(itemOccurrence.dueDate, now)));

  const reminders: ReminderRow[] = [];
  for (const row of rows) {
    const { dueDate } = row.occurrence;
    if (dueDate === null) {
      continue; // guarded by the query, but keeps dueDate a non-null Date
    }
    reminders.push({
      idItemOccurrence: row.occurrence.idItemOccurrence,
      itemId: row.occurrence.itemId,
      title: row.title,
      occurrenceDate: row.occurrence.occurrenceDate,
      dueDate,
      status: row.occurrence.status,
    });
  }
  return reminders;
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
//  - The catch-up pass adds occurrences whose block is in-window but whose slot
//    was not produced by expansion (non-recurrent scheduled items, moved slots).
export const assembleWindow = (
  definitions: ItemContext[],
  materializedByItem: Map<number, ItemOccurrence[]>,
  occurrenceWithBlock: Map<number, ItemOccurrence>,
  blocksByOccurrence: Map<number, TimeBlock[]>,
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
        views.push(buildView(definition, projectColor, entry.materialized, blocksByOccurrence));
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
        });
      }
    }
  }

  // Occurrences scheduled into the window but not produced by expansion above.
  for (const [idItemOccurrence, occurrence] of occurrenceWithBlock) {
    if (emitted.has(idItemOccurrence)) {
      continue;
    }
    const context = contextByItem.get(occurrence.itemId);
    if (!context) {
      continue;
    }
    emitted.add(idItemOccurrence);
    views.push(buildView(context.item, context.projectColor, occurrence, blocksByOccurrence));
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
  const occurrenceWithBlock = new Map<number, ItemOccurrence>();
  for (const row of blockRows) {
    const list = blocksByOccurrence.get(row.occurrence.idItemOccurrence) ?? [];
    list.push(row.timeBlock);
    blocksByOccurrence.set(row.occurrence.idItemOccurrence, list);
    occurrenceWithBlock.set(row.occurrence.idItemOccurrence, row.occurrence);
  }

  return assembleWindow(definitions, materializedByItem, occurrenceWithBlock, blocksByOccurrence, from, to);
};
