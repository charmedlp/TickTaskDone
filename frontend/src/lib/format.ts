import type { CalendarViewType, DateWindow } from './datetime';
import { addDays } from './datetime';

// All formatting is LOCAL (see datetime.ts): the grid renders on the viewer's
// wall-clock. (The default Intl timezone is the browser's; tests pin TZ=UTC.)

const dayHeaderFormatter = new Intl.DateTimeFormat('en-CA', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
});

const dayTitleFormatter = new Intl.DateTimeFormat('en-CA', {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  year: 'numeric',
});

const monthTitleFormatter = new Intl.DateTimeFormat('en-CA', { month: 'long', year: 'numeric' });

const longDateFormatter = new Intl.DateTimeFormat('en-CA', {
  month: 'long',
  day: 'numeric',
  year: 'numeric',
});

const timeFormatter = new Intl.DateTimeFormat('en-CA', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const monthDayFormatter = new Intl.DateTimeFormat('en-CA', { month: 'short', day: 'numeric' });

const sameLocalDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export const formatDayHeader = (day: Date): string => dayHeaderFormatter.format(day);

export const formatFullDay = (day: Date): string => dayTitleFormatter.format(day);

export const formatHourLabel = (hour: number): string => `${String(hour).padStart(2, '0')}:00`;

export const formatTime = (date: Date): string => timeFormatter.format(date);

// Same day -> just the times ("16:00–17:00"); a multi-day span carries each date so
// the label stays meaningful ("Jul 8 16:00 – Jul 10 13:00").
export const formatTimeRange = (start: Date, end: Date): string =>
  sameLocalDay(start, end)
    ? `${formatTime(start)}–${formatTime(end)}`
    : `${monthDayFormatter.format(start)} ${formatTime(start)} – ${monthDayFormatter.format(end)} ${formatTime(end)}`;

// Header title describing the current window.
export const formatWindowTitle = (view: CalendarViewType, window: DateWindow): string => {
  if (view === 'day') {
    return dayTitleFormatter.format(window.from);
  }
  if (view === 'month') {
    // Title the month that owns most of the grid (the 15th is always inside it).
    return monthTitleFormatter.format(addDays(window.from, 15));
  }
  if (view === 'list') {
    return `From ${longDateFormatter.format(window.from)}`;
  }
  const lastDay = addDays(window.to, -1);
  return `${dayHeaderFormatter.format(window.from)} – ${dayHeaderFormatter.format(lastDay)}, ${lastDay.getFullYear()}`;
};
