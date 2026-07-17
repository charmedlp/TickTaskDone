<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ItemDto, OccurrenceStatus, PlannedMomentDto, TimeBlockDto } from '@ticktaskdone/shared';
import { deleteItem, enableRecurrence, fetchItemMoments, removeRecurrence, updateItem } from '@/api/items';
import {
  deleteOccurrence,
  materializeOccurrence,
  moveOccurrence,
  scheduleOccurrence,
  setOccurrenceStatus,
  updateOccurrence,
} from '@/api/occurrenceActions';
import { deleteTimeBlock, updateTimeBlock } from '@/api/timeBlocks';
import CategoryPicker from '@/components/calendar/CategoryPicker.vue';
import {
  browserTimezone,
  fromDateTimeInputValue,
  toDateInputValue,
  toDateTimeInputValue,
} from '@/lib/datetime';
import { errorMessage } from '@/lib/errorMessage';
import { formatFullDay, formatTimeRange } from '@/lib/format';
import {
  buildRrule,
  emptyRecurrence,
  parseRrule,
  WEEKDAYS,
  type Frequency,
  type RecurrenceModel,
  type Weekday,
} from '@/lib/recurrenceModel';

// Task detail (brief §3.1): edit the item's own fields AND manage its planned
// moments, so nothing forces a trip to the calendar. The recurrent/split invariant
// is honored by the "add moment" branch: a recurrent task gets a custom occurrence,
// a non-recurrent one gets another timeBlock.
const props = defineProps<{ item: ItemDto }>();
const emit = defineEmits<{ changed: []; removed: [] }>();

const { t } = useI18n();

// Fallback slot duration when the task carries no estimate (brief §3.1: the estimate
// IS the task's duration, so a recurring occurrence lasts that long from its slot).
const DEFAULT_DURATION_MIN = 60;
const slotDurationMin = (): number => props.item.estimatedMinutes ?? DEFAULT_DURATION_MIN;

const isRecurrent = computed(() => props.item.rrule !== null);

const moments = ref<PlannedMomentDto[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const busy = ref(false);

// Cursor pagination of a recurrent task's occurrences (potentially infinite): only
// start / next / prev — no page number or jump-to. `hasPrev`/`hasNext` gate the arrows.
const momentsQuery = ref<{ direction: 'start' | 'upcoming' | 'next' | 'prev'; cursor: string | null }>({
  direction: 'start',
  cursor: null,
});
const hasPrev = ref(false);
const hasNext = ref(false);
const canJumpToUpcoming = ref(false);

// The single occurrence of a non-recurrent task (holds its status + dueDate).
const singleOccurrence = computed<PlannedMomentDto | undefined>(() =>
  isRecurrent.value ? undefined : moments.value[0],
);

const loadMoments = async (): Promise<void> => {
  loading.value = true;
  error.value = null;
  try {
    const page = await fetchItemMoments(props.item.idItem, momentsQuery.value);
    moments.value = page.moments;
    hasPrev.value = page.hasPrev;
    hasNext.value = page.hasNext;
    canJumpToUpcoming.value = page.canJumpToUpcoming;
  } catch (cause) {
    error.value = errorMessage(cause);
    moments.value = [];
    hasPrev.value = false;
    hasNext.value = false;
    canJumpToUpcoming.value = false;
  } finally {
    loading.value = false;
  }
};

// Pager: navigate by the first/last occurrenceDate of the current page.
const pageStart = (): Promise<void> => {
  momentsQuery.value = { direction: 'start', cursor: null };
  return loadMoments();
};
// Jump to the window that opens at the next event from now.
const pageUpcoming = (): Promise<void> => {
  momentsQuery.value = { direction: 'upcoming', cursor: null };
  return loadMoments();
};
const pageNext = (): Promise<void> => {
  const cursor = moments.value[moments.value.length - 1]?.occurrenceDate ?? null;
  if (cursor === null) {
    return Promise.resolve();
  }
  momentsQuery.value = { direction: 'next', cursor };
  return loadMoments();
};
const pagePrev = (): Promise<void> => {
  const cursor = moments.value[0]?.occurrenceDate ?? null;
  if (cursor === null) {
    return Promise.resolve();
  }
  momentsQuery.value = { direction: 'prev', cursor };
  return loadMoments();
};

// --- Item field draft -------------------------------------------------------
const fields = reactive<{ title: string; description: string; estimatedMinutes: number | null; categoryIds: number[] }>({
  title: '',
  description: '',
  estimatedMinutes: null,
  categoryIds: [],
});
const dueDateInput = ref<string>(''); // <input type="date"> for the non-recurrent dueDate

watch(
  () => props.item,
  (item, previous) => {
    fields.title = item.title;
    fields.description = item.description ?? '';
    fields.estimatedMinutes = item.estimatedMinutes;
    fields.categoryIds = [...item.categoryIds];
    // Switching to a different task resets the pager to its first (upcoming) window.
    if (!previous || previous.idItem !== item.idItem) {
      momentsQuery.value = { direction: 'start', cursor: null };
    }
    void loadMoments();
  },
  { immediate: true },
);

watch(singleOccurrence, (occurrence) => {
  dueDateInput.value = occurrence?.dueDate ? toDateInputValue(new Date(occurrence.dueDate)) : '';
});

const guard = async (operation: () => Promise<void>): Promise<void> => {
  if (busy.value) {
    return;
  }
  busy.value = true;
  error.value = null;
  try {
    await operation();
    await loadMoments();
    emit('changed');
  } catch (cause) {
    error.value = errorMessage(cause);
  } finally {
    busy.value = false;
  }
};

const saveFields = (): Promise<void> =>
  guard(async () => {
    await updateItem(props.item.idItem, {
      title: fields.title,
      description: fields.description === '' ? null : fields.description,
      estimatedMinutes: fields.estimatedMinutes,
      categoryIds: [...fields.categoryIds],
    });
  });

// --- Recurrence toggle (brief §3.2 A/B/C) -----------------------------------
const FREQUENCIES: Frequency[] = ['daily', 'weekly', 'monthly'];
const recurrence = reactive<RecurrenceModel>(emptyRecurrence());
watch(
  () => props.item,
  (item) => Object.assign(recurrence, parseRrule(item.rrule)),
  { immediate: true },
);
// Toggle a weekday for a weekly BYDAY rule (e.g. Tue+Sat, or Mon–Fri).
const toggleWeekday = (day: Weekday): void => {
  recurrence.weekdays = recurrence.weekdays.includes(day)
    ? recurrence.weekdays.filter((value) => value !== day)
    : [...recurrence.weekdays, day];
};

// The rule anchor ("À partir de …") — the DTSTART date+time that seeds the series and
// fixes each occurrence's time-of-day. Seeded from the item's recurrenceStart when
// recurring, otherwise from the task's earliest block (the first moment), else a
// rounded now. Editable so the user can pin exactly when the repetition starts.
const recurrenceStartInput = ref('');
const earliestBlockStart = (): Date | null => {
  let earliest: Date | null = null;
  for (const moment of moments.value) {
    for (const block of moment.timeBlocks) {
      const start = new Date(block.timeStart);
      if (earliest === null || start.getTime() < earliest.getTime()) {
        earliest = start;
      }
    }
  }
  return earliest;
};
watch(
  [() => props.item, moments],
  () => {
    const base = props.item.recurrenceStart
      ? new Date(props.item.recurrenceStart)
      : (earliestBlockStart() ?? (() => {
          const now = new Date();
          now.setMinutes(0, 0, 0);
          return now;
        })());
    recurrenceStartInput.value = toDateTimeInputValue(base);
  },
  { immediate: true },
);

// A non-recurrent split has >1 block on its single occurrence (case B); 0/1 blocks = A.
const blockCount = computed(() => singleOccurrence.value?.timeBlocks.length ?? 0);
// How many separate tasks a de-recurrence would yield (materialized-with-data occs).
const splitCount = computed(() => moments.value.filter((m) => m.timeBlocks.length > 0 || m.status === 'done').length);

// A / B — turn recurring. The split (B) case warns; the single-block (A) case is silent.
const makeRecurring = (): Promise<void> =>
  guard(async () => {
    const rrule = buildRrule(recurrence);
    if (rrule === null) {
      return;
    }
    if (blockCount.value > 1 && !window.confirm(t('taskDetail.confirmSplit', { count: blockCount.value }))) {
      return;
    }
    await enableRecurrence(props.item.idItem, {
      rrule,
      recurrenceStart: fromDateTimeInputValue(recurrenceStartInput.value),
      timezone: browserTimezone(),
    });
  });

// Retune an already-recurring task's pattern and/or anchor. Virtual occurrences
// re-expand from the new rule/anchor; materialized occurrences keep their own dates.
// To turn recurrence off entirely, use Remove recurrence (case C), not this.
const updateRecurrence = (): Promise<void> =>
  guard(async () => {
    const rrule = buildRrule(recurrence);
    if (rrule === null) {
      return;
    }
    await updateItem(props.item.idItem, {
      rrule,
      recurrenceStart: fromDateTimeInputValue(recurrenceStartInput.value),
      timezone: browserTimezone(),
    });
  });

// C — remove recurrence. The item is deleted (split into N tasks), so we don't reload
// moments here; the parent navigates away on 'removed'.
const stopRecurring = async (): Promise<void> => {
  if (busy.value) {
    return;
  }
  const total = splitCount.value;
  if (!window.confirm(t('taskDetail.confirmStop', { count: total }))) {
    return;
  }
  busy.value = true;
  error.value = null;
  try {
    await removeRecurrence(props.item.idItem);
    emit('removed');
  } catch (cause) {
    error.value = errorMessage(cause);
  } finally {
    busy.value = false;
  }
};

// Delete the whole task (every occurrence, block and log cascades away). Guarded by a
// confirmation; the parent navigates away on 'removed'.
const deleteTask = async (): Promise<void> => {
  if (busy.value) {
    return;
  }
  if (!window.confirm(t('taskDetail.confirmDeleteTask'))) {
    return;
  }
  busy.value = true;
  error.value = null;
  try {
    await deleteItem(props.item.idItem);
    emit('removed');
  } catch (cause) {
    error.value = errorMessage(cause);
  } finally {
    busy.value = false;
  }
};

// --- Non-recurrent single-occurrence status + dueDate -----------------------
const setSingleStatus = (status: OccurrenceStatus): Promise<void> =>
  guard(async () => {
    await setOccurrenceStatus(props.item.idItem, { occurrenceDate: null, status });
  });

const saveDueDate = (): Promise<void> =>
  guard(async () => {
    const dueDate = dueDateInput.value ? new Date(`${dueDateInput.value}T00:00:00`) : null;
    // Editing dueDate needs a concrete occurrence; materialize the single slot first.
    const existing = singleOccurrence.value?.idItemOccurrence;
    const idItemOccurrence =
      existing ?? (await materializeOccurrence(props.item.idItem, { occurrenceDate: null })).idItemOccurrence;
    await updateOccurrence(props.item.idItem, idItemOccurrence, { dueDate });
  });

// --- Per-occurrence status (recurrent moments) ------------------------------
const toggleMomentDone = (moment: PlannedMomentDto): Promise<void> =>
  guard(async () => {
    const occurrenceDate = moment.occurrenceDate ? new Date(moment.occurrenceDate) : null;
    await setOccurrenceStatus(props.item.idItem, {
      occurrenceDate,
      status: moment.status === 'done' ? 'todo' : 'done',
    });
  });

// --- Add a moment -----------------------------------------------------------
const adding = ref(false);
const draftStart = ref('');
const draftEnd = ref('');

const openAdd = (): void => {
  const now = new Date();
  const start = new Date(now.getTime());
  start.setMinutes(0, 0, 0);
  const end = new Date(start.getTime() + slotDurationMin() * 60_000);
  draftStart.value = toDateTimeInputValue(start);
  draftEnd.value = toDateTimeInputValue(end);
  adding.value = true;
};

const submitAdd = (): Promise<void> => {
  const timeStart = fromDateTimeInputValue(draftStart.value);
  const timeEnd = fromDateTimeInputValue(draftEnd.value);
  if (timeEnd <= timeStart) {
    error.value = t('taskDetail.endAfterStart');
    return Promise.resolve();
  }
  return guard(async () => {
    // Recurrent -> a custom occurrence anchored at the start; non-recurrent -> another
    // block on the single occurrence (a split). Both go through the schedule primitive.
    await scheduleOccurrence(props.item.idItem, {
      occurrenceDate: isRecurrent.value ? timeStart : null,
      timeStart,
      timeEnd,
      allDay: false,
      isBlocking: true,
      dueDate: null,
      timezone: browserTimezone(),
    });
    adding.value = false;
  });
};

// --- Edit a moment (inline) -------------------------------------------------
const editingKey = ref<string | null>(null);
const editStart = ref('');
const editEnd = ref('');

const openEditBlock = (block: TimeBlockDto): void => {
  editingKey.value = `b${block.idTimeBlock}`;
  editStart.value = toDateTimeInputValue(new Date(block.timeStart));
  editEnd.value = toDateTimeInputValue(new Date(block.timeEnd));
};
const momentKey = (moment: PlannedMomentDto): string => `o${moment.idItemOccurrence ?? moment.occurrenceDate}`;
const openEditOccurrence = (moment: PlannedMomentDto): void => {
  const block = moment.timeBlocks[0];
  editingKey.value = momentKey(moment);
  const start = block ? new Date(block.timeStart) : moment.occurrenceDate ? new Date(moment.occurrenceDate) : new Date();
  const end = block ? new Date(block.timeEnd) : new Date(start.getTime() + slotDurationMin() * 60_000);
  editStart.value = toDateTimeInputValue(start);
  editEnd.value = toDateTimeInputValue(end);
};
const cancelEdit = (): void => {
  editingKey.value = null;
};

const saveEditBlock = (block: TimeBlockDto): Promise<void> => {
  const timeStart = fromDateTimeInputValue(editStart.value);
  const timeEnd = fromDateTimeInputValue(editEnd.value);
  if (timeEnd <= timeStart) {
    error.value = t('taskDetail.endAfterStart');
    return Promise.resolve();
  }
  return guard(async () => {
    await updateTimeBlock(block.idTimeBlock, { timeStart, timeEnd, timezone: browserTimezone() });
    editingKey.value = null;
  });
};

const saveEditOccurrence = (moment: PlannedMomentDto): Promise<void> => {
  const timeStart = fromDateTimeInputValue(editStart.value);
  const timeEnd = fromDateTimeInputValue(editEnd.value);
  if (timeEnd <= timeStart) {
    error.value = t('taskDetail.endAfterStart');
    return Promise.resolve();
  }
  return guard(async () => {
    await moveOccurrence(props.item.idItem, {
      occurrenceDate: moment.occurrenceDate ? new Date(moment.occurrenceDate) : null,
      timeStart,
      timeEnd,
      timezone: browserTimezone(),
    });
    editingKey.value = null;
  });
};

// --- Delete a moment --------------------------------------------------------
const removeBlock = (block: TimeBlockDto): Promise<void> =>
  guard(async () => {
    await deleteTimeBlock(block.idTimeBlock);
  });
const removeOccurrence = (moment: PlannedMomentDto): Promise<void> =>
  guard(async () => {
    if (moment.idItemOccurrence === null) {
      // Virtual upcoming slot — skip it (cancel), consistent with the calendar's
      // "delete occurrence" on a recurring instance (§11 respects cancelled).
      await setOccurrenceStatus(props.item.idItem, {
        occurrenceDate: moment.occurrenceDate ? new Date(moment.occurrenceDate) : null,
        status: 'cancelled',
      });
    } else {
      await deleteOccurrence(props.item.idItem, moment.idItemOccurrence);
    }
  });

const blockRange = (block: TimeBlockDto): string => {
  const start = new Date(block.timeStart);
  const end = new Date(block.timeEnd);
  return `${formatFullDay(start)} · ${formatTimeRange(start, end)}`;
};

// Display range for a recurring moment: the placed block if any, otherwise the slot's
// start (occurrenceDate) for the task's estimated duration (brief §3.1).
const momentRange = (moment: PlannedMomentDto): string => {
  const block = moment.timeBlocks[0];
  if (block) {
    return blockRange(block);
  }
  if (!moment.occurrenceDate) {
    return '';
  }
  const start = new Date(moment.occurrenceDate);
  const end = new Date(start.getTime() + slotDurationMin() * 60_000);
  return `${formatFullDay(start)} · ${formatTimeRange(start, end)}`;
};
</script>

<template>
  <div class="task-detail">
    <p v-if="error" class="banner error">{{ error }}</p>

    <!-- Item fields -->
    <div class="fields">
      <input v-model="fields.title" type="text" class="title-input" :placeholder="t('taskDetail.taskTitle')" />
      <textarea v-model="fields.description" class="desc-input" rows="2" :placeholder="t('taskDetail.description')" />
      <div class="field">
        <span>{{ t('taskDetail.categories') }}</span>
        <CategoryPicker v-model="fields.categoryIds" />
      </div>
      <div class="row">
        <label class="field">
          <span>{{ t('taskDetail.estimateMin') }}</span>
          <input v-model.number="fields.estimatedMinutes" type="number" min="0" step="5" />
        </label>
        <label v-if="!isRecurrent" class="field">
          <span>{{ t('taskDetail.dueDate') }}</span>
          <input v-model="dueDateInput" type="date" @change="saveDueDate" />
        </label>
        <span v-if="isRecurrent" class="recurrent-tag">{{ t('taskDetail.recurring') }}</span>
        <button type="button" class="btn primary" :disabled="busy" @click="saveFields">{{ t('common.save') }}</button>
        <button type="button" class="btn danger" :disabled="busy" @click="deleteTask">{{ t('taskDetail.deleteTask') }}</button>
      </div>
      <label v-if="!isRecurrent" class="done-check">
        <input
          type="checkbox"
          :checked="singleOccurrence?.status === 'done'"
          :disabled="busy"
          @change="setSingleStatus(singleOccurrence?.status === 'done' ? 'todo' : 'done')"
        />
        {{ t('taskDetail.done') }}
      </label>
    </div>

    <!-- Recurrence toggle (§3.2) -->
    <section class="recurrence">
      <h3>{{ t('taskDetail.recurrence') }}</h3>
      <div class="recur-edit">
        <label class="rc-freq">
          {{ t('taskDetail.repeatEvery') }}
          <input v-model.number="recurrence.interval" type="number" min="1" step="1" class="rc-interval" />
          <select v-model="recurrence.freq">
            <option value="none">{{ t('taskDetail.freqOff') }}</option>
            <option v-for="f in FREQUENCIES" :key="f" :value="f">{{ t('taskDetail.freqUnit.' + f) }}</option>
          </select>
        </label>
        <div v-if="recurrence.freq === 'weekly'" class="rc-weekdays">
          <button
            v-for="day in WEEKDAYS"
            :key="day.value"
            type="button"
            class="rc-weekday"
            :class="{ on: recurrence.weekdays.includes(day.value) }"
            @click="toggleWeekday(day.value)"
          >
            {{ t('weekday.' + day.value) }}
          </button>
        </div>
        <label class="rc-count">
          {{ t('taskDetail.for') }}
          <input v-model.number="recurrence.count" type="number" min="1" step="1" placeholder="∞" class="rc-interval" />
          {{ t('taskDetail.times') }}
        </label>
        <label class="rc-start">
          {{ t('taskDetail.starting') }}
          <input v-model="recurrenceStartInput" type="datetime-local" class="rc-start-input" />
        </label>
        <button
          v-if="!isRecurrent"
          type="button"
          class="btn small primary"
          :disabled="busy || recurrence.freq === 'none'"
          @click="makeRecurring"
        >
          {{ t('taskDetail.makeRecurring') }}
        </button>
        <template v-else>
          <button type="button" class="btn small primary" :disabled="busy || recurrence.freq === 'none'" @click="updateRecurrence">
            {{ t('taskDetail.updateRecurrence') }}
          </button>
          <button type="button" class="btn small danger" :disabled="busy" @click="stopRecurring">{{ t('taskDetail.removeRecurrence') }}</button>
        </template>
      </div>
    </section>

    <!-- Planned moments -->
    <section class="moments">
      <div class="moments-head">
        <h3>{{ t('taskDetail.plannedMoments') }}</h3>
        <div class="moments-actions">
          <button
            v-if="isRecurrent && canJumpToUpcoming"
            type="button"
            class="btn small"
            :disabled="busy || loading"
            @click="pageUpcoming"
          >
            ⭲ {{ t('taskDetail.nextEvent') }}
          </button>
          <button type="button" class="btn small" :disabled="busy" @click="openAdd">+ {{ t('taskDetail.addMoment') }}</button>
        </div>
      </div>

      <div v-if="adding" class="moment-editor">
        <input v-model="draftStart" type="datetime-local" />
        <span class="arrow">→</span>
        <input v-model="draftEnd" type="datetime-local" />
        <button type="button" class="btn small primary" :disabled="busy" @click="submitAdd">{{ t('common.add') }}</button>
        <button type="button" class="btn small" :disabled="busy" @click="adding = false">{{ t('common.cancel') }}</button>
      </div>

      <p v-if="loading" class="muted small">{{ t('common.loading') }}</p>

      <!-- Non-recurrent: the single occurrence's blocks (splits) -->
      <ul v-if="!isRecurrent" class="moment-list">
        <li v-for="block in singleOccurrence?.timeBlocks ?? []" :key="block.idTimeBlock" class="moment-row">
          <template v-if="editingKey === `b${block.idTimeBlock}`">
            <input v-model="editStart" type="datetime-local" />
            <span class="arrow">→</span>
            <input v-model="editEnd" type="datetime-local" />
            <button type="button" class="btn small primary" :disabled="busy" @click="saveEditBlock(block)">{{ t('common.save') }}</button>
            <button type="button" class="btn small" :disabled="busy" @click="cancelEdit">{{ t('common.cancel') }}</button>
          </template>
          <template v-else>
            <span class="moment-when">{{ blockRange(block) }}</span>
            <button type="button" class="btn small" :disabled="busy" @click="openEditBlock(block)">{{ t('common.edit') }}</button>
            <button type="button" class="btn small danger" :disabled="busy" :aria-label="t('common.delete')" @click="removeBlock(block)">✕</button>
          </template>
        </li>
        <li v-if="(singleOccurrence?.timeBlocks.length ?? 0) === 0 && !loading" class="muted small">
          {{ t('taskDetail.noPlannedMoments') }}
        </li>
      </ul>

      <!-- Recurrent: materialized occurrences + upcoming virtual slots -->
      <ul v-else class="moment-list">
        <li
          v-for="moment in moments"
          :key="moment.idItemOccurrence ?? `v${moment.occurrenceDate}`"
          class="moment-row"
          :class="{ 'is-upcoming': !moment.materialized, 'is-cancelled': moment.status === 'cancelled' }"
        >
          <template v-if="editingKey === `o${moment.idItemOccurrence ?? moment.occurrenceDate}`">
            <input v-model="editStart" type="datetime-local" />
            <span class="arrow">→</span>
            <input v-model="editEnd" type="datetime-local" />
            <button type="button" class="btn small primary" :disabled="busy" @click="saveEditOccurrence(moment)">{{ t('common.save') }}</button>
            <button type="button" class="btn small" :disabled="busy" @click="cancelEdit">{{ t('common.cancel') }}</button>
          </template>
          <template v-else>
            <input
              type="checkbox"
              :checked="moment.status === 'done'"
              :disabled="busy"
              @change="toggleMomentDone(moment)"
            />
            <span class="moment-when">{{ momentRange(moment) }}</span>
            <span v-if="!moment.materialized" class="moment-tag">{{ t('taskDetail.upcoming') }}</span>
            <span v-else-if="moment.status !== 'todo'" class="moment-status">{{ t('taskDetail.status.' + moment.status) }}</span>
            <button type="button" class="btn small" :disabled="busy" @click="openEditOccurrence(moment)">{{ t('common.edit') }}</button>
            <button type="button" class="btn small danger" :disabled="busy" :aria-label="t('common.delete')" @click="removeOccurrence(moment)">✕</button>
          </template>
        </li>
        <li v-if="moments.length === 0 && !loading" class="muted small">{{ t('taskDetail.noOccurrences') }}</li>
      </ul>

      <!-- Cursor pager (recurrent series can be infinite: no page number / jump-to).
           Start/Prev appear only when earlier occurrences actually exist. -->
      <div v-if="isRecurrent && (hasPrev || hasNext)" class="moment-pager">
        <button v-if="hasPrev" type="button" class="btn small" :disabled="busy || loading" @click="pageStart">⭰ {{ t('taskDetail.pagerStart') }}</button>
        <button v-if="hasPrev" type="button" class="btn small" :disabled="busy || loading" @click="pagePrev">‹ {{ t('taskDetail.pagerPrev') }}</button>
        <button v-if="hasNext" type="button" class="btn small" :disabled="busy || loading" @click="pageNext">{{ t('taskDetail.pagerNext') }} ›</button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.task-detail {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.banner.error {
  background: rgba(220, 38, 38, 0.12);
  color: #dc2626;
  padding: 8px 12px;
  border-radius: 8px;
  margin: 0;
}

.fields {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--border);
}

.title-input {
  font: inherit;
  font-size: 18px;
  font-weight: 600;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  color: var(--text);
}

.desc-input {
  font: inherit;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  color: var(--text);
  resize: vertical;
}

.row {
  display: flex;
  align-items: flex-end;
  gap: 12px;
  flex-wrap: wrap;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 12px;
  color: var(--text-muted);
}

.field input {
  font: inherit;
  font-size: 14px;
  color: var(--text);
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
}

.recurrent-tag {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--accent);
  align-self: center;
}

.done-check {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--text-muted);
}

.recurrence {
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border);
}

.recurrence h3 {
  font-size: 13px;
  color: var(--text-muted);
  margin: 0 0 8px;
}

.recur-edit {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  font-size: 13px;
  color: var(--text);
}

.rc-freq,
.rc-count,
.rc-start {
  display: flex;
  align-items: center;
  gap: 6px;
}

.rc-weekdays {
  display: flex;
  gap: 3px;
}

.rc-weekday {
  min-width: 28px;
  padding: 4px 0;
  font: inherit;
  font-size: 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  color: var(--text-muted);
  cursor: pointer;
}

.rc-weekday.on {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

.rc-interval {
  width: 56px;
  font: inherit;
  padding: 5px 6px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  color: var(--text);
}

.recur-edit select {
  font: inherit;
  padding: 5px 6px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  color: var(--text);
}

.moments-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.moments-actions {
  display: flex;
  gap: 6px;
}

.moments-head h3 {
  font-size: 13px;
  color: var(--text-muted);
  margin: 0;
}

.moment-editor,
.moment-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  margin-bottom: 4px;
}

.moment-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.moment-when {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}

.moment-status {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
}

/* Upcoming virtual slots: dashed + dimmed so they read as "planned by the rule, not
   yet materialized" versus the solid materialized rows. */
.moment-row.is-upcoming {
  border-style: dashed;
  background: color-mix(in srgb, var(--surface) 60%, transparent);
}

.moment-tag {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
  border: 1px dashed var(--border);
  border-radius: 8px;
  padding: 0 6px;
}

.moment-row.is-cancelled .moment-when {
  text-decoration: line-through;
  color: var(--text-muted);
}

.moment-pager {
  display: flex;
  gap: 6px;
  margin-top: 8px;
}

.arrow {
  color: var(--text-muted);
}

input[type='datetime-local'] {
  font: inherit;
  font-size: 13px;
  color: var(--text);
  padding: 4px 6px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
}

.btn {
  font: inherit;
  padding: 7px 14px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
  cursor: pointer;
}

.btn.small {
  padding: 4px 10px;
  font-size: 13px;
}

.btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.btn.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

.btn.danger {
  color: #dc2626;
  border-color: rgba(220, 38, 38, 0.4);
}

.muted {
  color: var(--text-muted);
}

.small {
  font-size: 12px;
}
</style>
