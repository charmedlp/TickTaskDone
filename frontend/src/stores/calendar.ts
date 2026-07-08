import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import type { BacklogTaskDto, OccurrenceViewDto, ReminderDto } from '@ticktaskdone/shared';
import { fetchOccurrences } from '@/api/occurrences';
import { fetchBacklog } from '@/api/backlog';
import { fetchReminders } from '@/api/reminders';
import { ApiError } from '@/api/client';
import { type CalendarViewType, stepAnchor, windowForView } from '@/lib/datetime';

// Planned = timeBlocks (the plan). Actual = timeLogs (real time spent). The toggle
// picks which the calendar renders; Actual is read-only (the timer writes logs).
export type CalendarMode = 'planned' | 'actual';

export const useCalendarStore = defineStore('calendar', () => {
  const view = ref<CalendarViewType>('week');
  const anchor = ref<Date>(new Date());
  const weekStartsOn = ref(1); // Monday
  const mode = ref<CalendarMode>('planned');

  const occurrences = ref<OccurrenceViewDto[]>([]);
  const backlog = ref<BacklogTaskDto[]>([]);
  const reminders = ref<ReminderDto[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  const window = computed(() => windowForView(view.value, anchor.value, weekStartsOn.value));

  // `silent` skips the loading banner: used for the post-mutation reconcile reload,
  // where the change is already reflected optimistically and a flash would be noise.
  const load = async (silent = false): Promise<void> => {
    if (!silent) {
      loading.value = true;
    }
    error.value = null;
    try {
      occurrences.value = await fetchOccurrences(window.value.from, window.value.to);
    } catch (cause) {
      error.value = cause instanceof ApiError ? cause.message : 'Failed to load the calendar.';
      occurrences.value = [];
    } finally {
      loading.value = false;
    }
    await loadReminders(); // window-independent; a soft failure must not break the feed
  };

  // Overdue reminders ("now"-based, not window-scoped). A failure is non-fatal.
  const loadReminders = async (): Promise<void> => {
    reminders.value = await fetchReminders().catch(() => []);
  };

  const setView = (next: CalendarViewType): void => {
    view.value = next;
  };
  const step = (direction: 1 | -1): void => {
    anchor.value = stepAnchor(view.value, anchor.value, direction);
  };
  const goToToday = (): void => {
    anchor.value = new Date();
  };
  const setAnchor = (date: Date): void => {
    anchor.value = date;
  };
  const setMode = (next: CalendarMode): void => {
    mode.value = next;
  };

  // The backlog is workspace/user-scoped (not window-dependent): loaded once and
  // refreshed after mutations, which can move tasks in or out of it.
  const loadBacklog = async (): Promise<void> => {
    backlog.value = await fetchBacklog().catch(() => []);
  };

  // Optimistic reschedule: move a block locally so it follows the drop instantly,
  // before the server round-trip + reload reconcile it. Avoids the block snapping
  // back to its origin during the request.
  const patchLocalTimeBlock = (idTimeBlock: number, timeStart: string, timeEnd: string): void => {
    for (const occurrence of occurrences.value) {
      const block = occurrence.timeBlocks.find((candidate) => candidate.idTimeBlock === idTimeBlock);
      if (block) {
        block.timeStart = timeStart;
        block.timeEnd = timeEnd;
        return;
      }
    }
  };

  // Runs a mutation then refreshes the window. Centralizes error handling so every
  // interaction path reports failures the same way. Returns the operation result.
  const apply = async <T>(operation: () => Promise<T>): Promise<T | undefined> => {
    error.value = null;
    try {
      const result = await operation();
      await Promise.all([load(true), loadBacklog()]); // silent reconcile of feed + backlog (load also refreshes reminders)
      return result;
    } catch (cause) {
      error.value = cause instanceof ApiError ? cause.message : 'Action failed.';
      return undefined;
    }
  };

  return {
    apply,
    patchLocalTimeBlock,
    view,
    anchor,
    weekStartsOn,
    mode,
    occurrences,
    backlog,
    reminders,
    loading,
    error,
    window,
    load,
    loadBacklog,
    loadReminders,
    setView,
    step,
    goToToday,
    setAnchor,
    setMode,
  };
});
