import type { CalendarViewType, DateWindow } from './datetime';
import { addDays } from './datetime';
import { intlLocaleTag } from '@/i18n';

// All formatting is LOCAL (see datetime.ts): the grid renders on the viewer's
// wall-clock. Formatters follow the active UI locale (i18n brief §2.1) — `intlLocaleTag`
// reads the reactive i18n locale, so date labels re-render when the language changes.
// (Tests pin TZ=UTC; the default locale is English.)

// Intl formatters are cached per (locale tag + shape); a locale switch just uses a new key.
const cache = new Map<string, Intl.DateTimeFormat>();
const formatter = (shape: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat => {
  const key = `${intlLocaleTag()}|${shape}`;
  let existing = cache.get(key);
  if (!existing) {
    existing = new Intl.DateTimeFormat(intlLocaleTag(), options);
    cache.set(key, existing);
  }
  return existing;
};

const DAY_HEADER: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' };
const DAY_TITLE: Intl.DateTimeFormatOptions = { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' };
const MONTH_TITLE: Intl.DateTimeFormatOptions = { month: 'long', year: 'numeric' };
const LONG_DATE: Intl.DateTimeFormatOptions = { month: 'long', day: 'numeric', year: 'numeric' };
const TIME: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hour12: false };
const MONTH_DAY: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };

const sameLocalDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export const formatDayHeader = (day: Date): string => formatter('dayHeader', DAY_HEADER).format(day);

export const formatFullDay = (day: Date): string => formatter('dayTitle', DAY_TITLE).format(day);

export const formatHourLabel = (hour: number): string => `${String(hour).padStart(2, '0')}:00`;

export const formatTime = (date: Date): string => formatter('time', TIME).format(date);

// Same day -> just the times ("16:00–17:00"); a multi-day span carries each date so
// the label stays meaningful ("Jul 8 16:00 – Jul 10 13:00").
export const formatTimeRange = (start: Date, end: Date): string =>
  sameLocalDay(start, end)
    ? `${formatTime(start)}–${formatTime(end)}`
    : `${formatter('monthDay', MONTH_DAY).format(start)} ${formatTime(start)} – ${formatter('monthDay', MONTH_DAY).format(end)} ${formatTime(end)}`;

// Header title describing the current window.
export const formatWindowTitle = (view: CalendarViewType, window: DateWindow): string => {
  if (view === 'day') {
    return formatter('dayTitle', DAY_TITLE).format(window.from);
  }
  if (view === 'month') {
    // Title the month that owns most of the grid (the 15th is always inside it).
    return formatter('monthTitle', MONTH_TITLE).format(addDays(window.from, 15));
  }
  if (view === 'list') {
    return `${formatter('longDate', LONG_DATE).format(window.from)}`;
  }
  const lastDay = addDays(window.to, -1);
  return `${formatDayHeader(window.from)} – ${formatDayHeader(lastDay)}, ${lastDay.getFullYear()}`;
};
