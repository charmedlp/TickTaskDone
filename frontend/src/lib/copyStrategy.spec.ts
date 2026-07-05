import { describe, expect, it } from 'vitest';
import { resolveCopyStrategy, type CopySource } from './copyStrategy';

const source = (overrides: Partial<CopySource>): CopySource => ({
  type: 'task',
  status: 'todo',
  isRecurrent: false,
  projectId: 5,
  ...overrides,
});

describe('resolveCopyStrategy (brief §2 tree)', () => {
  it('1. an event is always a simple copy — even recurrent', () => {
    expect(resolveCopyStrategy(source({ type: 'event' }))).toBe('simpleCopy');
    expect(resolveCopyStrategy(source({ type: 'event', isRecurrent: true }))).toBe('simpleCopy');
  });

  it('2. a done/cancelled non-recurrent task is a simple copy', () => {
    expect(resolveCopyStrategy(source({ status: 'done' }))).toBe('simpleCopy');
    expect(resolveCopyStrategy(source({ status: 'cancelled' }))).toBe('simpleCopy');
  });

  it('3. a recurrent task becomes a custom off-rule occurrence — regardless of status/project', () => {
    expect(resolveCopyStrategy(source({ isRecurrent: true }))).toBe('customOccurrence');
    // A recurrent done task still routes to customOccurrence (rule 2 excludes recurrent).
    expect(resolveCopyStrategy(source({ isRecurrent: true, status: 'done' }))).toBe('customOccurrence');
    expect(resolveCopyStrategy(source({ isRecurrent: true, projectId: null }))).toBe('customOccurrence');
  });

  it('4. an ephemeral (no project) active non-recurrent task is a simple copy', () => {
    expect(resolveCopyStrategy(source({ projectId: null }))).toBe('simpleCopy');
  });

  it('5. an active non-recurrent project task splits (extra block on the same occurrence)', () => {
    expect(resolveCopyStrategy(source({ projectId: 5, status: 'todo' }))).toBe('split');
    expect(resolveCopyStrategy(source({ projectId: 5, status: 'doing' }))).toBe('split');
  });
});
