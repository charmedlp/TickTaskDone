<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import type { ItemDto, ProjectDto } from '@ticktaskdone/shared';
import { useCalendarStore, type CalendarMode } from '@/stores/calendar';
import { browserTimezone, daysInWindow, fromDateInputValue, toDateInputValue, type CalendarViewType } from '@/lib/datetime';
import { formatWindowTitle } from '@/lib/format';
import { toCalendarBlocks, type CalendarBlock } from '@/lib/renderables';
import { emptyRecurrence, parseRrule } from '@/lib/recurrenceModel';
import { resolveCopyStrategy } from '@/lib/copyStrategy';
import { listProjects } from '@/api/projects';
import { createScheduledItem } from '@/api/scheduledItems';
import { deleteTimeBlock, updateTimeBlock } from '@/api/timeBlocks';
import { moveOccurrence, scheduleOccurrence, setOccurrenceStatus, updateOccurrence } from '@/api/occurrenceActions';
import { deleteItem, fetchItem, listItems, updateItem } from '@/api/items';
import type { BacklogTaskDto, ReminderDto } from '@ticktaskdone/shared';
import TimeGrid from '@/components/calendar/TimeGrid.vue';
import MonthGrid from '@/components/calendar/MonthGrid.vue';
import CalendarListView from '@/components/calendar/CalendarListView.vue';
import CalendarItemForm from '@/components/calendar/CalendarItemForm.vue';
import CalendarContextMenu from '@/components/calendar/CalendarContextMenu.vue';
import BacklogSidebar from '@/components/calendar/BacklogSidebar.vue';
import TimerOverlay from '@/components/calendar/TimerOverlay.vue';
import { timerKey, type TimerSession } from '@/components/calendar/timer.types';
import type { FormSeed, ScheduleSubmit, UpdateSubmit } from '@/components/calendar/itemForm.types';
import type { MenuAction } from '@/components/calendar/contextMenu.types';

const store = useCalendarStore();
const { view, mode, anchor, occurrences, backlog, reminders, loading, error, window: visibleWindow } = storeToRefs(store);

// Two-way binding for the <input type="date"> start-date picker.
const anchorInput = computed({
  get: () => toDateInputValue(anchor.value),
  set: (value: string) => {
    if (value) {
      store.setAnchor(fromDateInputValue(value));
    }
  },
});

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
const blocks = computed(() => toCalendarBlocks(occurrences.value, mode.value));
// Actual view renders real time logs, which only the timer (M4c) may write, so the
// calendar is read-only there: no create / move / resize / copy / backlog-drop.
const readonly = computed(() => mode.value === 'actual');
const title = computed(() => formatWindowTitle(view.value, visibleWindow.value));

const projects = ref<ProjectDto[]>([]);
const items = ref<ItemDto[]>([]);
const formSeed = ref<FormSeed | null>(null);

// Active timer sessions (planned view only). Several run at once — the user
// oscillates between tasks by pausing one and starting another. One timer per task
// slot (a second click on the same task is ignored). On close the feed is reloaded
// so freshly captured time shows in the Actual view.
const timerSessions = ref<TimerSession[]>([]);
const onTimer = (payload: { block: CalendarBlock }): void => {
  const occurrence = payload.block.occurrence;
  const key = timerKey(occurrence.itemId, occurrence.occurrenceDate);
  if (timerSessions.value.some((session) => session.key === key)) {
    return; // this task is already being timed
  }
  timerSessions.value.push({
    key,
    itemId: occurrence.itemId,
    title: occurrence.title,
    occurrenceDate: occurrence.occurrenceDate,
    idItemOccurrence: occurrence.idItemOccurrence,
  });
};
const onTimerClose = (key: string): void => {
  timerSessions.value = timerSessions.value.filter((session) => session.key !== key);
  void store.load(true);
};
const menu = ref<{ open: boolean; x: number; y: number; block: CalendarBlock | null }>({
  open: false,
  x: 0,
  y: 0,
  block: null,
});

// --- Backlog drag-to-schedule -----------------------------------------------
const timeGridRef = ref<InstanceType<typeof TimeGrid> | null>(null);
const monthGridRef = ref<InstanceType<typeof MonthGrid> | null>(null);
const backlogDrag = ref<{ task: BacklogTaskDto; x: number; y: number } | null>(null);

const onBacklogMove = (event: PointerEvent): void => {
  if (backlogDrag.value) {
    backlogDrag.value = { ...backlogDrag.value, x: event.clientX, y: event.clientY };
  }
};
const onBacklogUp = (event: PointerEvent): void => {
  const drag = backlogDrag.value;
  window.removeEventListener('pointermove', onBacklogMove);
  window.removeEventListener('pointerup', onBacklogUp);
  backlogDrag.value = null;
  if (!drag) {
    return;
  }
  // Drop onto whichever grid is mounted (Day/Week/WorkWeek or Month); List has none.
  const drop = (timeGridRef.value ?? monthGridRef.value)?.dropAt(
    event.clientX,
    event.clientY,
    drag.task.estimatedMinutes ?? 60,
  );
  if (drop) {
    store.apply(() =>
      scheduleOccurrence(drag.task.itemId, {
        occurrenceDate: null,
        timeStart: drop.start,
        timeEnd: drop.end,
        allDay: false,
        isBlocking: false,
        dueDate: null,
        timezone: browserTimezone(),
      }),
    );
  }
};
const onBacklogDragStart = (payload: { task: BacklogTaskDto; event: PointerEvent }): void => {
  if (readonly.value) {
    return; // scheduling is a planned-view action; Actual is read-only
  }
  backlogDrag.value = { task: payload.task, x: payload.event.clientX, y: payload.event.clientY };
  window.addEventListener('pointermove', onBacklogMove);
  window.addEventListener('pointerup', onBacklogUp);
};

// The live drop point handed to the active grid, which draws the dashed preview.
const dropPoint = computed(() =>
  backlogDrag.value
    ? { x: backlogDrag.value.x, y: backlogDrag.value.y, durationMinutes: backlogDrag.value.task.estimatedMinutes ?? 60 }
    : null,
);

const refreshItems = async (): Promise<void> => {
  items.value = (await listItems().catch(() => [])) ?? [];
};

onMounted(async () => {
  await store.load();
  await store.loadBacklog();
  projects.value = (await listProjects().catch(() => [])) ?? [];
  await refreshItems();
});

// Reload when the visible window changes (navigation / view switch). Wrapped so no
// argument is forwarded to load() — that would silence its loading state.
watch(visibleWindow, () => {
  void store.load();
});

// --- Scheduling primitives --------------------------------------------------

const utcMidnight = (date: Date): Date => new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));

// Placement for a (re)scheduled block: timed blocks carry the viewer's timezone;
// all-day blocks stay floating (UTC-midnight date, no timezone), keeping their span.
const placementFor = (block: CalendarBlock, start: Date, end: Date): { timeStart: Date; timeEnd: Date; timezone: string | null } => {
  if (!block.allDay) {
    return { timeStart: start, timeEnd: end, timezone: browserTimezone() };
  }
  const floatingStart = utcMidnight(start);
  const spanDays = Math.max(1, Math.round((block.end.getTime() - block.start.getTime()) / 86_400_000));
  return { timeStart: floatingStart, timeEnd: new Date(floatingStart.getTime() + spanDays * 86_400_000), timezone: null };
};

// Move/resize: patch the existing block, or materialize + place a virtual one.
const reschedule = (block: CalendarBlock, start: Date, end: Date): Promise<unknown> => {
  const placement = placementFor(block, start, end);
  return block.timeBlockId !== null
    ? updateTimeBlock(block.timeBlockId, placement)
    : moveOccurrence(block.occurrence.itemId, {
        occurrenceDate: block.occurrence.occurrenceDate ? new Date(block.occurrence.occurrenceDate) : null,
        ...placement,
      });
};

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
    const placement = placementFor(block, start, end);
    return scheduleOccurrence(source.itemId, {
      occurrenceDate: strategy === 'customOccurrence' ? placement.timeStart : source.occurrenceDate ? new Date(source.occurrenceDate) : null,
      ...placement,
      allDay: block.allDay,
      isBlocking: block.isBlocking,
      dueDate: null,
    });
  }
  // simpleCopy: a brand-new single-instance item copying the source's fields.
  const item = await fetchItem(source.itemId);
  const placement = placementFor(block, start, end);
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
      timezone: browserTimezone(),
    },
    occurrenceDate: null,
    dueDate: null,
    timeBlock: { ...placement, allDay: block.allDay, isBlocking: block.isBlocking },
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
    categoryIds: [],
  };
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
    categoryIds: item.categoryIds, // now carried by ItemDto (brief §8)
  };
};

// Open an overdue reminder's task for editing. It may have no timeBlock, so we anchor
// the (unused-in-edit) time fields to its effective deadline.
const onReminder = async (payload: { reminder: ReminderDto }): Promise<void> => {
  const reminder = payload.reminder;
  const item = await fetchItem(reminder.itemId).catch(() => null);
  if (!item) {
    error.value = 'Could not load the item to edit.';
    return;
  }
  const anchorIso = reminder.dueDate ?? reminder.occurrenceDate;
  const start = anchorIso ? new Date(anchorIso) : new Date();
  formSeed.value = {
    mode: 'edit',
    timeStart: start,
    timeEnd: new Date(start.getTime() + 30 * 60_000),
    idItem: item.idItem,
    idItemOccurrence: reminder.idItemOccurrence,
    timeBlockId: null,
    type: item.type,
    title: item.title,
    projectId: item.projectId,
    description: item.description,
    color: item.color,
    estimatedMinutes: item.estimatedMinutes,
    dueDate: reminder.dueDate ? new Date(reminder.dueDate) : null,
    isBlocking: false,
    allDay: false,
    recurrence: parseRrule(item.rrule),
    categoryIds: item.categoryIds,
  };
};

const menuActions = computed<MenuAction[]>(() => {
  const block = menu.value.block;
  if (!block) {
    return [];
  }
  const occurrence = block.occurrence;
  const actions: MenuAction[] = [{ id: 'edit', label: 'Edit…' }];
  // Duplicate creates a PLANNED block, so it is a planned-view-only action (an actual
  // block has no timeBlock to copy from anyway).
  if (!readonly.value) {
    actions.push({ id: 'duplicate', label: 'Duplicate' });
  }
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
      if (!readonly.value) {
        store.apply(() => copyBlock(block, block.start, block.end));
      }
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
  // categoryIds travel inside input.item; the backend creates the links atomically.
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
      timezone: payload.timezone,
    }),
  );
  formSeed.value = null;
};

const onFormUpdate = (payload: UpdateSubmit): void => {
  store.apply(async () => {
    // payload.item includes categoryIds — synced within the item update transaction.
    await updateItem(payload.idItem, payload.item);
    if (payload.idItemOccurrence !== null) {
      await updateOccurrence(payload.idItem, payload.idItemOccurrence, { dueDate: payload.dueDate });
    }
    if (payload.timeBlockId !== null) {
      await updateTimeBlock(payload.timeBlockId, {
        allDay: payload.allDay,
        isBlocking: payload.isBlocking,
        timezone: payload.timezone,
      });
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

      <input v-model="anchorInput" type="date" class="date-input" aria-label="Go to date" />

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

    <div class="workspace">
      <div class="body">
        <TimeGrid
          v-if="isGridView"
          ref="timeGridRef"
          :days="days"
          :blocks="blocks"
          :drop-point="dropPoint"
          :readonly="readonly"
          :reminders="reminders"
          @create="onCreate"
          @move="onMove"
          @resize="onResize"
          @copy="onCopy"
          @toggle="onToggle"
          @menu="onMenu"
          @edit="(payload) => openEdit(payload.block)"
          @timer="onTimer"
          @reminder="onReminder"
        />
        <MonthGrid
          v-else-if="view === 'month'"
          ref="monthGridRef"
          :days="days"
          :blocks="blocks"
          :drop-point="dropPoint"
          :readonly="readonly"
          @create="onCreate"
          @move="onMove"
          @menu="onMenu"
          @toggle="onToggle"
          @edit="(payload) => openEdit(payload.block)"
        />
        <CalendarListView
          v-else
          :days="days"
          :blocks="blocks"
          @menu="onMenu"
          @toggle="onToggle"
          @edit="(payload) => openEdit(payload.block)"
        />

        <!-- Overlay covers the whole calendar while (re)loading: obvious, no layout
             shift, and it blocks interaction so nothing is added mid-load. -->
        <div v-if="loading" class="loading-overlay">
          <span class="spinner" aria-hidden="true" />
          <span>Loading…</span>
        </div>
      </div>

      <BacklogSidebar :tasks="backlog" :projects="projects" @dragstart="onBacklogDragStart" />
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

    <TimerOverlay
      v-for="(session, index) in timerSessions"
      :key="session.key"
      :session="session"
      :index="index"
      @close="onTimerClose(session.key)"
    />

    <div
      v-if="backlogDrag"
      class="drag-ghost"
      :style="{ left: `${backlogDrag.x + 12}px`, top: `${backlogDrag.y + 12}px` }"
    >
      {{ backlogDrag.task.title }}
    </div>
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

.today {
  font-weight: 600;
}

.date-input {
  font: inherit;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
  padding: 4px 8px;
  border-radius: 6px;
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

.workspace {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: 10px;
}

.body {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
}

.drag-ghost {
  position: fixed;
  z-index: 300;
  pointer-events: none;
  background: var(--accent);
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  padding: 4px 10px;
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
