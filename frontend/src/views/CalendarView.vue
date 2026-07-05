<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import type { ItemDto, ProjectDto } from '@ticktaskdone/shared';
import { useCalendarStore, type CalendarMode } from '@/stores/calendar';
import { daysInWindow, type CalendarViewType } from '@/lib/datetime';
import { formatWindowTitle } from '@/lib/format';
import { toCalendarBlocks, type CalendarBlock } from '@/lib/renderables';
import { emptyRecurrence, parseRrule } from '@/lib/recurrenceModel';
import { resolveCopyStrategy } from '@/lib/copyStrategy';
import { listProjects } from '@/api/projects';
import { createScheduledItem } from '@/api/scheduledItems';
import { deleteTimeBlock, updateTimeBlock } from '@/api/timeBlocks';
import { moveOccurrence, scheduleOccurrence, setOccurrenceStatus, updateOccurrence } from '@/api/occurrenceActions';
import { deleteItem, fetchItem, listItems, updateItem } from '@/api/items';
import TimeGrid from '@/components/calendar/TimeGrid.vue';
import CalendarItemForm from '@/components/calendar/CalendarItemForm.vue';
import CalendarContextMenu from '@/components/calendar/CalendarContextMenu.vue';
import type { FormSeed, ScheduleSubmit, UpdateSubmit } from '@/components/calendar/itemForm.types';
import type { MenuAction } from '@/components/calendar/contextMenu.types';

const store = useCalendarStore();
const { view, mode, occurrences, loading, error, window: visibleWindow } = storeToRefs(store);

const viewOptions: { id: CalendarViewType; label: string }[] = [
  { id: 'day', label: 'Day' },
  { id: 'week', label: 'Week' },
  { id: 'workWeek', label: 'Work week' },
  { id: 'month', label: 'Month' },
  { id: 'list', label: 'List' },
];
const modeOptions: { id: CalendarMode; label: string }[] = [
  { id: 'planned', label: 'Planned' },
  { id: 'actual', label: 'Actual' },
];

const gridViews: CalendarViewType[] = ['day', 'week', 'workWeek'];
const isGridView = computed(() => gridViews.includes(view.value));

const days = computed(() => daysInWindow(visibleWindow.value));
const blocks = computed(() => toCalendarBlocks(occurrences.value));
const title = computed(() => formatWindowTitle(view.value, visibleWindow.value));

const projects = ref<ProjectDto[]>([]);
const items = ref<ItemDto[]>([]);
const formSeed = ref<FormSeed | null>(null);
const menu = ref<{ open: boolean; x: number; y: number; block: CalendarBlock | null }>({
  open: false,
  x: 0,
  y: 0,
  block: null,
});

const refreshItems = async (): Promise<void> => {
  items.value = (await listItems().catch(() => [])) ?? [];
};

onMounted(async () => {
  await store.load();
  projects.value = (await listProjects().catch(() => [])) ?? [];
  await refreshItems();
});

// Reload when the visible window changes (navigation / view switch). Wrapped so no
// argument is forwarded to load() — that would silence its loading state.
watch(visibleWindow, () => {
  void store.load();
});

// --- Scheduling primitives --------------------------------------------------

// Move/resize: patch the existing block, or materialize + place a virtual one.
const reschedule = (block: CalendarBlock, start: Date, end: Date): Promise<unknown> =>
  block.timeBlockId !== null
    ? updateTimeBlock(block.timeBlockId, { timeStart: start, timeEnd: end })
    : moveOccurrence(block.occurrence.itemId, {
        occurrenceDate: block.occurrence.occurrenceDate ? new Date(block.occurrence.occurrenceDate) : null,
        timeStart: start,
        timeEnd: end,
      });

const setStatus = (block: CalendarBlock, status: 'todo' | 'done' | 'cancelled'): Promise<unknown> =>
  setOccurrenceStatus(block.occurrence.itemId, {
    occurrenceDate: block.occurrence.occurrenceDate ? new Date(block.occurrence.occurrenceDate) : null,
    status,
  });

// ALT-copy / Duplicate: route by the brief §2 decision tree.
const copyBlock = async (block: CalendarBlock, start: Date, end: Date): Promise<unknown> => {
  const source = block.occurrence;
  const strategy = resolveCopyStrategy({
    type: source.type,
    status: source.status,
    isRecurrent: source.isRecurrent,
    projectId: source.projectId,
  });

  if (strategy === 'split' || strategy === 'customOccurrence') {
    // Both go through the schedule primitive (materialize + add a block): a split
    // adds a block to the source occurrence; a customOccurrence anchors a fresh
    // off-rule occurrence at the drop. A task is never both recurrent and split.
    return scheduleOccurrence(source.itemId, {
      occurrenceDate:
        strategy === 'customOccurrence' ? start : source.occurrenceDate ? new Date(source.occurrenceDate) : null,
      timeStart: start,
      timeEnd: end,
      allDay: block.allDay,
      isBlocking: block.isBlocking,
      dueDate: null,
    });
  }
  // simpleCopy: a brand-new single-instance item copying the source's fields.
  const item = await fetchItem(source.itemId);
  return createScheduledItem({
    item: {
      type: item.type,
      projectId: item.projectId,
      title: item.title,
      description: item.description,
      color: item.color,
      estimatedMinutes: item.estimatedMinutes,
      rrule: null,
      recurrenceStart: null,
    },
    occurrenceDate: null,
    dueDate: null,
    timeBlock: { timeStart: start, timeEnd: end, allDay: block.allDay, isBlocking: block.isBlocking },
  });
};

// --- Grid event handlers ----------------------------------------------------

const openCreate = (start: Date, end: Date): void => {
  void refreshItems(); // keep the existing-item picker fresh
  formSeed.value = {
    mode: 'create',
    timeStart: start,
    timeEnd: end,
    type: 'task',
    title: '',
    projectId: null,
    description: null,
    color: null,
    estimatedMinutes: null,
    dueDate: null,
    isBlocking: false,
    allDay: false,
    recurrence: emptyRecurrence(),
  };
};

const openNew = (): void => {
  const start = new Date(visibleWindow.value.from.getTime() + 9 * 60 * 60_000);
  openCreate(start, new Date(start.getTime() + 60 * 60_000));
};

const onCreate = (payload: { start: Date; end: Date }): void => openCreate(payload.start, payload.end);
const onMove = (payload: { block: CalendarBlock; start: Date; end: Date }): void => {
  // Optimistic: move the materialized block locally so it follows the drop at once.
  if (payload.block.timeBlockId !== null) {
    store.patchLocalTimeBlock(payload.block.timeBlockId, payload.start.toISOString(), payload.end.toISOString());
  }
  store.apply(() => reschedule(payload.block, payload.start, payload.end));
};
const onResize = onMove;
const onCopy = (payload: { block: CalendarBlock; start: Date; end: Date }): void => {
  store.apply(() => copyBlock(payload.block, payload.start, payload.end));
};
const onToggle = (payload: { block: CalendarBlock }): void => {
  store.apply(() => setStatus(payload.block, payload.block.occurrence.status === 'done' ? 'todo' : 'done'));
};
const onMenu = (payload: { block: CalendarBlock; x: number; y: number }): void => {
  menu.value = { open: true, x: payload.x, y: payload.y, block: payload.block };
};

const openEdit = async (block: CalendarBlock): Promise<void> => {
  const item = await fetchItem(block.occurrence.itemId).catch(() => null);
  if (!item) {
    error.value = 'Could not load the item to edit.';
    return;
  }
  formSeed.value = {
    mode: 'edit',
    timeStart: block.start,
    timeEnd: block.end,
    idItem: item.idItem,
    idItemOccurrence: block.occurrence.idItemOccurrence,
    timeBlockId: block.timeBlockId,
    type: item.type,
    title: item.title,
    projectId: item.projectId,
    description: item.description,
    color: item.color,
    estimatedMinutes: item.estimatedMinutes,
    dueDate: block.occurrence.dueDate ? new Date(block.occurrence.dueDate) : null,
    isBlocking: block.isBlocking,
    allDay: block.allDay,
    recurrence: parseRrule(item.rrule),
  };
};

const menuActions = computed<MenuAction[]>(() => {
  const block = menu.value.block;
  if (!block) {
    return [];
  }
  const occurrence = block.occurrence;
  const actions: MenuAction[] = [
    { id: 'edit', label: 'Edit…' },
    { id: 'duplicate', label: 'Duplicate' },
  ];
  if (occurrence.type === 'task') {
    actions.push(occurrence.status === 'done' ? { id: 'reopen', label: 'Mark as to-do' } : { id: 'done', label: 'Mark as done' });
    if (occurrence.status !== 'cancelled') {
      actions.push({ id: 'skip', label: 'Skip (cancel)' });
    }
  }
  if (block.timeBlockId !== null) {
    actions.push({ id: 'unschedule', label: 'Unschedule' });
  }
  actions.push({ id: 'delete', label: 'Delete item', danger: true });
  return actions;
});

const onMenuSelect = (id: string): void => {
  const block = menu.value.block;
  menu.value.open = false;
  if (!block) {
    return;
  }
  switch (id) {
    case 'edit':
      void openEdit(block);
      break;
    case 'duplicate':
      store.apply(() => copyBlock(block, block.start, block.end));
      break;
    case 'done':
      store.apply(() => setStatus(block, 'done'));
      break;
    case 'reopen':
      store.apply(() => setStatus(block, 'todo'));
      break;
    case 'skip':
      store.apply(() => setStatus(block, 'cancelled'));
      break;
    case 'unschedule':
      if (block.timeBlockId !== null) {
        const idTimeBlock = block.timeBlockId;
        store.apply(() => deleteTimeBlock(idTimeBlock));
      }
      break;
    case 'delete':
      store.apply(() => deleteItem(block.occurrence.itemId));
      break;
  }
};

// --- Form handlers ----------------------------------------------------------

const onFormCreate = (input: Parameters<typeof createScheduledItem>[0]): void => {
  store.apply(() => createScheduledItem(input));
  formSeed.value = null;
};

const onFormSchedule = (payload: ScheduleSubmit): void => {
  // Recurrent -> new custom occurrence at the drop; non-recurrent -> a split on its
  // single occurrence. Same primitive as ALT-copy.
  store.apply(() =>
    scheduleOccurrence(payload.itemId, {
      occurrenceDate: payload.isRecurrent ? payload.timeStart : null,
      timeStart: payload.timeStart,
      timeEnd: payload.timeEnd,
      allDay: payload.allDay,
      isBlocking: payload.isBlocking,
      dueDate: payload.dueDate,
    }),
  );
  formSeed.value = null;
};

const onFormUpdate = (payload: UpdateSubmit): void => {
  store.apply(async () => {
    await updateItem(payload.idItem, payload.item);
    if (payload.idItemOccurrence !== null) {
      await updateOccurrence(payload.idItem, payload.idItemOccurrence, { dueDate: payload.dueDate });
    }
    if (payload.timeBlockId !== null) {
      await updateTimeBlock(payload.timeBlockId, { allDay: payload.allDay, isBlocking: payload.isBlocking });
    }
  });
  formSeed.value = null;
};
</script>

<template>
  <section class="calendar">
    <header class="toolbar">
      <div class="nav-group">
        <button type="button" @click="store.step(-1)" aria-label="Previous">‹</button>
        <button type="button" class="today" @click="store.goToToday()">Today</button>
        <button type="button" @click="store.step(1)" aria-label="Next">›</button>
      </div>

      <h2 class="title">{{ title }}</h2>

      <button type="button" class="new" :disabled="loading" @click="openNew">+ New</button>

      <div class="spacer" />

      <div class="segmented mode">
        <button
          v-for="option in modeOptions"
          :key="option.id"
          type="button"
          :class="{ active: mode === option.id }"
          @click="store.setMode(option.id)"
        >
          {{ option.label }}
        </button>
      </div>

      <div class="segmented views">
        <button
          v-for="option in viewOptions"
          :key="option.id"
          type="button"
          :class="{ active: view === option.id }"
          @click="store.setView(option.id)"
        >
          {{ option.label }}
        </button>
      </div>
    </header>

    <p v-if="error" class="banner error">{{ error }}</p>

    <div class="body">
      <p v-if="mode === 'actual'" class="placeholder">
        The <strong>Actual</strong> view (timeLogs) arrives in a later Phase 4 milestone.
      </p>
      <TimeGrid
        v-else-if="isGridView"
        :days="days"
        :blocks="blocks"
        @create="onCreate"
        @move="onMove"
        @resize="onResize"
        @copy="onCopy"
        @toggle="onToggle"
        @menu="onMenu"
        @edit="(payload) => openEdit(payload.block)"
      />
      <p v-else class="placeholder">
        The <strong>{{ view }}</strong> view arrives in a later Phase 4 milestone.
      </p>

      <!-- Overlay covers the whole calendar while (re)loading: obvious, no layout
           shift, and it blocks interaction so nothing is added mid-load. -->
      <div v-if="loading" class="loading-overlay">
        <span class="spinner" aria-hidden="true" />
        <span>Loading…</span>
      </div>
    </div>

    <CalendarContextMenu
      :open="menu.open"
      :x="menu.x"
      :y="menu.y"
      :actions="menuActions"
      @select="onMenuSelect"
      @close="menu.open = false"
    />

    <CalendarItemForm
      :seed="formSeed"
      :projects="projects"
      :items="items"
      @create="onFormCreate"
      @schedule="onFormSchedule"
      @update="onFormUpdate"
      @close="formSeed = null"
    />
  </section>
</template>

<style scoped>
.calendar {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  gap: 10px;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.title {
  font-size: 15px;
  font-weight: 600;
  margin: 0;
}

.spacer {
  flex: 1;
}

.nav-group {
  display: flex;
  gap: 4px;
}

button {
  font: inherit;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
  padding: 5px 10px;
  border-radius: 6px;
  cursor: pointer;
}

button:hover {
  background: var(--surface-hover);
}

.today,
.new {
  font-weight: 600;
}

.new {
  color: var(--accent);
  border-color: var(--accent);
}

.segmented {
  display: flex;
}

.segmented button {
  border-radius: 0;
  border-left-width: 0;
}

.segmented button:first-child {
  border-left-width: 1px;
  border-top-left-radius: 6px;
  border-bottom-left-radius: 6px;
}

.segmented button:last-child {
  border-top-right-radius: 6px;
  border-bottom-right-radius: 6px;
}

.segmented button.active {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

.banner {
  margin: 0;
  font-size: 13px;
  color: var(--text-muted);
}

.banner.error {
  color: #b00020;
}

.body {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
}

.body > * {
  flex: 1;
  min-height: 0;
}

.placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  border: 1px dashed var(--border);
  border-radius: 8px;
}

.loading-overlay {
  position: absolute;
  inset: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  background: rgba(250, 251, 252, 0.6);
  color: var(--text-muted);
  font-weight: 600;
}

.spinner {
  width: 20px;
  height: 20px;
  border: 3px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

button:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
