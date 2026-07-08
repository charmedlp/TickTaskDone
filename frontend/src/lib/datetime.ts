// Custom date helpers — no external date library (Constitution: home-made by
// default). The calendar renders on the viewer's LOCAL wall-clock: the backend
// stores absolute instants, and we display them in local time (the browser's
// timezone). Day boundaries, week/month math and the input controls are all local.
// (Unit tests pin TZ=UTC so these stay deterministic across machines.)

export type CalendarViewType = 'day' | 'week' | 'workWeek' | 'month' | 'list';

export const MINUTES_PER_DAY = 24 * 60;

export const startOfDay = (date: Date): Date => {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
};

// Add whole days keeping the local time of day (DST-safe: not a fixed 24h step).
export const addDays = (date: Date, days: number): Date => {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
};

// Days since the given week start (0 = Monday ... 6 = Sunday when weekStartsOn = 1).
const dayOffsetFromWeekStart = (date: Date, weekStartsOn: number): number => (date.getDay() - weekStartsOn + 7) % 7;

// Start of the week containing `date`. weekStartsOn: 0 = Sunday, 1 = Monday (default).
export const startOfWeek = (date: Date, weekStartsOn = 1): Date =>
  startOfDay(addDays(date, -dayOffsetFromWeekStart(date, weekStartsOn)));

export const startOfMonth = (date: Date): Date => {
  const result = startOfDay(date);
  result.setDate(1);
  return result;
};

export const addMonths = (date: Date, months: number): Date => {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
};

// Minutes elapsed since the start of `date`'s local day (used for vertical placement).
export const minutesSinceStartOfDay = (date: Date): number => date.getHours() * 60 + date.getMinutes();

export interface DateWindow {
  from: Date;
  to: Date; // exclusive upper bound
}

// The [from, to) range a view fetches and paints, given its anchor date.
// - workWeek is always Monday-anchored and spans Monday..Friday (5 days).
// - month spans whole weeks so the grid is rectangular.
export const windowForView = (view: CalendarViewType, anchor: Date, weekStartsOn = 1): DateWindow => {
  switch (view) {
    case 'day':
      return { from: startOfDay(anchor), to: addDays(startOfDay(anchor), 1) };
    case 'week': {
      const from = startOfWeek(anchor, weekStartsOn);
      return { from, to: addDays(from, 7) };
    }
    // The List is an "upcoming" view: from the anchor day forward (a year horizon),
    // then paginated by count client-side.
    case 'list': {
      const from = startOfDay(anchor);
      return { from, to: addDays(from, 366) };
    }
    case 'workWeek': {
      const from = startOfWeek(anchor, 1);
      return { from, to: addDays(from, 5) };
    }
    case 'month': {
      const from = startOfWeek(startOfMonth(anchor), weekStartsOn);
      const monthEnd = addDays(addMonths(startOfMonth(anchor), 1), -1);
      const to = addDays(startOfWeek(monthEnd, weekStartsOn), 7);
      return { from, to };
    }
  }
};

// Ordered list of day starts covered by [from, to).
export const daysInWindow = (window: DateWindow): Date[] => {
  const days: Date[] = [];
  for (let day = startOfDay(window.from); day < window.to; day = addDays(day, 1)) {
    days.push(day);
  }
  return days;
};

// <input type="datetime-local"> helpers — the control's value is the LOCAL wall-clock.
const pad = (value: number): string => String(value).padStart(2, '0');

export const toDateTimeInputValue = (date: Date): string =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;

export const fromDateTimeInputValue = (value: string): Date => new Date(value); // parsed as local

// <input type="date"> helpers (local, like the datetime ones).
export const toDateInputValue = (date: Date): string =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

export const fromDateInputValue = (value: string): Date => new Date(`${value}T00:00:00`); // local midnight

// Step the anchor by one unit of the given view (previous/next navigation).
export const stepAnchor = (view: CalendarViewType, anchor: Date, direction: 1 | -1): Date => {
  switch (view) {
    case 'day':
      return addDays(anchor, direction);
    case 'week':
    case 'workWeek':
    case 'list':
      return addDays(anchor, 7 * direction);
    case 'month':
      return addMonths(anchor, direction);
  }
};

// The viewer's IANA timezone, sent to the backend so it can store wall-clock intent
// (DST-correct recurrence). All-day items store no timezone (they float).
export const browserTimezone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;
