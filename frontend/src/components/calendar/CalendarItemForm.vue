<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import {
  createScheduledItemInput,
  type CreateScheduledItemInput,
  type ItemDto,
  type ItemType,
  type ProjectDto,
} from '@ticktaskdone/shared';
import { browserTimezone, fromDateTimeInputValue, toDateTimeInputValue } from '@/lib/datetime';
import { buildRrule, emptyRecurrence, type Frequency, type RecurrenceModel } from '@/lib/recurrenceModel';
import CategoryPicker from './CategoryPicker.vue';
import type { CategoryDto } from '@ticktaskdone/shared';
import type { FormSeed, ScheduleSubmit, UpdateSubmit } from './itemForm.types';

const props = defineProps<{ seed: FormSeed | null; projects: ProjectDto[]; items: ItemDto[] }>();
const emit = defineEmits<{
  create: [CreateScheduledItemInput];
  schedule: [ScheduleSubmit];
  update: [UpdateSubmit];
  close: [];
}>();

const DEFAULT_COLOR = '#3366cc';

const form = reactive({
  mode: 'create' as 'create' | 'edit',
  type: 'task' as ItemType,
  title: '',
  projectId: null as number | null,
  description: '',
  useColor: false,
  color: DEFAULT_COLOR,
  estimatedMinutes: null as number | null,
  dueDate: '' as string,
  isBlocking: true, // items reserve their slot (block) by default
  allDay: false,
  timeStart: '' as string,
  timeEnd: '' as string,
  recurrence: emptyRecurrence() as RecurrenceModel,
  categoryIds: [] as number[],
});
// 'new' creates a brand-new item; a number schedules that existing item instead.
const source = ref<'new' | number>('new');
const idItem = ref<number | null>(null);
const idItemOccurrence = ref<number | null>(null);
const timeBlockId = ref<number | null>(null);
const errorMessage = ref<string | null>(null);

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
    form.useColor = seed.color !== null;
    form.color = seed.color ?? DEFAULT_COLOR;
    form.estimatedMinutes = seed.estimatedMinutes;
    form.dueDate = seed.dueDate ? toDateTimeInputValue(seed.dueDate) : '';
    form.isBlocking = seed.isBlocking;
    form.allDay = seed.allDay;
    form.timeStart = toDateTimeInputValue(seed.timeStart);
    form.timeEnd = toDateTimeInputValue(seed.timeEnd);
    form.recurrence = { ...seed.recurrence };
    form.categoryIds = [...seed.categoryIds];
    idItem.value = seed.idItem ?? null;
    idItemOccurrence.value = seed.idItemOccurrence ?? null;
    timeBlockId.value = seed.timeBlockId ?? null;
    errorMessage.value = null;
  },
  { immediate: true },
);

const frequencies: { id: Frequency; label: string }[] = [
  { id: 'none', label: 'Does not repeat' },
  { id: 'daily', label: 'Daily' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'monthly', label: 'Monthly' },
];

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

// The existing-item picker lists project TASKS ONLY, grouped by project. Ephemeral
// tasks (no project) are excluded: an ephemeral task is single-use by definition.
const tasks = computed(() => props.items.filter((item) => item.type === 'task'));
const projectGroups = computed(() =>
  props.projects
    .map((project) => ({ name: project.name, tasks: tasks.value.filter((task) => task.projectId === project.idProject) }))
    .filter((group) => group.tasks.length > 0),
);

// The picker appears only when creating a task; item detail fields hide only when
// scheduling an existing task.
const showPicker = computed(() => form.mode === 'create' && form.type === 'task');
const showItemDetail = computed(() => form.mode === 'edit' || isNew.value);
// Times are editable when creating, and when editing an item that has a placed block.
const showTimeFields = computed(() => form.mode === 'create' || (form.mode === 'edit' && timeBlockId.value !== null));

// --- Category selection & auto-color (brief §5) -----------------------------
// The full category tree, provided by the picker, to resolve lineage color.
const categoryTree = ref<CategoryDto[]>([]);

// Walk a category's ancestry to the first color (categories always carry one, but
// the walk honors the brief's `category.color ?? parent.color ?? …`).
const resolveCategoryColor = (categoryId: number): string | null => {
  const byId = new Map(categoryTree.value.map((category) => [category.idCategory, category]));
  let current = byId.get(categoryId);
  while (current) {
    if (current.color) {
      return current.color;
    }
    current = current.parentCategoryId !== null ? byId.get(current.parentCategoryId) : undefined;
  }
  return null;
};

// Runs only on an actual pick (never on seed load, since we bind via a handler):
// the FIRST chosen category paints item.color, but only for an item with no project
// and no custom color yet. Once color is set it is custom and later picks leave it.
const onCategoriesChange = (categoryIds: number[]): void => {
  const added = categoryIds.length > form.categoryIds.length;
  const first = categoryIds[0];
  if (added && first !== undefined && form.projectId === null && !form.useColor) {
    const color = resolveCategoryColor(first);
    if (color !== null) {
      form.color = color;
      form.useColor = true;
    }
  }
  form.categoryIds = categoryIds;
};

const buildItemFields = (recurring: boolean, recurrenceStart: Date | null) => ({
  type: form.type,
  projectId: form.projectId,
  title: form.title.trim(),
  description: form.description.trim() === '' ? null : form.description.trim(),
  color: form.useColor ? form.color : null,
  estimatedMinutes: form.type === 'task' ? form.estimatedMinutes : null,
  rrule: recurring ? buildRrule(form.recurrence) : null,
  recurrenceStart,
  timezone: browserTimezone(), // the item lives in the creator's timezone (recurrence, dueDate)
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
    errorMessage.value = 'End must be after start.';
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
    errorMessage.value = parsed.error.issues[0]?.message ?? 'Invalid values.';
    return;
  }
  emit('create', parsed.data); // categoryIds travel inside input.item (brief §8)
};
</script>

<template>
  <div v-if="seed" class="overlay" @pointerdown.self="emit('close')">
    <form class="dialog" @submit.prevent="submit">
      <h3>{{ form.mode === 'create' ? 'New calendar entry' : 'Edit item' }}</h3>

      <!-- Item type: always visible -->
      <div class="type-toggle">
        <button type="button" :class="{ active: form.type === 'task' }" @click="setType('task')">Task</button>
        <button type="button" :class="{ active: form.type === 'event' }" @click="setType('event')">Event</button>
      </div>

      <!-- Existing-task picker (tasks only, grouped by project) -->
      <label v-if="showPicker">
        Task
        <select v-model="source">
          <option value="new">New task…</option>
          <optgroup v-for="group in projectGroups" :key="group.name" :label="group.name">
            <option v-for="task in group.tasks" :key="task.idItem" :value="task.idItem">{{ task.title }}</option>
          </optgroup>
        </select>
      </label>

      <!-- Item detail fields (hidden when scheduling an existing task) -->
      <template v-if="showItemDetail">
        <label>
          Title
          <input v-model="form.title" type="text" maxlength="255" required />
        </label>

        <label>
          Project
          <select v-model="form.projectId">
            <option :value="null">None (ephemeral)</option>
            <option v-for="project in projects" :key="project.idProject" :value="project.idProject">
              {{ project.name }}
            </option>
          </select>
        </label>

        <label>
          Description
          <textarea v-model="form.description" rows="2" />
        </label>

        <div class="row">
          <label class="inline">
            <input v-model="form.useColor" type="checkbox" />
            Custom color
          </label>
          <input v-if="form.useColor" v-model="form.color" type="color" />
          <span v-else class="hint">Uses the project / default color</span>
        </div>

        <label v-if="form.type === 'task'">
          Estimated minutes
          <input v-model.number="form.estimatedMinutes" type="number" min="1" />
        </label>

        <fieldset class="recurrence">
          <legend>Recurrence</legend>
          <select v-model="form.recurrence.freq">
            <option v-for="frequency in frequencies" :key="frequency.id" :value="frequency.id">
              {{ frequency.label }}
            </option>
          </select>
          <template v-if="form.recurrence.freq !== 'none'">
            <label class="inline">
              every
              <input v-model.number="form.recurrence.interval" type="number" min="1" class="narrow" />
            </label>
            <label class="inline">
              for
              <input v-model.number="form.recurrence.count" type="number" min="1" class="narrow" placeholder="∞" />
              times
            </label>
          </template>
        </fieldset>

        <div class="field">
          <span class="field-label">Categories</span>
          <CategoryPicker
            :model-value="form.categoryIds"
            @update:model-value="onCategoriesChange"
            @loaded="categoryTree = $event"
          />
        </div>
      </template>

      <!-- Occurrence / timeBlock fields (always shown) -->
      <div v-if="showTimeFields" class="row">
        <label>
          Start
          <input v-model="form.timeStart" type="datetime-local" required />
        </label>
        <label>
          End
          <input v-model="form.timeEnd" type="datetime-local" required />
        </label>
      </div>

      <label v-if="effectiveType === 'task'">
        Due date
        <input v-model="form.dueDate" type="datetime-local" />
      </label>

      <div class="row">
        <label class="inline"><input v-model="form.allDay" type="checkbox" /> All day</label>
        <!-- All-day items float (no timed slot), so they can't block. To block a whole
             day, use a timed midnight-to-midnight event with All day unchecked. -->
        <label v-if="!form.allDay" class="inline"><input v-model="form.isBlocking" type="checkbox" /> Blocking</label>
      </div>

      <p v-if="errorMessage" class="form-error">{{ errorMessage }}</p>

      <div class="actions">
        <button type="button" class="ghost" @click="emit('close')">Cancel</button>
        <button type="submit" class="primary">{{ form.mode === 'create' ? 'Create' : 'Save' }}</button>
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
