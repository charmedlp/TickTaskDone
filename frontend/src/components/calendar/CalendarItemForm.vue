<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  createScheduledItemInput,
  type CreateScheduledItemInput,
  type ItemDto,
  type ItemType,
  type ProjectDto,
} from '@ticktaskdone/shared';
import {
  browserTimezone,
  fromDateInputValue,
  fromDateTimeInputValue,
  toDateInputValue,
  toDateTimeInputValue,
  toDateTimeInputValueUTC,
} from '@/lib/datetime';
import { buildRrule, emptyRecurrence, type RecurrenceModel } from '@/lib/recurrenceModel';
import ItemCoreFields from '@/components/projects/ItemCoreFields.vue';
import RecurrenceEditor from '@/components/projects/RecurrenceEditor.vue';
import type { FormSeed, ScheduleSubmit, UpdateSubmit } from './itemForm.types';

const props = defineProps<{ seed: FormSeed | null; projects: ProjectDto[]; items: ItemDto[] }>();
const emit = defineEmits<{
  create: [CreateScheduledItemInput];
  schedule: [ScheduleSubmit];
  update: [UpdateSubmit];
  close: [];
}>();

const { t } = useI18n();

const form = reactive({
  mode: 'create' as 'create' | 'edit',
  type: 'task' as ItemType,
  title: '',
  projectId: null as number | null,
  description: '',
  color: null as string | null, // null = no custom color (follows the cascade)
  estimatedMinutes: null as number | null,
  dueDate: '' as string,
  isBlocking: true, // items reserve their slot (block) by default
  allDay: false,
  timeStart: '' as string,
  timeEnd: '' as string,
  recurrence: emptyRecurrence() as RecurrenceModel,
  supersedeStaleOccurrences: true, // recurring tasks: keep one active instance (vs accumulate)
  generatesReminder: true, // task surfaces overdue reminders (and is auto-cancellable)
  categoryIds: [] as number[],
});
// 'new' creates a brand-new item; a number schedules that existing item instead.
const source = ref<'new' | number>('new');
const idItem = ref<number | null>(null);
const idItemOccurrence = ref<number | null>(null);
const timeBlockId = ref<number | null>(null);
const errorMessage = ref<string | null>(null);
const linkDueToBlock = ref(true); // due date tracks the block end until the user unlinks it

watch(
  () => props.seed,
  (seed) => {
    if (!seed) {
      return;
    }
    source.value = 'new';
    form.mode = seed.mode;
    form.type = seed.type;
    form.title = seed.title;
    form.projectId = seed.projectId;
    form.description = seed.description ?? '';
    form.color = seed.color;
    form.estimatedMinutes = seed.estimatedMinutes;
    form.dueDate = seed.dueDate ? toDateTimeInputValue(seed.dueDate) : '';
    // Linked when there is no due date yet (fresh) or it already equals the tracked
    // moment (timed → block end; all-day → the day's 23:59). The all-day day is read
    // from the UTC components (floating block), matching how it is displayed below.
    const expectedDue = seed.allDay
      ? `${toDateTimeInputValueUTC(seed.timeStart).slice(0, 10)}T23:59`
      : toDateTimeInputValue(seed.timeEnd);
    linkDueToBlock.value = seed.dueDate === null || toDateTimeInputValue(seed.dueDate) === expectedDue;
    form.isBlocking = seed.isBlocking;
    form.allDay = seed.allDay;
    // All-day blocks are floating (UTC midnight): read their day from the UTC components
    // so it doesn't slip a day in a non-UTC timezone. Timed blocks stay local.
    form.timeStart = seed.allDay ? toDateTimeInputValueUTC(seed.timeStart) : toDateTimeInputValue(seed.timeStart);
    form.timeEnd = seed.allDay ? toDateTimeInputValueUTC(seed.timeEnd) : toDateTimeInputValue(seed.timeEnd);
    form.recurrence = { ...seed.recurrence };
    form.supersedeStaleOccurrences = seed.supersedeStaleOccurrences;
    form.generatesReminder = seed.generatesReminder;
    form.categoryIds = [...seed.categoryIds];
    idItem.value = seed.idItem ?? null;
    idItemOccurrence.value = seed.idItemOccurrence ?? null;
    timeBlockId.value = seed.timeBlockId ?? null;
    errorMessage.value = null;
  },
  { immediate: true },
);

// Switching to Event clears any picked task: events are always new (unique or
// fixed recurrence), never scheduled as another instance of an existing one.
const setType = (type: ItemType): void => {
  form.type = type;
  if (type === 'event') {
    source.value = 'new';
  }
};

const isNew = computed(() => source.value === 'new');
const selectedItem = computed<ItemDto | null>(() =>
  typeof source.value === 'number' ? (props.items.find((item) => item.idItem === source.value) ?? null) : null,
);
// The type that drives due-date visibility: the form's own when creating a new
// item, otherwise the selected existing item's.
const effectiveType = computed<ItemType>(() => (isNew.value ? form.type : (selectedItem.value?.type ?? 'task')));

// The existing-item picker lists TASKS grouped by project, plus the virtual "Task List"
// (project-less tasks) first — those are schedulable too.
const tasks = computed(() => props.items.filter((item) => item.type === 'task'));
const projectGroups = computed(() => {
  const groups = props.projects
    .map((project) => ({ name: project.name, tasks: tasks.value.filter((task) => task.projectId === project.idProject) }))
    .filter((group) => group.tasks.length > 0);
  const taskListTasks = tasks.value.filter((task) => task.projectId === null);
  if (taskListTasks.length > 0) {
    groups.unshift({ name: t('backlog.taskListLabel'), tasks: taskListTasks });
  }
  return groups;
});

// The picker appears only when creating a task; item detail fields hide only when
// scheduling an existing task.
const showPicker = computed(() => form.mode === 'create' && form.type === 'task');
const showItemDetail = computed(() => form.mode === 'edit' || isNew.value);
// Times are editable when creating, and when editing an item that has a placed block.
const showTimeFields = computed(() => form.mode === 'create' || (form.mode === 'edit' && timeBlockId.value !== null));

// Due date linked to the block's end: while linked the field is read-only and tracks
// the end; unlinking frees it for a manual deadline. The link is inferred (no stored
// flag) — the due date equals the block end iff they are linked.
const canLinkDue = computed(() => effectiveType.value === 'task' && showTimeFields.value);
// The moment a linked due date tracks: a timed block → its end; an all-day block → the
// block day's 23:59 (all-day is floating, so we take the day from the start field).
const linkedDueString = (): string => (form.allDay ? `${form.timeStart.slice(0, 10)}T23:59` : form.timeEnd);

// All-day date pickers (no time). They are a DATE-only view over the internal
// datetime-local strings, so the write path is untouched. The end is shown INCLUSIVELY
// (a one-day event reads its own day), while it is stored exclusively (next midnight).
const startDate = computed<string>({
  get: () => form.timeStart.slice(0, 10),
  set: (value) => {
    form.timeStart = `${value}T00:00`;
  },
});
const endDate = computed<string>({
  get: () => {
    const day = fromDateTimeInputValue(form.timeEnd);
    day.setDate(day.getDate() - 1); // exclusive end → inclusive last day
    return toDateInputValue(day);
  },
  set: (value) => {
    const day = fromDateInputValue(value);
    day.setDate(day.getDate() + 1); // inclusive last day → exclusive end
    form.timeEnd = toDateTimeInputValue(day);
  },
});
watch(
  [() => form.timeStart, () => form.timeEnd, () => form.allDay, linkDueToBlock, canLinkDue],
  () => {
    if (canLinkDue.value && linkDueToBlock.value) {
      form.dueDate = linkedDueString(); // datetime-local strings
    }
  },
  { immediate: true },
);

const buildItemFields = (recurring: boolean, recurrenceStart: Date | null) => ({
  type: form.type,
  projectId: form.projectId,
  title: form.title.trim(),
  description: form.description.trim() === '' ? null : form.description.trim(),
  color: form.color,
  estimatedMinutes: form.type === 'task' ? form.estimatedMinutes : null,
  rrule: recurring ? buildRrule(form.recurrence) : null,
  recurrenceStart,
  timezone: browserTimezone(), // the item lives in the creator's timezone (recurrence, dueDate)
  supersedeStaleOccurrences: form.supersedeStaleOccurrences,
  generatesReminder: form.type === 'task' ? form.generatesReminder : true,
  blockingByDefault: form.isBlocking, // the item's default blocking (drives virtual slots + fresh placements)
  categoryIds: [...form.categoryIds], // stored leaves; part of the item input (brief §8)
});

// All-day is FLOATING: store the date at UTC midnight and no timezone, so it never
// shifts across viewers. A timed block stores the instant + the creator's timezone.
const utcMidnight = (date: Date): Date => new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));

const blockPayload = (start: Date, end: Date) => {
  if (!form.allDay) {
    return { timeStart: start, timeEnd: end, allDay: false, isBlocking: form.isBlocking, timezone: browserTimezone() };
  }
  const floatingStart = utcMidnight(start);
  const floatingEnd = utcMidnight(end);
  return {
    timeStart: floatingStart,
    timeEnd: floatingEnd.getTime() <= floatingStart.getTime() ? new Date(floatingStart.getTime() + 86_400_000) : floatingEnd,
    allDay: true,
    isBlocking: false, // all-day floats; it never blocks (use a timed midnight span to block a day)
    timezone: null as string | null,
  };
};

const submit = (): void => {
  errorMessage.value = null;
  const timeStart = fromDateTimeInputValue(form.timeStart);
  const timeEnd = fromDateTimeInputValue(form.timeEnd);
  const dueDate = effectiveType.value === 'task' && form.dueDate !== '' ? fromDateTimeInputValue(form.dueDate) : null;

  // Ordering matters whenever timed bounds are in play (create, or editing a block).
  if (showTimeFields.value && !form.allDay && timeEnd <= timeStart) {
    errorMessage.value = t('itemForm.endAfterStart');
    return;
  }

  // Edit an existing item's fields (and its block bounds when it has one).
  if (form.mode === 'edit' && idItem.value !== null) {
    const recurring = form.recurrence.freq !== 'none';
    const block = timeBlockId.value !== null ? blockPayload(timeStart, timeEnd) : null;
    emit('update', {
      idItem: idItem.value,
      item: buildItemFields(recurring, recurring ? timeStart : null),
      idItemOccurrence: idItemOccurrence.value,
      dueDate,
      timeBlockId: timeBlockId.value,
      timeStart: block?.timeStart ?? null,
      timeEnd: block?.timeEnd ?? null,
      allDay: block?.allDay ?? form.allDay,
      isBlocking: block ? block.isBlocking : form.allDay ? false : form.isBlocking, // all-day can't block
      timezone: block ? block.timezone : form.allDay ? null : browserTimezone(),
    });
    return;
  }

  // Schedule an existing item (no new item created).
  if (typeof source.value === 'number') {
    const block = blockPayload(timeStart, timeEnd);
    emit('schedule', {
      itemId: source.value,
      isRecurrent: selectedItem.value?.rrule != null,
      timeStart: block.timeStart,
      timeEnd: block.timeEnd,
      allDay: block.allDay,
      isBlocking: block.isBlocking,
      dueDate,
      timezone: block.timezone,
    });
    return;
  }

  // Create a brand-new item + occurrence + timeBlock.
  const recurring = form.recurrence.freq !== 'none';
  const input: CreateScheduledItemInput = {
    item: buildItemFields(recurring, recurring ? timeStart : null),
    occurrenceDate: recurring ? timeStart : null,
    dueDate,
    timeBlock: blockPayload(timeStart, timeEnd),
  };
  const parsed = createScheduledItemInput.safeParse(input);
  if (!parsed.success) {
    errorMessage.value = parsed.error.issues[0]?.message ?? t('itemForm.invalidValues');
    return;
  }
  emit('create', parsed.data); // categoryIds travel inside input.item (brief §8)
};
</script>

<template>
  <div v-if="seed" class="overlay" @pointerdown.self="emit('close')">
    <form class="dialog" @submit.prevent="submit">
      <h3>{{ form.mode === 'create' ? t('itemForm.newEntry') : t('itemForm.editItem') }}</h3>

      <!-- Item type: always visible -->
      <div class="type-toggle">
        <button type="button" :class="{ active: form.type === 'task' }" @click="setType('task')">{{ t('itemForm.task') }}</button>
        <button type="button" :class="{ active: form.type === 'event' }" @click="setType('event')">{{ t('itemForm.event') }}</button>
      </div>

      <!-- Existing-task picker (tasks only, grouped by project) -->
      <label v-if="showPicker">
        {{ t('itemForm.task') }}
        <select v-model="source">
          <option value="new">{{ t('itemForm.newTask') }}</option>
          <optgroup v-for="group in projectGroups" :key="group.name" :label="group.name">
            <option v-for="task in group.tasks" :key="task.idItem" :value="task.idItem">{{ task.title }}</option>
          </optgroup>
        </select>
      </label>

      <!-- Item detail fields (hidden when scheduling an existing task) -->
      <template v-if="showItemDetail">
        <ItemCoreFields
          v-model:title="form.title"
          v-model:project-id="form.projectId"
          v-model:description="form.description"
          v-model:category-ids="form.categoryIds"
          v-model:estimated-minutes="form.estimatedMinutes"
          v-model:color="form.color"
          v-model:generates-reminder="form.generatesReminder"
          :projects="projects"
          :show-estimate="form.type === 'task'"
          :show-reminder="form.type === 'task'"
        />

        <fieldset class="recurrence">
          <legend>{{ t('itemForm.recurrence') }}</legend>
          <RecurrenceEditor
            :model-value="form.recurrence"
            v-model:supersede-stale="form.supersedeStaleOccurrences"
            :show-supersede="form.type === 'task' && form.generatesReminder"
            @update:model-value="form.recurrence = $event"
          />
        </fieldset>
      </template>

      <!-- Occurrence / timeBlock fields (always shown). All-day drops the time part. -->
      <div v-if="showTimeFields" class="row">
        <label>
          {{ t('itemForm.start') }}
          <input v-if="form.allDay" v-model="startDate" type="date" required />
          <input v-else v-model="form.timeStart" type="datetime-local" required />
        </label>
        <label>
          {{ t('itemForm.end') }}
          <input v-if="form.allDay" v-model="endDate" type="date" required />
          <input v-else v-model="form.timeEnd" type="datetime-local" required />
        </label>
      </div>

      <div v-if="effectiveType === 'task'" class="due-field">
        <label>
          {{ t('itemForm.dueDate') }}
          <input v-model="form.dueDate" type="datetime-local" :disabled="canLinkDue && linkDueToBlock" />
        </label>
        <label v-if="canLinkDue" class="inline link-due">
          <input v-model="linkDueToBlock" type="checkbox" /> {{ t('itemForm.linkDueToBlock') }}
        </label>
      </div>

      <div class="row">
        <label class="inline"><input v-model="form.allDay" type="checkbox" /> {{ t('itemForm.allDay') }}</label>
        <!-- All-day items float (no timed slot), so they can't block. To block a whole
             day, use a timed midnight-to-midnight event with All day unchecked. -->
        <label v-if="!form.allDay" class="inline"><input v-model="form.isBlocking" type="checkbox" /> {{ t('itemForm.blocking') }}</label>
      </div>

      <p v-if="errorMessage" class="form-error">{{ errorMessage }}</p>

      <div class="actions">
        <button type="button" class="ghost" @click="emit('close')">{{ t('common.cancel') }}</button>
        <button type="submit" class="primary">{{ form.mode === 'create' ? t('itemForm.create') : t('common.save') }}</button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
}

.dialog {
  background: var(--surface);
  border-radius: 10px;
  padding: 18px;
  width: min(420px, calc(100vw - 32px));
  max-height: calc(100vh - 48px);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.25);
}

h3 {
  margin: 0 0 4px;
}

label {
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
}

label.inline {
  flex-direction: row;
  align-items: center;
  gap: 6px;
}

input,
select,
textarea {
  font: inherit;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  background: var(--surface);
}

input[type='checkbox'] {
  width: auto;
}

.narrow {
  width: 64px;
}

.row {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
}

.row > label {
  flex: 1;
}

.due-field {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.due-field .link-due {
  font-weight: 400;
}

.due-field input:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.hint {
  font-size: 12px;
  color: var(--text-muted);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.field-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
}

.type-toggle {
  display: flex;
}

.type-toggle button {
  flex: 1;
  padding: 6px;
  border: 1px solid var(--border);
  background: var(--surface);
  cursor: pointer;
}

.type-toggle button:first-child {
  border-radius: 6px 0 0 6px;
}

.type-toggle button:last-child {
  border-radius: 0 6px 6px 0;
  border-left: none;
}

.type-toggle button.active {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

.recurrence {
  border: 1px solid var(--border);
  border-radius: 6px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

legend {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
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

.form-error {
  color: #b00020;
  font-size: 13px;
  margin: 0;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
}

.actions button {
  padding: 7px 14px;
  border-radius: 6px;
  border: 1px solid var(--border);
  cursor: pointer;
  font: inherit;
}

.actions .primary {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
  font-weight: 600;
}
</style>
