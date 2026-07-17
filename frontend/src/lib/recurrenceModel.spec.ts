import { describe, expect, it } from 'vitest';
import { buildRrule, emptyRecurrence, parseRrule } from './recurrenceModel';

describe('recurrenceModel', () => {
  it('builds a plain weekly rule with no BYDAY when no weekdays are chosen', () => {
    expect(buildRrule({ freq: 'weekly', interval: 1, count: null, weekdays: [] })).toBe('FREQ=WEEKLY;INTERVAL=1');
  });

  it('emits BYDAY for a weekly rule on specific days, in week order', () => {
    // Chosen out of order — must serialize Mo…Su.
    expect(buildRrule({ freq: 'weekly', interval: 1, count: null, weekdays: ['SA', 'TU'] })).toBe(
      'FREQ=WEEKLY;INTERVAL=1;BYDAY=TU,SA',
    );
  });

  it('emits BYDAY only for weekly (ignored for daily/monthly)', () => {
    expect(buildRrule({ freq: 'monthly', interval: 1, count: null, weekdays: ['MO'] })).toBe('FREQ=MONTHLY;INTERVAL=1');
  });

  it('round-trips a weekday rule through parse', () => {
    const model = parseRrule('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR;COUNT=6');
    expect(model).toEqual({ freq: 'weekly', interval: 2, count: 6, weekdays: ['MO', 'WE', 'FR'] });
  });

  it('parses a rule with no BYDAY to an empty weekday set', () => {
    expect(parseRrule('FREQ=WEEKLY').weekdays).toEqual([]);
  });

  it('returns an empty (non-recurring) model for a null rule', () => {
    expect(parseRrule(null)).toEqual(emptyRecurrence());
  });
});
