// Minimal recurrence model for the form (a full RFC 5545 editor is a later
// refinement). Covers none / daily / weekly / monthly with an interval, an optional
// occurrence count, and — for weekly — a set of weekdays (BYDAY, e.g. Tue+Sat or
// Mon–Fri). Maps to and from the rrule string stored on item.
export type Frequency = 'none' | 'daily' | 'weekly' | 'monthly';

// RFC 5545 two-letter weekday codes, in week order.
export type Weekday = 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'SU';
export const WEEKDAYS: { value: Weekday; label: string }[] = [
  { value: 'MO', label: 'Mo' },
  { value: 'TU', label: 'Tu' },
  { value: 'WE', label: 'We' },
  { value: 'TH', label: 'Th' },
  { value: 'FR', label: 'Fr' },
  { value: 'SA', label: 'Sa' },
  { value: 'SU', label: 'Su' },
];
const WEEKDAY_SET = new Set<string>(WEEKDAYS.map((day) => day.value));

export interface RecurrenceModel {
  freq: Frequency;
  interval: number;
  count: number | null;
  weekdays: Weekday[]; // only meaningful for weekly; empty = the anchor's own weekday
}

export const emptyRecurrence = (): RecurrenceModel => ({ freq: 'none', interval: 1, count: null, weekdays: [] });

const FREQ_TO_RRULE: Record<Exclude<Frequency, 'none'>, string> = {
  daily: 'DAILY',
  weekly: 'WEEKLY',
  monthly: 'MONTHLY',
};

// Keep an emitted BYDAY set in canonical week order.
const orderWeekdays = (weekdays: Weekday[]): Weekday[] =>
  WEEKDAYS.map((day) => day.value).filter((value) => weekdays.includes(value));

export const buildRrule = (model: RecurrenceModel): string | null => {
  if (model.freq === 'none') {
    return null;
  }
  const parts = [`FREQ=${FREQ_TO_RRULE[model.freq]}`, `INTERVAL=${Math.max(1, model.interval)}`];
  if (model.freq === 'weekly' && model.weekdays.length > 0) {
    parts.push(`BYDAY=${orderWeekdays(model.weekdays).join(',')}`);
  }
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
      params.set(part.slice(0, equals).toUpperCase(), part.slice(equals + 1));
    }
  }
  const rawFreq = params.get('FREQ');
  const freq: Frequency =
    rawFreq === 'DAILY' ? 'daily' : rawFreq === 'WEEKLY' ? 'weekly' : rawFreq === 'MONTHLY' ? 'monthly' : 'none';
  const interval = Number(params.get('INTERVAL') ?? '1');
  const rawCount = params.get('COUNT');
  const rawByday = params.get('BYDAY');
  const weekdays = rawByday
    ? (rawByday.split(',').map((code) => code.trim().toUpperCase()).filter((code) => WEEKDAY_SET.has(code)) as Weekday[])
    : [];
  return {
    freq,
    interval: Number.isFinite(interval) && interval > 0 ? interval : 1,
    count: rawCount !== undefined ? Number(rawCount) : null,
    weekdays: orderWeekdays(weekdays),
  };
};
