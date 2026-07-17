import { and, eq } from 'drizzle-orm';
import type { CreateItemOccurrenceInput, OccurrenceStatus, UpdateItemOccurrenceInput } from '@ticktaskdone/shared';
import { db } from '../../db/db';
import { itemOccurrence, timeBlock, type Item, type ItemOccurrence, type TimeBlock } from '../../db/schema';
import { slotsBefore, slotsFrom } from '../../domain/recurrence';

// Scoped by itemId (the parent item's workspace membership is checked upstream by
// `loadItem`). Order follows LRCUD.

export const listItemOccurrences = (itemId: number): Promise<ItemOccurrence[]> =>
  db.select().from(itemOccurrence).where(eq(itemOccurrence.itemId, itemId));

// One planned moment of a task (brief §3.1): a materialized occurrence with the user's
// blocks, OR an upcoming virtual slot (recurrent task, not materialized yet — no id,
// no blocks). Its start is `occurrenceDate`; the caller derives duration from the item.
export interface ItemMoment {
  idItemOccurrence: number | null;
  occurrenceDate: Date | null;
  status: OccurrenceStatus;
  dueDate: Date | null;
  timeBlocks: TimeBlock[];
  materialized: boolean;
}

// One page of planned moments. A recurrent series is potentially infinite, so we page
// by a date cursor rather than an offset — no total, no page number.
export interface MomentsPage {
  moments: ItemMoment[];
  hasPrev: boolean;
  hasNext: boolean;
  // True when a next event (occurrence >= now) exists AND is not already on this page —
  // i.e. a "jump to next event" shortcut would actually take you somewhere.
  canJumpToUpcoming: boolean;
}

// A page request: `start` = the series' first window; `upcoming` = the window holding
// the next event from now; `next`/`prev` step forward/backward from the given cursor
// (the last/first occurrenceDate of the page the client is on).
export interface MomentsPageQuery {
  direction: 'start' | 'upcoming' | 'next' | 'prev';
  cursor: Date | null;
}

// How many rule slots make up one page.
const PAGE_SIZE = 10;

const byDate = (left: ItemMoment, right: ItemMoment): number =>
  (left.occurrenceDate?.getTime() ?? 0) - (right.occurrenceDate?.getTime() ?? 0);

// All planned moments of a task, paginated. A non-recurrent task returns its single
// occurrence's moments in one page (both flags false). A recurrent task's occurrences
// form ONE ascending stream (rule slots ∪ materialized deviations) — `start` opens at
// the series' first occurrence, and next/prev walk it contiguously with cursor flags.
// Past and upcoming are never split apart; they just fall on adjacent pages.
export const listItemMoments = async (
  item: Item,
  userId: number,
  page: MomentsPageQuery = { direction: 'start', cursor: null },
): Promise<MomentsPage> => {
  const occurrences = await db.select().from(itemOccurrence).where(eq(itemOccurrence.itemId, item.idItem));
  const blockRows = await db
    .select({ block: timeBlock })
    .from(timeBlock)
    .innerJoin(itemOccurrence, eq(timeBlock.itemOccurrenceId, itemOccurrence.idItemOccurrence))
    .where(and(eq(itemOccurrence.itemId, item.idItem), eq(timeBlock.userId, userId)));

  const blocksByOccurrence = new Map<number, TimeBlock[]>();
  for (const { block } of blockRows) {
    const list = blocksByOccurrence.get(block.itemOccurrenceId) ?? [];
    list.push(block);
    blocksByOccurrence.set(block.itemOccurrenceId, list);
  }
  const toMaterializedMoment = (occurrence: ItemOccurrence): ItemMoment => ({
    idItemOccurrence: occurrence.idItemOccurrence,
    occurrenceDate: occurrence.occurrenceDate,
    status: occurrence.status,
    dueDate: occurrence.dueDate,
    timeBlocks: blocksByOccurrence.get(occurrence.idItemOccurrence) ?? [],
    materialized: true,
  });

  // Non-recurrent: the single occurrence (+ its split blocks). No pagination.
  if (item.rrule === null || item.recurrenceStart === null) {
    return {
      moments: occurrences.map(toMaterializedMoment).sort(byDate),
      hasPrev: false,
      hasNext: false,
      canJumpToUpcoming: false,
    };
  }

  const materializedByTs = new Map<number, ItemOccurrence>();
  for (const occurrence of occurrences) {
    if (occurrence.occurrenceDate !== null) {
      materializedByTs.set(occurrence.occurrenceDate.getTime(), occurrence);
    }
  }

  // The occurrence stream = rule slots ∪ materialized occurrence dates (so off-rule
  // custom occurrences, e.g. an anchor that doesn't match the rule, page correctly and
  // are never stranded). We page over the merged, deduped, sorted timeline.
  const materializedDates = occurrences
    .map((occurrence) => occurrence.occurrenceDate)
    .filter((date): date is Date => date !== null)
    .map((date) => date.getTime());
  const anyBefore = (ts: number): boolean =>
    slotsBefore(item, new Date(ts), 1).length > 0 || materializedDates.some((value) => value < ts);
  const anyAfter = (ts: number): boolean =>
    slotsFrom(item, new Date(ts), 1, false).length > 0 || materializedDates.some((value) => value > ts);
  const uniqueSorted = (values: number[]): number[] => [...new Set(values)].sort((left, right) => left - right);

  const now = new Date();
  let pageMs: number[];
  if (page.direction === 'prev' && page.cursor !== null) {
    const cursorMs = page.cursor.getTime();
    const candidates = uniqueSorted([
      ...slotsBefore(item, page.cursor, PAGE_SIZE).map((date) => date.getTime()),
      ...materializedDates.filter((value) => value < cursorMs),
    ]);
    pageMs = candidates.slice(-PAGE_SIZE); // the latest window before the cursor
  } else if (page.direction === 'next' && page.cursor !== null) {
    const cursorMs = page.cursor.getTime();
    const candidates = uniqueSorted([
      ...slotsFrom(item, page.cursor, PAGE_SIZE, false).map((date) => date.getTime()),
      ...materializedDates.filter((value) => value > cursorMs),
    ]);
    pageMs = candidates.slice(0, PAGE_SIZE);
  } else if (page.direction === 'upcoming') {
    // The window that opens at the next event from now (a shortcut back to what's coming).
    const nowMs = now.getTime();
    const upcoming = uniqueSorted([
      ...slotsFrom(item, now, PAGE_SIZE).map((date) => date.getTime()),
      ...materializedDates.filter((value) => value >= nowMs),
    ]);
    if (upcoming.length > 0) {
      pageMs = upcoming.slice(0, PAGE_SIZE);
    } else {
      // A finished series (nothing upcoming): degrade to the latest window.
      const past = uniqueSorted([
        ...slotsBefore(item, now, PAGE_SIZE).map((date) => date.getTime()),
        ...materializedDates.filter((value) => value < nowMs),
      ]);
      pageMs = past.slice(-PAGE_SIZE);
    }
  } else {
    // The very first window: the whole series is one ascending list (past materialized
    // and upcoming together), so we start at the earliest occurrence, not at "now".
    const firstSlotMs = slotsFrom(item, item.recurrenceStart, 1)[0]?.getTime() ?? item.recurrenceStart.getTime();
    const startMs = materializedDates.reduce((min, value) => Math.min(min, value), firstSlotMs);
    const candidates = uniqueSorted([
      ...slotsFrom(item, new Date(startMs), PAGE_SIZE).map((date) => date.getTime()),
      ...materializedDates.filter((value) => value >= startMs),
    ]);
    pageMs = candidates.slice(0, PAGE_SIZE);
  }

  const moments: ItemMoment[] = pageMs.map((ts) => {
    const materialized = materializedByTs.get(ts);
    return materialized
      ? toMaterializedMoment(materialized)
      : { idItemOccurrence: null, occurrenceDate: new Date(ts), status: 'todo', dueDate: null, timeBlocks: [], materialized: false };
  });

  // Arrows reflect the actual stream: live only when a real occurrence exists past the edge.
  const hasPrev = pageMs.length > 0 && anyBefore(pageMs[0]);
  const hasNext = pageMs.length > 0 && anyAfter(pageMs[pageMs.length - 1]);

  // The next event = the earliest occurrence >= now (rule slot or materialized). The
  // "jump to next event" shortcut is only useful if one exists AND it is not on this page.
  const nowMs = now.getTime();
  const nextEventMs = Math.min(
    slotsFrom(item, now, 1)[0]?.getTime() ?? Number.POSITIVE_INFINITY,
    materializedDates.reduce((min, value) => (value >= nowMs ? Math.min(min, value) : min), Number.POSITIVE_INFINITY),
  );
  const canJumpToUpcoming = Number.isFinite(nextEventMs) && !pageMs.includes(nextEventMs);

  return { moments, hasPrev, hasNext, canJumpToUpcoming };
};

export const readItemOccurrence = async (itemId: number, idItemOccurrence: number): Promise<ItemOccurrence | undefined> => {
  const [row] = await db
    .select()
    .from(itemOccurrence)
    .where(and(eq(itemOccurrence.itemId, itemId), eq(itemOccurrence.idItemOccurrence, idItemOccurrence)))
    .limit(1);
  return row;
};

export const createItemOccurrence = (
  itemId: number,
  userId: number,
  input: CreateItemOccurrenceInput,
): Promise<ItemOccurrence> =>
  db.transaction(async (transaction) => {
    const [{ idItemOccurrence }] = await transaction
      .insert(itemOccurrence)
      .values({
        itemId,
        occurrenceDate: input.occurrenceDate,
        status: input.status,
        dueDate: input.dueDate,
        createdBy: userId,
        updatedBy: userId,
      })
      .$returningId();

    const [row] = await transaction
      .select()
      .from(itemOccurrence)
      .where(eq(itemOccurrence.idItemOccurrence, idItemOccurrence))
      .limit(1);
    return row;
  });

export const updateItemOccurrence = (
  itemId: number,
  userId: number,
  idItemOccurrence: number,
  input: UpdateItemOccurrenceInput,
): Promise<ItemOccurrence | undefined> =>
  db.transaction(async (transaction) => {
    await transaction
      .update(itemOccurrence)
      .set({ ...input, updatedBy: userId })
      .where(and(eq(itemOccurrence.itemId, itemId), eq(itemOccurrence.idItemOccurrence, idItemOccurrence)));

    const [row] = await transaction
      .select()
      .from(itemOccurrence)
      .where(and(eq(itemOccurrence.itemId, itemId), eq(itemOccurrence.idItemOccurrence, idItemOccurrence)))
      .limit(1);
    return row;
  });

export const deleteItemOccurrence = async (itemId: number, idItemOccurrence: number): Promise<boolean> => {
  const [result] = await db
    .delete(itemOccurrence)
    .where(and(eq(itemOccurrence.itemId, itemId), eq(itemOccurrence.idItemOccurrence, idItemOccurrence)));
  return result.affectedRows > 0;
};
