import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import type { OccurrenceViewDto } from '@ticktaskdone/shared';
import { fetchOccurrences } from '@/api/occurrences';
import { ApiError } from '@/api/client';
import { type CalendarViewType, stepAnchor, windowForView } from '@/lib/datetime';

// Planned = timeBlocks (the plan). Actual = timeLogs — a later Phase 4 milestone,
// so the toggle exists but only planned is wired for now.
export type CalendarMode = 'planned' | 'actual';

export const useCalendarStore = defineStore('calendar', () => {
  const view = ref<CalendarViewType>('week');
  const anchor = ref<Date>(new Date());
  const weekStartsOn = ref(1); // Monday
  const mode = ref<CalendarMode>('planned');

  const occurrences = ref<OccurrenceViewDto[]>([]);
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
  const setMode = (next: CalendarMode): void => {
    mode.value = next;
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
      await load(true); // silent reconcile — no loading flash
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
    loading,
    error,
    window,
    load,
    setView,
    step,
    goToToday,
    setMode,
  };
});
