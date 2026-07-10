<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import type { ItemDto, OccurrenceStatus, PlannedMomentDto, TimeBlockDto } from '@ticktaskdone/shared';
import { enableRecurrence, fetchItemMoments, removeRecurrence, updateItem } from '@/api/items';
import {
  deleteOccurrence,
  materializeOccurrence,
  moveOccurrence,
  scheduleOccurrence,
  setOccurrenceStatus,
  updateOccurrence,
} from '@/api/occurrenceActions';
import { deleteTimeBlock, updateTimeBlock } from '@/api/timeBlocks';
import { ApiError } from '@/api/client';
import {
  browserTimezone,
  fromDateTimeInputValue,
  toDateInputValue,
  toDateTimeInputValue,
} from '@/lib/datetime';
import { formatFullDay, formatTimeRange } from '@/lib/format';
import { buildRrule, emptyRecurrence, parseRrule, type Frequency, type RecurrenceModel } from '@/lib/recurrenceModel';

// Task detail (brief §3.1): edit the item's own fields AND manage its planned
// moments, so nothing forces a trip to the calendar. The recurrent/split invariant
// is honored by the "add moment" branch: a recurrent task gets a custom occurrence,
// a non-recurrent one gets another timeBlock.
const props = defineProps<{ item: ItemDto }>();
const emit = defineEmits<{ changed: []; removed: [] }>();

const isRecurrent = computed(() => props.item.rrule !== null);

const moments = ref<PlannedMomentDto[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const busy = ref(false);

// The single occurrence of a non-recurrent task (holds its status + dueDate).
const singleOccurrence = computed<PlannedMomentDto | undefined>(() =>
  isRecurrent.value ? undefined : moments.value[0],
);

const loadMoments = async (): Promise<void> => {
  loading.value = true;
  error.value = null;
  try {
    moments.value = await fetchItemMoments(props.item.idItem);
  } catch (cause) {
    error.value = cause instanceof ApiError ? cause.message : 'Failed to load moments.';
    moments.value = [];
  } finally {
    loading.value = false;
  }
};

// --- Item field draft -------------------------------------------------------
const fields = reactive<{ title: string; description: string; estimatedMinutes: number | null }>({
  title: '',
  description: '',
  estimatedMinutes: null,
});
const dueDateInput = ref<string>(''); // <input type="date"> for the non-recurrent dueDate

watch(
  () => props.item,
  (item) => {
    fields.title = item.title;
    fields.description = item.description ?? '';
    fields.estimatedMinutes = item.estimatedMinutes;
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
    error.value = cause instanceof ApiError ? cause.message : 'Action failed.';
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
    });
  });

// --- Recurrence toggle (brief §3.2 A/B/C) -----------------------------------
const FREQUENCIES: { value: Frequency; label: string }[] = [
  { value: 'daily', label: 'day(s)' },
  { value: 'weekly', label: 'week(s)' },
  { value: 'monthly', label: 'month(s)' },
];
const recurrence = reactive<RecurrenceModel>(emptyRecurrence());
watch(
  () => props.item,
  (item) => Object.assign(recurrence, parseRrule(item.rrule)),
  { immediate: true },
);

// A non-recurrent split has >1 block on its single occurrence (case B); 0/1 blocks = A.
const blockCount = computed(() => singleOccurrence.value?.timeBlocks.length ?? 0);
// How many separate tasks a de-recurrence would yield (materialized-with-data occs).
const splitCount = computed(() => moments.value.filter((m) => m.timeBlocks.length > 0 || m.status === 'done').length);
const recurrenceSummary = computed(() =>
  recurrence.freq === 'none'
    ? ''
    : `Every ${recurrence.interval} ${FREQUENCIES.find((f) => f.value === recurrence.freq)?.label ?? ''}` +
      (recurrence.count !== null ? `, ${recurrence.count} times` : ''),
);

// A / B — turn recurring. The split (B) case warns; the single-block (A) case is silent.
const makeRecurring = (): Promise<void> =>
  guard(async () => {
    const rrule = buildRrule(recurrence);
    if (rrule === null) {
      return;
    }
    if (
      blockCount.value > 1 &&
      !window.confirm(
        `This task is split into ${blockCount.value} blocks. They will become independent instances of the recurrence. Continue?`,
      )
    ) {
      return;
    }
    await enableRecurrence(props.item.idItem, rrule);
  });

// C — remove recurrence. The item is deleted (split into N tasks), so we don't reload
// moments here; the parent navigates away on 'removed'.
const stopRecurring = async (): Promise<void> => {
  if (busy.value) {
    return;
  }
  const total = splitCount.value;
  if (
    !window.confirm(
      `This recurring task will be split into ${total} separate task${total === 1 ? '' : 's'}; unplanned, undone occurrences will be lost. Continue?`,
    )
  ) {
    return;
  }
  busy.value = true;
  error.value = null;
  try {
    await removeRecurrence(props.item.idItem);
    emit('removed');
  } catch (cause) {
    error.value = cause instanceof ApiError ? cause.message : 'Action failed.';
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
  const end = new Date(start.getTime() + 60 * 60_000);
  draftStart.value = toDateTimeInputValue(start);
  draftEnd.value = toDateTimeInputValue(end);
  adding.value = true;
};

const submitAdd = (): Promise<void> =>
  guard(async () => {
    const timeStart = fromDateTimeInputValue(draftStart.value);
    const timeEnd = fromDateTimeInputValue(draftEnd.value);
    if (timeEnd <= timeStart) {
      throw new ApiError(400, 'End must be after start.');
    }
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

// --- Edit a moment (inline) -------------------------------------------------
const editingKey = ref<string | null>(null);
const editStart = ref('');
const editEnd = ref('');

const openEditBlock = (block: TimeBlockDto): void => {
  editingKey.value = `b${block.idTimeBlock}`;
  editStart.value = toDateTimeInputValue(new Date(block.timeStart));
  editEnd.value = toDateTimeInputValue(new Date(block.timeEnd));
};
const openEditOccurrence = (moment: PlannedMomentDto): void => {
  const block = moment.timeBlocks[0];
  editingKey.value = `o${moment.idItemOccurrence}`;
  const start = block ? new Date(block.timeStart) : moment.occurrenceDate ? new Date(moment.occurrenceDate) : new Date();
  const end = block ? new Date(block.timeEnd) : new Date(start.getTime() + 60 * 60_000);
  editStart.value = toDateTimeInputValue(start);
  editEnd.value = toDateTimeInputValue(end);
};
const cancelEdit = (): void => {
  editingKey.value = null;
};

const saveEditBlock = (block: TimeBlockDto): Promise<void> =>
  guard(async () => {
    const timeStart = fromDateTimeInputValue(editStart.value);
    const timeEnd = fromDateTimeInputValue(editEnd.value);
    if (timeEnd <= timeStart) {
      throw new ApiError(400, 'End must be after start.');
    }
    await updateTimeBlock(block.idTimeBlock, { timeStart, timeEnd, timezone: browserTimezone() });
    editingKey.value = null;
  });

const saveEditOccurrence = (moment: PlannedMomentDto): Promise<void> =>
  guard(async () => {
    const timeStart = fromDateTimeInputValue(editStart.value);
    const timeEnd = fromDateTimeInputValue(editEnd.value);
    if (timeEnd <= timeStart) {
      throw new ApiError(400, 'End must be after start.');
    }
    await moveOccurrence(props.item.idItem, {
      occurrenceDate: moment.occurrenceDate ? new Date(moment.occurrenceDate) : null,
      timeStart,
      timeEnd,
      timezone: browserTimezone(),
    });
    editingKey.value = null;
  });

// --- Delete a moment --------------------------------------------------------
const removeBlock = (block: TimeBlockDto): Promise<void> =>
  guard(async () => {
    await deleteTimeBlock(block.idTimeBlock);
  });
const removeOccurrence = (moment: PlannedMomentDto): Promise<void> =>
  guard(async () => {
    await deleteOccurrence(props.item.idItem, moment.idItemOccurrence);
  });

const blockRange = (block: TimeBlockDto): string => {
  const start = new Date(block.timeStart);
  const end = new Date(block.timeEnd);
  return `${formatFullDay(start)} · ${formatTimeRange(start, end)}`;
};
</script>

<template>
  <div class="task-detail">
    <p v-if="error" class="banner error">{{ error }}</p>

    <!-- Item fields -->
    <div class="fields">
      <input v-model="fields.title" type="text" class="title-input" placeholder="Task title" />
      <textarea v-model="fields.description" class="desc-input" rows="2" placeholder="Description" />
      <div class="row">
        <label class="field">
          <span>Estimate (min)</span>
          <input v-model.number="fields.estimatedMinutes" type="number" min="0" step="5" />
        </label>
        <label v-if="!isRecurrent" class="field">
          <span>Due date</span>
          <input v-model="dueDateInput" type="date" @change="saveDueDate" />
        </label>
        <span v-if="isRecurrent" class="recurrent-tag">Recurring</span>
        <button type="button" class="btn primary" :disabled="busy" @click="saveFields">Save</button>
      </div>
      <label v-if="!isRecurrent" class="done-check">
        <input
          type="checkbox"
          :checked="singleOccurrence?.status === 'done'"
          :disabled="busy"
          @change="setSingleStatus(singleOccurrence?.status === 'done' ? 'todo' : 'done')"
        />
        Done
      </label>
    </div>

    <!-- Recurrence toggle (§3.2) -->
    <section class="recurrence">
      <h3>Recurrence</h3>
      <div v-if="!isRecurrent" class="recur-edit">
        <label class="rc-freq">
          Repeat every
          <input v-model.number="recurrence.interval" type="number" min="1" step="1" class="rc-interval" />
          <select v-model="recurrence.freq">
            <option value="none">— off —</option>
            <option v-for="f in FREQUENCIES" :key="f.value" :value="f.value">{{ f.label }}</option>
          </select>
        </label>
        <label class="rc-count">
          for
          <input v-model.number="recurrence.count" type="number" min="1" step="1" placeholder="∞" class="rc-interval" />
          time(s)
        </label>
        <button type="button" class="btn small primary" :disabled="busy || recurrence.freq === 'none'" @click="makeRecurring">
          Make recurring
        </button>
      </div>
      <div v-else class="recur-on">
        <span class="recur-summary">{{ recurrenceSummary }}</span>
        <button type="button" class="btn small danger" :disabled="busy" @click="stopRecurring">Remove recurrence…</button>
      </div>
    </section>

    <!-- Planned moments -->
    <section class="moments">
      <div class="moments-head">
        <h3>Planned moments</h3>
        <button type="button" class="btn small" :disabled="busy" @click="openAdd">+ Add moment</button>
      </div>

      <div v-if="adding" class="moment-editor">
        <input v-model="draftStart" type="datetime-local" />
        <span class="arrow">→</span>
        <input v-model="draftEnd" type="datetime-local" />
        <button type="button" class="btn small primary" :disabled="busy" @click="submitAdd">Add</button>
        <button type="button" class="btn small" :disabled="busy" @click="adding = false">Cancel</button>
      </div>

      <p v-if="loading" class="muted small">Loading…</p>

      <!-- Non-recurrent: the single occurrence's blocks (splits) -->
      <ul v-if="!isRecurrent" class="moment-list">
        <li v-for="block in singleOccurrence?.timeBlocks ?? []" :key="block.idTimeBlock" class="moment-row">
          <template v-if="editingKey === `b${block.idTimeBlock}`">
            <input v-model="editStart" type="datetime-local" />
            <span class="arrow">→</span>
            <input v-model="editEnd" type="datetime-local" />
            <button type="button" class="btn small primary" :disabled="busy" @click="saveEditBlock(block)">Save</button>
            <button type="button" class="btn small" :disabled="busy" @click="cancelEdit">Cancel</button>
          </template>
          <template v-else>
            <span class="moment-when">{{ blockRange(block) }}</span>
            <button type="button" class="btn small" :disabled="busy" @click="openEditBlock(block)">Edit</button>
            <button type="button" class="btn small danger" :disabled="busy" @click="removeBlock(block)">✕</button>
          </template>
        </li>
        <li v-if="(singleOccurrence?.timeBlocks.length ?? 0) === 0 && !loading" class="muted small">
          No planned moments — this task sits in the backlog.
        </li>
      </ul>

      <!-- Recurrent: one row per materialized occurrence -->
      <ul v-else class="moment-list">
        <li v-for="moment in moments" :key="moment.idItemOccurrence" class="moment-row">
          <template v-if="editingKey === `o${moment.idItemOccurrence}`">
            <input v-model="editStart" type="datetime-local" />
            <span class="arrow">→</span>
            <input v-model="editEnd" type="datetime-local" />
            <button type="button" class="btn small primary" :disabled="busy" @click="saveEditOccurrence(moment)">Save</button>
            <button type="button" class="btn small" :disabled="busy" @click="cancelEdit">Cancel</button>
          </template>
          <template v-else>
            <input
              type="checkbox"
              :checked="moment.status === 'done'"
              :disabled="busy"
              @change="toggleMomentDone(moment)"
            />
            <span class="moment-when">
              {{ moment.timeBlocks[0] ? blockRange(moment.timeBlocks[0]) : formatFullDay(new Date(moment.occurrenceDate ?? '')) }}
            </span>
            <span v-if="moment.status !== 'todo'" class="moment-status">{{ moment.status }}</span>
            <button type="button" class="btn small" :disabled="busy" @click="openEditOccurrence(moment)">Edit</button>
            <button type="button" class="btn small danger" :disabled="busy" @click="removeOccurrence(moment)">✕</button>
          </template>
        </li>
        <li v-if="moments.length === 0 && !loading" class="muted small">No materialized occurrences yet.</li>
      </ul>
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

.recur-edit,
.recur-on {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  font-size: 13px;
  color: var(--text);
}

.rc-freq,
.rc-count {
  display: flex;
  align-items: center;
  gap: 6px;
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

.recur-summary {
  flex: 1;
  min-width: 0;
  font-weight: 500;
}

.moments-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
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
