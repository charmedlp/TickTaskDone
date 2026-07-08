import { describe, expect, it } from 'vitest';
import type { OccurrenceViewDto, TimeBlockDto, TimeLogDto } from '@ticktaskdone/shared';
import { toCalendarBlocks } from './renderables';

const block = (overrides: Partial<TimeBlockDto> = {}): TimeBlockDto => ({
  idTimeBlock: 1,
  itemOccurrenceId: 10,
  userId: 1,
  timeStart: '2026-07-14T13:00:00.000Z',
  timeEnd: '2026-07-14T14:00:00.000Z',
  allDay: false,
  isBlocking: false,
  timezone: 'America/Montreal',
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
  ...overrides,
});

const log = (overrides: Partial<TimeLogDto> = {}): TimeLogDto => ({
  idTimeLog: 1,
  itemOccurrenceId: 10,
  userId: 1,
  startedAt: '2026-07-14T15:00:00.000Z',
  endedAt: '2026-07-14T15:45:00.000Z',
  source: 'timer',
  timezone: 'America/Montreal',
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
  ...overrides,
});

const occurrence = (overrides: Partial<OccurrenceViewDto> = {}): OccurrenceViewDto => ({
  itemId: 1,
  type: 'task',
  title: 'Task',
  projectId: null,
  resolvedColor: '#333',
  estimatedMinutes: null,
  timezone: 'America/Montreal',
  isRecurrent: false,
  idItemOccurrence: 10,
  occurrenceDate: null,
  status: 'todo',
  dueDate: null,
  materialized: true,
  timeBlocks: [],
  timeLogs: [],
  ...overrides,
});

describe('toCalendarBlocks — planned vs actual', () => {
  it('planned renders a task from its timeBlocks, not its logs', () => {
    const occ = occurrence({ timeBlocks: [block()], timeLogs: [log()] });
    const blocks = toCalendarBlocks([occ], 'planned');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].timeBlockId).toBe(1);
    expect(blocks[0].timeLogId).toBeNull();
    expect(blocks[0].start.toISOString()).toBe('2026-07-14T13:00:00.000Z');
  });

  it('actual renders a task from its timeLogs, not its timeBlocks', () => {
    const occ = occurrence({ timeBlocks: [block()], timeLogs: [log()] });
    const blocks = toCalendarBlocks([occ], 'actual');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].timeLogId).toBe(1);
    expect(blocks[0].timeBlockId).toBeNull();
    expect(blocks[0].start.toISOString()).toBe('2026-07-14T15:00:00.000Z');
    expect(blocks[0].end.toISOString()).toBe('2026-07-14T15:45:00.000Z');
  });

  it('an event renders identically in both views (from its timeBlocks)', () => {
    const occ = occurrence({ type: 'event', title: 'Meeting', timeBlocks: [block()], timeLogs: [] });
    const planned = toCalendarBlocks([occ], 'planned');
    const actual = toCalendarBlocks([occ], 'actual');
    expect(actual).toHaveLength(1);
    expect(actual[0].timeBlockId).toBe(planned[0].timeBlockId);
    expect(actual[0].start.toISOString()).toBe(planned[0].start.toISOString());
  });

  it('a task with no logs shows nothing in the actual view', () => {
    const occ = occurrence({ timeBlocks: [block()], timeLogs: [] });
    expect(toCalendarBlocks([occ], 'actual')).toHaveLength(0);
  });

  it('draws a running segment (null endedAt) up to `now`', () => {
    const now = new Date('2026-07-14T16:10:00.000Z');
    const occ = occurrence({ timeLogs: [log({ endedAt: null })] });
    const blocks = toCalendarBlocks([occ], 'actual', now);
    expect(blocks[0].end.toISOString()).toBe('2026-07-14T16:10:00.000Z');
  });
});
