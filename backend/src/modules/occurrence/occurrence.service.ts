import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, lte, ne, or } from 'drizzle-orm';
import { instantToWallClock, wallClockToInstant } from '../../domain/timezone';
import type { MoveOccurrenceInput, OccurrenceStatus, ScheduleOccurrenceInput } from '@ticktaskdone/shared';
import { db, type Transaction } from '../../db/db';
import {
  item,
  itemOccurrence,
  timeBlock,
  timeLog,
  type Item,
  type ItemOccurrence,
  type TimeBlock,
  type TimeLog,
} from '../../db/schema';
import { expandRecurrence, latestArrivedSlot, mergeSlots } from '../../domain/recurrence';
import { assertNoBlockingOverlap, linkedDueDate } from '../timeBlock/timeBlock.service';
import { loadColorContext, resolveItemColor } from '../item/itemColor';

// One occurrence assembled for the calendar feed: the item context, the merge
// state (virtual vs materialized) and the current user's placements.
export interface OccurrenceView {
  item: Item;
  resolvedColor: string; // full cascade: item.color -> project -> first category -> default
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
  resolvedColor: string;
  estimatedMinutes: number | null;
  occurrenceDate: Date | null;
  dueDate: Date | null; // null = overdue by its slot time (occurrenceDate), not a dueDate
  effectiveDate: Date; // the actual moment it is overdue at (block, else slot/dueDate)
  status: OccurrenceStatus;
  isRecurrent: boolean; // rescheduling recurrent -> custom occurrence; else -> a split
}

export interface MovedOccurrence {
  occurrence: ItemOccurrence;
  timeBlocks: TimeBlock[];
}

const buildView = (
  definition: Item,
  resolvedColor: string,
  occurrence: ItemOccurrence,
  blocksByOccurrence: Map<number, TimeBlock[]>,
  logsByOccurrence: Map<number, TimeLog[]>,
): OccurrenceView => ({
  item: definition,
  resolvedColor,
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

    await assertNoBlockingOverlap(transaction, {
      workspaceId: definition.workspaceId,
      userId,
      timeStart: input.timeStart,
      timeEnd: input.timeEnd,
      isBlocking: input.isBlocking ?? existing?.isBlocking ?? false,
      allDay: input.allDay ?? existing?.allDay ?? false,
      excludeTimeBlockId: existing?.idTimeBlock,
    });

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
        // Placing a bare (virtual) slot: fall back to the item's default blocking so the
        // task's blocking survives an unschedule → replace, instead of silently dropping.
        isBlocking: input.isBlocking ?? definition.blockingByDefault,
        timezone: input.timezone,
        createdBy: userId,
        updatedBy: userId,
      });
    }

    // Keep a linked due date in sync with the block (tasks only): follow it when moving an
    // existing linked block, inherit it when first placing a bare slot with no dueDate.
    if (definition.type === 'task') {
      const newAllDay = input.allDay ?? existing?.allDay ?? false;
      const shouldLink = existing
        ? occurrence.dueDate !== null &&
          occurrence.dueDate.getTime() === linkedDueDate(existing.timeStart, existing.timeEnd, existing.allDay, definition.timezone).getTime()
        : occurrence.dueDate === null; // fresh placement inherits the block's deadline
      if (shouldLink) {
        await transaction
          .update(itemOccurrence)
          .set({ dueDate: linkedDueDate(input.timeStart, input.timeEnd, newAllDay, definition.timezone), updatedBy: userId })
          .where(eq(itemOccurrence.idItemOccurrence, occurrence.idItemOccurrence));
      }
    }

    const [fresh] = await transaction
      .select()
      .from(itemOccurrence)
      .where(eq(itemOccurrence.idItemOccurrence, occurrence.idItemOccurrence))
      .limit(1);
    const timeBlocks = await transaction
      .select()
      .from(timeBlock)
      .where(and(eq(timeBlock.itemOccurrenceId, occurrence.idItemOccurrence), eq(timeBlock.userId, userId)));
    return { occurrence: fresh, timeBlocks };
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

    await assertNoBlockingOverlap(transaction, {
      workspaceId: definition.workspaceId,
      userId,
      timeStart: input.timeStart,
      timeEnd: input.timeEnd,
      isBlocking: input.isBlocking ?? false,
      allDay: input.allDay ?? false,
    });

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

    // Moving a recurring occurrence: cancel the original rule slot so it stops projecting
    // beside the freshly created custom occurrence (a projected + custom duplicate). Skip
    // when it addresses the same slot we just scheduled (nothing to supersede).
    if (input.supersedeOccurrenceDate !== undefined) {
      const newSlotMs = input.occurrenceDate?.getTime() ?? null;
      const supersedeMs = input.supersedeOccurrenceDate?.getTime() ?? null;
      if (newSlotMs !== supersedeMs) {
        const original = await materializeOccurrence(transaction, definition, input.supersedeOccurrenceDate, userId);
        await transaction
          .update(itemOccurrence)
          .set({ status: 'cancelled', updatedBy: userId })
          .where(eq(itemOccurrence.idItemOccurrence, original.idItemOccurrence));
      }
    }

    const [row] = await transaction
      .select({ item })
      .from(item)
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

    const colorContext = await loadColorContext(definition.workspaceId);
    return {
      item: row.item,
      resolvedColor: resolveItemColor(row.item, colorContext),
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

const laterOf = (left: Date | null, right: Date | null): Date | null => {
  if (left === null) return right;
  if (right === null) return left;
  return left.getTime() >= right.getTime() ? left : right;
};

// Maintenance for each recurrent series (§11 + reschedule supersession):
//  1. Establish the series' current "frontier" = the later of the latest ARRIVED rule
//     slot and the latest MATERIALIZED occurrence whose day has started (in the item's
//     timezone). A same-day reschedule (a custom occurrence created for today, even at
//     a later hour) therefore moves the frontier to today — the series has "reappeared".
//  2. Materialize the latest rule slot as `todo` only when nothing later exists, so an
//     ignored series still surfaces exactly one live overdue reminder (no row explosion).
//  3. Auto-cancel every `todo` occurrence before the frontier — you will not do last
//     week's instance once this week's (or a same-day reschedule) has arrived — EXCEPT
//     one whose planned block still lies in the future (a rescheduled-later instance is
//     not stale; its `occurrenceDate` anchor being early must not condemn it).
export const runReminderMaintenance = async (workspaceId: number, userId: number, now: Date): Promise<void> => {
  const recurrent = await db
    .select({ item })
    .from(item)
    // Non-reminder tasks are excluded outright: never materialized, never auto-cancelled.
    .where(and(eq(item.workspaceId, workspaceId), isNotNull(item.rrule), eq(item.generatesReminder, true)));

  for (const { item: definition } of recurrent) {
    // Accumulating series (supersede OFF): every arrived slot is its OWN standing to-do
    // and nothing is auto-cancelled. Materialize each arrived-but-missing slot so it
    // surfaces as a distinct overdue reminder; cap the backfill so a long-dormant rule
    // can't explode the table in one pass (older-than-cap misses are dropped silently).
    if (definition.type === 'task' && !definition.supersedeStaleOccurrences) {
      const arrived = definition.recurrenceStart ? expandRecurrence(definition, definition.recurrenceStart, now) : [];
      if (arrived.length > 0) {
        const existing = await db
          .select({ occurrenceDate: itemOccurrence.occurrenceDate })
          .from(itemOccurrence)
          .where(and(eq(itemOccurrence.itemId, definition.idItem), isNotNull(itemOccurrence.occurrenceDate)));
        const existingMs = new Set(existing.map((row) => row.occurrenceDate?.getTime()));
        const ACCUMULATE_BACKFILL_CAP = 60;
        const missing = arrived.filter((slot) => !existingMs.has(slot.getTime())).slice(-ACCUMULATE_BACKFILL_CAP);
        for (const slot of missing) {
          await ensureOccurrence(definition, userId, slot);
        }
      }
      continue;
    }

    const ruleLatest = latestArrivedSlot(definition, now);

    // Start of tomorrow in the item's timezone — the cutoff for "arrived today".
    const timeZone = definition.timezone ?? 'UTC';
    const wall = instantToWallClock(now, timeZone);
    const startOfTomorrow = wallClockToInstant(
      { year: wall.year, month: wall.month, day: wall.day + 1, hour: 0, minute: 0, second: 0 },
      timeZone,
    );
    const [materializedRow] = await db
      .select({ occurrenceDate: itemOccurrence.occurrenceDate })
      .from(itemOccurrence)
      .where(
        and(
          eq(itemOccurrence.itemId, definition.idItem),
          isNotNull(itemOccurrence.occurrenceDate),
          lt(itemOccurrence.occurrenceDate, startOfTomorrow),
          ne(itemOccurrence.status, 'cancelled'), // a cancelled instance never sets the frontier
        ),
      )
      .orderBy(desc(itemOccurrence.occurrenceDate))
      .limit(1);
    const materializedLatest = materializedRow?.occurrenceDate ?? null;

    const frontier = laterOf(ruleLatest, materializedLatest);
    if (frontier === null) {
      continue;
    }

    if (
      definition.type === 'task' &&
      ruleLatest !== null &&
      (materializedLatest === null || ruleLatest.getTime() >= materializedLatest.getTime())
    ) {
      await ensureOccurrence(definition, userId, ruleLatest);
    }

    // Candidates: todo occurrences anchored before the frontier.
    const candidates = await db
      .select({ id: itemOccurrence.idItemOccurrence })
      .from(itemOccurrence)
      .where(
        and(
          eq(itemOccurrence.itemId, definition.idItem),
          eq(itemOccurrence.status, 'todo'),
          lt(itemOccurrence.occurrenceDate, frontier),
        ),
      );
    if (candidates.length > 0) {
      const ids = candidates.map((row) => row.id);
      // Spare any whose planned block still ends now-or-later: it was rescheduled ahead,
      // so it isn't a stale past instance even though its rule anchor is early.
      const futureBlocked = await db
        .select({ occId: timeBlock.itemOccurrenceId })
        .from(timeBlock)
        .where(and(inArray(timeBlock.itemOccurrenceId, ids), gte(timeBlock.timeEnd, now)));
      const spared = new Set(futureBlocked.map((row) => row.occId));
      const toCancel = ids.filter((id) => !spared.has(id));
      if (toCancel.length > 0) {
        await db
          .update(itemOccurrence)
          .set({ status: 'cancelled', updatedBy: userId })
          .where(inArray(itemOccurrence.idItemOccurrence, toCancel));
      }
    }
  }
};

// Overdue reminders: TASK occurrences still `todo` whose `dueDate` is in the past. The
// dueDate is the SOLE deadline for any task, recurring or not — the calendar auto-links
// it to the block's end (a checkbox unlinks it for a manual deadline), so a placed task
// still goes overdue once that moment passes. No dueDate = no deadline = never overdue.
// Superseding older instances is handled in maintenance.
export const listReminders = async (workspaceId: number, userId: number, now: Date): Promise<ReminderRow[]> => {
  await runReminderMaintenance(workspaceId, userId, now);

  const rows = await db
    .select({
      occurrence: itemOccurrence,
      title: item.title,
      rrule: item.rrule,
      color: item.color,
      projectId: item.projectId,
      estimatedMinutes: item.estimatedMinutes,
    })
    .from(itemOccurrence)
    .innerJoin(item, eq(itemOccurrence.itemId, item.idItem))
    .where(and(eq(item.workspaceId, workspaceId), eq(item.type, 'task'), eq(item.generatesReminder, true), eq(itemOccurrence.status, 'todo')));

  const colorContext = await loadColorContext(workspaceId);

  const reminders: ReminderRow[] = [];
  for (const row of rows) {
    const { occurrence } = row;
    const effective = occurrence.dueDate; // the deadline, period
    if (effective === null || effective.getTime() >= now.getTime()) {
      continue;
    }
    reminders.push({
      idItemOccurrence: occurrence.idItemOccurrence,
      itemId: occurrence.itemId,
      title: row.title,
      resolvedColor: resolveItemColor({ idItem: occurrence.itemId, color: row.color, projectId: row.projectId }, colorContext),
      estimatedMinutes: row.estimatedMinutes,
      occurrenceDate: occurrence.occurrenceDate,
      dueDate: occurrence.dueDate,
      effectiveDate: effective,
      status: occurrence.status,
      isRecurrent: row.rrule !== null,
    });
  }
  return reminders;
};

// -----------------------------------------------------------------------------
//  Calendar window feed — expansion + virtual/materialized merge in one call.
// -----------------------------------------------------------------------------

export interface ItemContext {
  item: Item;
  resolvedColor: string; // full cascade, precomputed (guide §7)
  // Supersession cutoff: for a "single active instance" recurring task, any VIRTUAL slot
  // strictly before this instant is a past-and-superseded occurrence, shown as cancelled
  // (its materialized siblings are cancelled by maintenance; this covers the virtual ones
  // so they don't linger as active to-dos). null = no supersession (accumulate / one-off).
  supersedeBefore?: Date | null;
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
  placedOccurrenceIds: Set<number>, // occurrences carrying a block SOMEWHERE (maybe out of window)
  from: Date,
  to: Date,
): OccurrenceView[] => {
  const contextByItem = new Map(definitions.map((context) => [context.item.idItem, context]));
  const views: OccurrenceView[] = [];
  const emitted = new Set<number>();

  // Recurrent series: expand the window and overlay materialized rows.
  for (const { item: definition, resolvedColor, supersedeBefore } of definitions) {
    if (definition.rrule === null || definition.recurrenceStart === null) {
      continue;
    }
    const merged = mergeSlots(expandRecurrence(definition, from, to), materializedByItem.get(definition.idItem) ?? []);
    for (const entry of merged) {
      if (entry.materialized) {
        const id = entry.materialized.idItemOccurrence;
        emitted.add(id);
        // Placed OUTSIDE this window (a block exists, but none overlaps here): its real
        // spot is elsewhere, so don't fall back to drawing it at its bare rule anchor.
        const inWindowBlocks = blocksByOccurrence.get(id) ?? [];
        if (inWindowBlocks.length === 0 && placedOccurrenceIds.has(id)) {
          continue;
        }
        views.push(buildView(definition, resolvedColor, entry.materialized, blocksByOccurrence, logsByOccurrence));
      } else {
        // A past virtual slot of a "single active instance" series is superseded.
        const superseded = supersedeBefore != null && entry.occurrenceDate.getTime() < supersedeBefore.getTime();
        views.push({
          item: definition,
          resolvedColor,
          idItemOccurrence: null,
          occurrenceDate: entry.occurrenceDate,
          status: superseded ? 'cancelled' : 'todo',
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
    views.push(buildView(context.item, context.resolvedColor, occurrence, blocksByOccurrence, logsByOccurrence));
  }

  return views;
};

export const getWindowOccurrences = async (
  workspaceId: number,
  userId: number,
  from: Date,
  to: Date,
): Promise<OccurrenceView[]> => {
  const now = new Date();
  await runReminderMaintenance(workspaceId, userId, now);

  // Item definitions (+ fully-resolved color for the cascade: item -> project -> first category -> default).
  const [definitionRows, colorContext] = await Promise.all([
    db.select({ item }).from(item).where(eq(item.workspaceId, workspaceId)),
    loadColorContext(workspaceId),
  ]);
  const definitions: ItemContext[] = definitionRows.map((row) => ({
    item: row.item,
    resolvedColor: resolveItemColor(row.item, colorContext),
    // A reminder-generating, single-active-instance task supersedes past slots: anything
    // before its latest arrived slot is a stale occurrence, shown as cancelled.
    supersedeBefore:
      row.item.type === 'task' &&
      row.item.rrule !== null &&
      row.item.supersedeStaleOccurrences &&
      row.item.generatesReminder
        ? latestArrivedSlot(row.item, now)
        : null,
  }));

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

  // Which materialized-in-window occurrences carry a block ANYWHERE (maybe out of window):
  // used to suppress drawing a placed occurrence at its bare anchor when its block is elsewhere.
  const materializedIds = windowOccurrences.map((row) => row.occurrence.idItemOccurrence);
  const placedRows =
    materializedIds.length > 0
      ? await db
          .select({ occId: timeBlock.itemOccurrenceId })
          .from(timeBlock)
          .where(and(eq(timeBlock.userId, userId), inArray(timeBlock.itemOccurrenceId, materializedIds)))
      : [];
  const placedOccurrenceIds = new Set(placedRows.map((row) => row.occId));

  return assembleWindow(
    definitions,
    materializedByItem,
    occurrenceWithPlacement,
    blocksByOccurrence,
    logsByOccurrence,
    placedOccurrenceIds,
    from,
    to,
  );
};
