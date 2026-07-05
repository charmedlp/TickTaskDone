// Minimal recurrence model for the form (a full RFC 5545 editor is a later
// refinement). Covers none / daily / weekly / monthly with an interval and an
// optional occurrence count; maps to and from the rrule string stored on item.
export type Frequency = 'none' | 'daily' | 'weekly' | 'monthly';

export interface RecurrenceModel {
  freq: Frequency;
  interval: number;
  count: number | null;
}

export const emptyRecurrence = (): RecurrenceModel => ({ freq: 'none', interval: 1, count: null });

const FREQ_TO_RRULE: Record<Exclude<Frequency, 'none'>, string> = {
  daily: 'DAILY',
  weekly: 'WEEKLY',
  monthly: 'MONTHLY',
};

export const buildRrule = (model: RecurrenceModel): string | null => {
  if (model.freq === 'none') {
    return null;
  }
  const parts = [`FREQ=${FREQ_TO_RRULE[model.freq]}`, `INTERVAL=${Math.max(1, model.interval)}`];
  if (model.count !== null && model.count > 0) {
    parts.push(`COUNT=${model.count}`);
  }
  return parts.join(';');
};

export const parseRrule = (rrule: string | null): RecurrenceModel => {
  if (!rrule) {
    return emptyRecurrence();
  }
  const params = new Map<string, string>();
  for (const part of rrule.split(';')) {
    const equals = part.indexOf('=');
    if (equals > 0) {
      params.set(part.slice(0, equals), part.slice(equals + 1));
    }
  }
  const rawFreq = params.get('FREQ');
  const freq: Frequency =
    rawFreq === 'DAILY' ? 'daily' : rawFreq === 'WEEKLY' ? 'weekly' : rawFreq === 'MONTHLY' ? 'monthly' : 'none';
  const interval = Number(params.get('INTERVAL') ?? '1');
  const rawCount = params.get('COUNT');
  return {
    freq,
    interval: Number.isFinite(interval) && interval > 0 ? interval : 1,
    count: rawCount !== undefined ? Number(rawCount) : null,
  };
};
