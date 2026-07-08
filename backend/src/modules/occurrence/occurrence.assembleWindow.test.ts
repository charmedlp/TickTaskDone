import { describe, expect, it } from 'vitest';
import type { Item, ItemOccurrence, TimeBlock, TimeLog } from '../../db/schema';
import { assembleWindow, type ItemContext } from './occurrence.service';

// UTC helpers keep assertions timezone-independent.
const utc = (year: number, month: number, day: number, hour = 9): Date =>
  new Date(Date.UTC(year, month - 1, day, hour, 0, 0));

const makeItem = (overrides: Partial<Item>): Item => ({
  idItem: 1,
  workspaceId: 7,
  type: 'task',
  projectId: null,
  title: 'Item',
  description: null,
  color: null,
  estimatedMinutes: null,
  rrule: null,
  recurrenceStart: null,
  timezone: null,
  createdAt: utc(2026, 1, 1),
  updatedAt: utc(2026, 1, 1),
  createdBy: 1,
  updatedBy: 1,
  ...overrides,
});

const makeOccurrence = (overrides: Partial<ItemOccurrence>): ItemOccurrence => ({
  idItemOccurrence: 100,
  itemId: 1,
  occurrenceDate: null,
  status: 'todo',
  dueDate: null,
  createdAt: utc(2026, 1, 1),
  updatedAt: utc(2026, 1, 1),
  createdBy: 1,
  updatedBy: 1,
  ...overrides,
});

const makeBlock = (overrides: Partial<TimeBlock>): TimeBlock => ({
  idTimeBlock: 500,
  itemOccurrenceId: 100,
  userId: 1,
  timeStart: utc(2026, 1, 5, 9),
  timeEnd: utc(2026, 1, 5, 10),
  allDay: false,
  isBlocking: false,
  timezone: null,
  createdAt: utc(2026, 1, 1),
  updatedAt: utc(2026, 1, 1),
  createdBy: 1,
  updatedBy: 1,
  ...overrides,
});

const makeLog = (overrides: Partial<TimeLog>): TimeLog => ({
  idTimeLog: 900,
  itemOccurrenceId: 100,
  userId: 1,
  startedAt: utc(2026, 1, 5, 9),
  endedAt: utc(2026, 1, 5, 10),
  source: 'timer',
  timezone: null,
  createdAt: utc(2026, 1, 1),
  updatedAt: utc(2026, 1, 1),
  createdBy: 1,
  updatedBy: 1,
  ...overrides,
});

const context = (item: Item, projectColor: string | null = null): ItemContext => ({ item, projectColor });

const from = utc(2026, 1, 1, 0);
const to = utc(2026, 2, 1, 0);

describe('assembleWindow', () => {
  it('emits one virtual view per expanded slot, each with a null id', () => {
    const recurrent = makeItem({ idItem: 1, rrule: 'FREQ=WEEKLY;COUNT=3', recurrenceStart: utc(2026, 1, 5, 9) });
    const views = assembleWindow([context(recurrent)], new Map(), new Map(), new Map(), new Map(), from, to);

    expect(views).toHaveLength(3);
    expect(views.every((view) => view.idItemOccurrence === null && !view.materialized)).toBe(true);
    // Distinct virtuals are NOT collapsed despite all carrying a null id.
    expect(views.map((view) => view.occurrenceDate?.toISOString())).toEqual([
      '2026-01-05T09:00:00.000Z',
      '2026-01-12T09:00:00.000Z',
      '2026-01-19T09:00:00.000Z',
    ]);
  });

  it('lets a materialized row mask the virtual on its slot (no duplicate)', () => {
    const recurrent = makeItem({ idItem: 1, rrule: 'FREQ=WEEKLY;COUNT=3', recurrenceStart: utc(2026, 1, 5, 9) });
    const done = makeOccurrence({ idItemOccurrence: 100, itemId: 1, occurrenceDate: utc(2026, 1, 12, 9), status: 'done' });

    const views = assembleWindow(
      [context(recurrent)],
      new Map([[1, [done]]]),
      new Map(),
      new Map(),
      new Map(),
      from,
      to,
    );

    expect(views).toHaveLength(3); // still 3 slots, not 4
    const secondSlot = views.find((view) => view.occurrenceDate?.toISOString() === '2026-01-12T09:00:00.000Z');
    expect(secondSlot?.materialized).toBe(true);
    expect(secondSlot?.idItemOccurrence).toBe(100);
    expect(secondSlot?.status).toBe('done');
  });

  it('attaches the current user blocks to their materialized occurrence', () => {
    const recurrent = makeItem({ idItem: 1, rrule: 'FREQ=WEEKLY;COUNT=1', recurrenceStart: utc(2026, 1, 5, 9) });
    const occ = makeOccurrence({ idItemOccurrence: 100, itemId: 1, occurrenceDate: utc(2026, 1, 5, 9) });
    const block = makeBlock({ idTimeBlock: 500, itemOccurrenceId: 100 });

    const views = assembleWindow(
      [context(recurrent)],
      new Map([[1, [occ]]]),
      new Map(),
      new Map([[100, [block]]]),
      new Map(),
      from,
      to,
    );

    expect(views[0].timeBlocks).toHaveLength(1);
    expect(views[0].timeBlocks[0].idTimeBlock).toBe(500);
  });

  it('catches up a non-recurrent scheduled occurrence (slot not in expansion)', () => {
    const event = makeItem({ idItem: 2, type: 'event', title: 'Meeting' }); // non-recurrent
    const occ = makeOccurrence({ idItemOccurrence: 200, itemId: 2, occurrenceDate: null });
    const block = makeBlock({ idTimeBlock: 600, itemOccurrenceId: 200, timeStart: utc(2026, 1, 8, 14), timeEnd: utc(2026, 1, 8, 15) });

    const views = assembleWindow(
      [context(event)],
      new Map(),
      new Map([[200, occ]]),
      new Map([[200, [block]]]),
      new Map(),
      from,
      to,
    );

    expect(views).toHaveLength(1);
    expect(views[0].idItemOccurrence).toBe(200);
    expect(views[0].materialized).toBe(true);
    expect(views[0].timeBlocks[0].idTimeBlock).toBe(600);
  });

  it('does not double-emit a materialized recurring slot that also has an in-window block', () => {
    const recurrent = makeItem({ idItem: 1, rrule: 'FREQ=WEEKLY;COUNT=1', recurrenceStart: utc(2026, 1, 5, 9) });
    const occ = makeOccurrence({ idItemOccurrence: 100, itemId: 1, occurrenceDate: utc(2026, 1, 5, 9) });
    const block = makeBlock({ idTimeBlock: 500, itemOccurrenceId: 100 });

    const views = assembleWindow(
      [context(recurrent)],
      new Map([[1, [occ]]]),
      new Map([[100, occ]]), // same occurrence surfaced by the block query
      new Map([[100, [block]]]),
      new Map(),
      from,
      to,
    );

    // Present in BOTH the merge pass and the catch-up map, but emitted once.
    expect(views).toHaveLength(1);
    expect(views[0].idItemOccurrence).toBe(100);
  });

  it('skips a non-recurrent item that has no block (backlog stays out of the feed)', () => {
    const task = makeItem({ idItem: 3, title: 'Unscheduled' });
    const views = assembleWindow([context(task)], new Map(), new Map(), new Map(), new Map(), from, to);
    expect(views).toEqual([]);
  });

  it('attaches the current user time logs to their materialized occurrence', () => {
    const task = makeItem({ idItem: 1, title: 'Focus' }); // non-recurrent
    const occ = makeOccurrence({ idItemOccurrence: 100, itemId: 1, occurrenceDate: null });
    const block = makeBlock({ idTimeBlock: 500, itemOccurrenceId: 100 });
    const log = makeLog({ idTimeLog: 900, itemOccurrenceId: 100 });

    const views = assembleWindow(
      [context(task)],
      new Map(),
      new Map([[100, occ]]),
      new Map([[100, [block]]]),
      new Map([[100, [log]]]),
      from,
      to,
    );

    expect(views).toHaveLength(1);
    expect(views[0].timeLogs).toHaveLength(1);
    expect(views[0].timeLogs[0].idTimeLog).toBe(900);
  });

  it('catches up an occurrence surfaced only by an in-window log (no block)', () => {
    const task = makeItem({ idItem: 4, title: 'Logged only' });
    const occ = makeOccurrence({ idItemOccurrence: 400, itemId: 4, occurrenceDate: null });
    const log = makeLog({ idTimeLog: 950, itemOccurrenceId: 400, startedAt: utc(2026, 1, 8, 14), endedAt: utc(2026, 1, 8, 15) });

    const views = assembleWindow(
      [context(task)],
      new Map(),
      new Map([[400, occ]]), // surfaced by the log query, not a block
      new Map(),
      new Map([[400, [log]]]),
      from,
      to,
    );

    expect(views).toHaveLength(1);
    expect(views[0].idItemOccurrence).toBe(400);
    expect(views[0].timeBlocks).toHaveLength(0);
    expect(views[0].timeLogs[0].idTimeLog).toBe(950);
  });
});
