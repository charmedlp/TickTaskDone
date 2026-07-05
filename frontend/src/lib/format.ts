import type { CalendarViewType, DateWindow } from './datetime';
import { addDays } from './datetime';

// All formatting is UTC (see datetime.ts): the grid renders on a UTC wall-clock.

const dayHeaderFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'UTC',
  weekday: 'short',
  month: 'short',
  day: 'numeric',
});

const dayTitleFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'UTC',
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  year: 'numeric',
});

const monthTitleFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', month: 'long', year: 'numeric' });

const timeFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'UTC',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export const formatDayHeader = (day: Date): string => dayHeaderFormatter.format(day);

export const formatHourLabel = (hour: number): string => `${String(hour).padStart(2, '0')}:00`;

export const formatTime = (date: Date): string => timeFormatter.format(date);

export const formatTimeRange = (start: Date, end: Date): string => `${formatTime(start)}–${formatTime(end)}`;

// Header title describing the current window.
export const formatWindowTitle = (view: CalendarViewType, window: DateWindow): string => {
  if (view === 'day') {
    return dayTitleFormatter.format(window.from);
  }
  if (view === 'month') {
    // Title the month that owns most of the grid (the 15th is always inside it).
    return monthTitleFormatter.format(addDays(window.from, 15));
  }
  const lastDay = addDays(window.to, -1);
  return `${dayHeaderFormatter.format(window.from)} – ${dayHeaderFormatter.format(lastDay)}`;
};
