// The task a timer session runs on. `idItemOccurrence` is null when the task is a
// still-virtual recurring slot; the overlay materializes it before logging time.
// `key` uniquely identifies the session (one timer per task slot) so several timers
// can run at once — the user oscillates between tasks by pausing one and starting
// another.
export interface TimerSession {
  key: string;
  itemId: number;
  title: string;
  occurrenceDate: string | null;
  idItemOccurrence: number | null;
}

// One timer per (item, slot): the key both dedupes clicks and stays stable as the
// feed reloads.
export const timerKey = (itemId: number, occurrenceDate: string | null): string =>
  `${itemId}:${occurrenceDate ?? 'null'}`;
