<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { layoutColumn, type LayoutBox } from '@/lib/layout';
import type { ReminderDto } from '@ticktaskdone/shared';
import { allDayBlocksForDay, timedBlocksForDay, type CalendarBlock } from '@/lib/renderables';
import { formatDayHeader, formatHourLabel, formatFullDay } from '@/lib/format';
import { MINUTES_PER_DAY, startOfDay, toDateTimeInputValue, fromDateTimeInputValue } from '@/lib/datetime';
import { DEFAULT_CREATE_MINUTES, HOUR_HEIGHT, minutesToY, snapMinutes, yToMinutes } from '@/lib/grid';
import { useCalendarDrag, type BlockContext } from '@/composables/useCalendarDrag';
import CalendarBlockView from './CalendarBlockView.vue';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

const props = defineProps<{
  days: Date[];
  blocks: CalendarBlock[];
  // Live pointer of an in-progress backlog drag, to draw the dashed drop preview.
  dropPoint?: { x: number; y: number; durationMinutes: number } | null;
  // Actual view is read-only: no create / move / resize / copy (only view + menu).
  readonly?: boolean;
  // Overdue todo tasks, shown as a one-row band pinned to today's column.
  reminders?: ReminderDto[];
  // Occurrence ids that are overdue, so their blocks can be flagged in place.
  overdueOccurrenceIds?: Set<number>;
}>();

const emit = defineEmits<{
  create: [payload: { start: Date; end: Date }];
  move: [payload: { block: CalendarBlock; start: Date; end: Date }];
  resize: [payload: { block: CalendarBlock; start: Date; end: Date }];
  copy: [payload: { block: CalendarBlock; start: Date; end: Date }];
  menu: [payload: { block: CalendarBlock; x: number; y: number }];
  toggle: [payload: { block: CalendarBlock }];
  edit: [payload: { block: CalendarBlock }];
  timer: [payload: { block: CalendarBlock }];
  reminder: [payload: { reminder: ReminderDto }];
  reschedule: [payload: { reminder: ReminderDto; start: Date; end: Date }];
  reminderDragstart: [payload: { reminder: ReminderDto; event: PointerEvent }];
}>();

const hours = Array.from({ length: 24 }, (_unused, index) => index);
const bodyHeight = 24 * HOUR_HEIGHT;
const today = startOfDay(new Date()).getTime();

interface PositionedBlock {
  box: LayoutBox;
  block: CalendarBlock;
}
interface DayColumn {
  day: Date;
  timed: PositionedBlock[];
  allDay: CalendarBlock[];
}

const dayColumns = computed<DayColumn[]>(() =>
  props.days.map((day) => {
    const entries = timedBlocksForDay(props.blocks, day);
    const boxes = layoutColumn(
      entries.map((entry) => ({
        id: entry.block.key,
        startMinutes: entry.startMinutes,
        endMinutes: entry.endMinutes,
        isBlocking: entry.block.isBlocking,
      })),
    );
    const blockByKey = new Map(entries.map((entry) => [entry.block.key, entry.block]));
    const timed = boxes.flatMap((box) => {
      const block = blockByKey.get(box.id);
      return block ? [{ box, block }] : [];
    });
    return { day, timed, allDay: allDayBlocksForDay(props.blocks, day) };
  }),
);

const hasAllDay = computed(() => dayColumns.value.some((column) => column.allDay.length > 0));

// --- Overdue band -----------------------------------------------------------
// Reminders are a "now" concept, so the band is pinned to today's column and only
// shown when today is in view. It lists the most-overdue task's title + "+N"; a click
// reveals the full list, each entry opening its task.
const reminderDeadline = (reminder: ReminderDto): number => new Date(reminder.effectiveDate).getTime();
const sortedReminders = computed(() =>
  [...(props.reminders ?? [])].sort((left, right) => reminderDeadline(left) - reminderDeadline(right)),
);
const todayColumnIndex = computed(() => props.days.findIndex((day) => day.getTime() === today));
const showOverdue = computed(() => sortedReminders.value.length > 0 && todayColumnIndex.value >= 0);
const overdueOpen = ref(false);
const formatOverdueSince = (reminder: ReminderDto): string => formatFullDay(new Date(reminderDeadline(reminder)));
const onReminderPick = (reminder: ReminderDto): void => {
  overdueOpen.value = false;
  emit('reminder', { reminder });
};

// Inline reschedule from the overdue list: pick a resumption time, then emit it. The
// default is the next full hour today.
const rescheduleKey = ref<number | null>(null);
const rescheduleStart = ref('');
const rescheduleEnd = ref('');
const openReschedule = (reminder: ReminderDto): void => {
  const start = new Date();
  start.setMinutes(0, 0, 0);
  start.setHours(start.getHours() + 1);
  rescheduleStart.value = toDateTimeInputValue(start);
  rescheduleEnd.value = toDateTimeInputValue(new Date(start.getTime() + 60 * 60_000));
  rescheduleKey.value = reminder.idItemOccurrence;
};
const confirmReschedule = (reminder: ReminderDto): void => {
  const start = fromDateTimeInputValue(rescheduleStart.value);
  const end = fromDateTimeInputValue(rescheduleEnd.value);
  if (end <= start) {
    return;
  }
  rescheduleKey.value = null;
  overdueOpen.value = false;
  emit('reschedule', { reminder, start, end });
};

// Whether a rendered block belongs to a currently-overdue occurrence.
const isOverdueBlock = (block: CalendarBlock): boolean =>
  block.occurrence.idItemOccurrence !== null && (props.overdueOccurrenceIds?.has(block.occurrence.idItemOccurrence) ?? false);

// An overdue item can be dragged straight onto the grid (no Reschedule button): a
// small pointer move promotes the press to a drag (handled by the parent); a release
// without moving is a plain click that opens the task.
let itemDrag: { reminder: ReminderDto; startX: number; startY: number } | null = null;
const clearItemDrag = (): void => {
  window.removeEventListener('pointermove', onItemPointerMove);
  window.removeEventListener('pointerup', onItemPointerUp);
  itemDrag = null;
};
const onItemPointerMove = (event: PointerEvent): void => {
  if (!itemDrag) {
    return;
  }
  if (Math.hypot(event.clientX - itemDrag.startX, event.clientY - itemDrag.startY) > 6) {
    const reminder = itemDrag.reminder;
    clearItemDrag();
    overdueOpen.value = false;
    emit('reminderDragstart', { reminder, event });
  }
};
const onItemPointerUp = (): void => {
  const drag = itemDrag;
  clearItemDrag();
  if (drag) {
    onReminderPick(drag.reminder); // released in place -> a click = open the task
  }
};
const onItemPointerDown = (reminder: ReminderDto, event: PointerEvent): void => {
  if (event.button !== 0) {
    return;
  }
  itemDrag = { reminder, startX: event.clientX, startY: event.clientY };
  window.addEventListener('pointermove', onItemPointerMove);
  window.addEventListener('pointerup', onItemPointerUp);
};

// --- Interaction wiring -----------------------------------------------------

const columnsRef = ref<HTMLElement | null>(null);
const selectedKey = ref<string | null>(null);

const slotDate = (dayIndex: number, minutes: number): Date =>
  new Date((props.days[dayIndex]?.getTime() ?? 0) + minutes * 60_000);

const { draft, startCreate, startBlock } = useCalendarDrag({
  geometry: () => ({ rect: columnsRef.value?.getBoundingClientRect() ?? null, dayCount: props.days.length }),
  slotDate,
  onCommit: (commit) => {
    if (commit.kind === 'create') {
      emit('create', { start: slotDate(commit.dayIndex, commit.startMinutes), end: slotDate(commit.dayIndex, commit.endMinutes) });
      return;
    }
    const block = commit.block;
    if (!block) {
      return;
    }
    if (commit.kind === 'resize') {
      // Resize moves only the grabbed edge (absolute, may cross days); the opposite
      // edge keeps the block's real value, so a multi-day span never collapses.
      if (commit.resizeEdge === 'start' && commit.startMs !== undefined) {
        emit('resize', { block, start: new Date(commit.startMs), end: block.end });
      } else if (commit.resizeEdge === 'end' && commit.endMs !== undefined) {
        emit('resize', { block, start: block.start, end: new Date(commit.endMs) });
      }
      return;
    }
    // Move / copy carry absolute bounds (true duration preserved, can cross midnight).
    if (commit.startMs === undefined || commit.endMs === undefined) {
      return;
    }
    emit(commit.kind === 'move' ? 'move' : 'copy', { block, start: new Date(commit.startMs), end: new Date(commit.endMs) });
  },
});

const contextFor = (positioned: PositionedBlock, dayIndex: number): BlockContext => ({
  block: positioned.block,
  dayIndex,
  startMinutes: positioned.box.topFraction * MINUTES_PER_DAY,
  endMinutes: (positioned.box.topFraction + positioned.box.heightFraction) * MINUTES_PER_DAY,
});

// Create-by-drag with the mouse; touch keeps native scrolling (create via the
// toolbar "New" button — touch create-by-drag is a later refinement).
const onGridPointerDown = (event: PointerEvent): void => {
  if (props.readonly) {
    return;
  }
  if (event.pointerType === 'mouse' && event.button === 0) {
    selectedKey.value = null;
    startCreate(event);
  }
};

const onBlockGrab = (event: PointerEvent, context: BlockContext): void => {
  selectedKey.value = context.block.key;
  if (props.readonly) {
    startLongPress(event, context.block); // still allow the touch menu; no move
    return;
  }
  startBlock(event, 'move', context);
  startLongPress(event, context.block);
};

const onBlockResize = (payload: { event: PointerEvent; edge: 'start' | 'end' }, context: BlockContext): void => {
  if (props.readonly) {
    return;
  }
  selectedKey.value = context.block.key;
  startBlock(payload.event, payload.edge === 'start' ? 'resizeStart' : 'resizeEnd', context);
};

// Touch long-press opens the context menu (desktop uses right-click).
let longPressTimer: number | undefined;
const startLongPress = (event: PointerEvent, block: CalendarBlock): void => {
  if (event.pointerType !== 'touch') {
    return;
  }
  const { clientX, clientY } = event;
  longPressTimer = window.setTimeout(() => emit('menu', { block, x: clientX, y: clientY }), 500);
  const clear = (): void => {
    window.clearTimeout(longPressTimer);
    window.removeEventListener('pointerup', clear);
    window.removeEventListener('pointermove', onMove);
  };
  const onMove = (moveEvent: PointerEvent): void => {
    if (Math.hypot(moveEvent.clientX - clientX, moveEvent.clientY - clientY) > 8) {
      clear();
    }
  };
  window.addEventListener('pointerup', clear);
  window.addEventListener('pointermove', onMove);
};

const ghostStyle = computed(() => {
  if (!draft.value) {
    return null;
  }
  return {
    top: `${minutesToY(draft.value.startMinutes)}px`,
    height: `${minutesToY(draft.value.endMinutes - draft.value.startMinutes)}px`,
  };
});

// Hover preview: the dashed box a plain click would create, following the mouse
// over empty grid. Suppressed while dragging or over a block.
const hoverPoint = ref<{ dayIndex: number; startMinutes: number } | null>(null);

const onHoverMove = (event: PointerEvent): void => {
  if (props.readonly || event.pointerType !== 'mouse' || draft.value || (event.target as HTMLElement).closest('.calendar-block')) {
    hoverPoint.value = null;
    return;
  }
  const rect = columnsRef.value?.getBoundingClientRect();
  if (!rect) {
    hoverPoint.value = null;
    return;
  }
  const dayIndex = Math.min(Math.max(Math.floor((event.clientX - rect.left) / (rect.width / props.days.length)), 0), props.days.length - 1);
  const startMinutes = Math.min(snapMinutes(yToMinutes(event.clientY - rect.top)), MINUTES_PER_DAY - DEFAULT_CREATE_MINUTES);
  hoverPoint.value = { dayIndex, startMinutes };
};

const hoverGhostStyle = computed(() =>
  hoverPoint.value
    ? { top: `${minutesToY(hoverPoint.value.startMinutes)}px`, height: `${minutesToY(DEFAULT_CREATE_MINUTES)}px` }
    : null,
);

// Dashed preview of where a dragged backlog task would land (snapped), mirroring
// the move/create ghost. null when the pointer is outside the day columns.
const dropGhost = computed(() => {
  const point = props.dropPoint;
  const rect = columnsRef.value?.getBoundingClientRect();
  if (!point || !rect || point.x < rect.left || point.x > rect.right || point.y < rect.top || point.y > rect.bottom) {
    return null;
  }
  const dayIndex = Math.min(Math.max(Math.floor((point.x - rect.left) / (rect.width / props.days.length)), 0), props.days.length - 1);
  const startMinutes = snapMinutes(yToMinutes(point.y - rect.top));
  return {
    dayIndex,
    top: `${minutesToY(startMinutes)}px`,
    height: `${minutesToY(point.durationMinutes)}px`,
  };
});

const bodyRef = ref<HTMLElement | null>(null);
onMounted(() => {
  if (bodyRef.value) {
    bodyRef.value.scrollTop = 7 * HOUR_HEIGHT; // open on a useful range, not midnight
  }
});

// Convert a screen point to a schedule slot (for the backlog drop). null if the
// point is outside the day columns.
const dropAt = (clientX: number, clientY: number, durationMinutes: number): { start: Date; end: Date } | null => {
  const rect = columnsRef.value?.getBoundingClientRect();
  if (!rect || clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
    return null;
  }
  const dayIndex = Math.min(Math.max(Math.floor((clientX - rect.left) / (rect.width / props.days.length)), 0), props.days.length - 1);
  const day = props.days[dayIndex];
  if (!day) {
    return null;
  }
  const start = new Date(day.getTime() + snapMinutes(yToMinutes(clientY - rect.top)) * 60_000);
  return { start, end: new Date(start.getTime() + durationMinutes * 60_000) };
};
defineExpose({ dropAt });
</script>

<template>
  <div class="time-grid">
    <div class="grid-header">
      <div class="gutter-spacer" />
      <div
        v-for="column in dayColumns"
        :key="column.day.toISOString()"
        class="day-header"
        :class="{ 'is-today': column.day.getTime() === today }"
      >
        {{ formatDayHeader(column.day) }}
      </div>
    </div>

    <div v-if="showOverdue" class="overdue-row">
      <div class="gutter-spacer overdue-label">{{ t('calendarGrid.overdue') }}</div>
      <div v-for="(column, index) in dayColumns" :key="column.day.toISOString()" class="overdue-cell">
        <div v-if="index === todayColumnIndex" class="overdue-anchor">
          <button type="button" class="overdue-chip" @click="overdueOpen = !overdueOpen">
            <span class="warn-dot">⚠</span>
            <span class="oc-title">{{ sortedReminders[0].title }}</span>
            <span v-if="sortedReminders.length > 1" class="more">+{{ sortedReminders.length - 1 }}</span>
          </button>
          <div v-if="overdueOpen" class="overdue-list">
            <div v-for="reminder in sortedReminders" :key="reminder.idItemOccurrence" class="overdue-item">
              <div class="oi-main">
                <button
                  type="button"
                  class="oi-open"
                  :title="t('calendarGrid.reminderDragHint')"
                  @pointerdown="onItemPointerDown(reminder, $event)"
                >
                  <span class="oi-title">{{ reminder.title }}</span>
                  <span class="oi-when">{{ t('calendarGrid.overdueSince', { since: formatOverdueSince(reminder) }) }}</span>
                </button>
                <button type="button" class="oi-resched" @click="openReschedule(reminder)">{{ t('calendarGrid.reschedule') }}</button>
              </div>
              <div v-if="rescheduleKey === reminder.idItemOccurrence" class="oi-editor">
                <input v-model="rescheduleStart" type="datetime-local" />
                <span class="arrow">→</span>
                <input v-model="rescheduleEnd" type="datetime-local" />
                <button type="button" class="btn-mini primary" @click="confirmReschedule(reminder)">OK</button>
                <button type="button" class="btn-mini" @click="rescheduleKey = null">{{ t('common.cancel') }}</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-if="hasAllDay" class="all-day-row">
      <div class="gutter-spacer all-day-label">{{ t('calendarGrid.allDay') }}</div>
      <div v-for="column in dayColumns" :key="column.day.toISOString()" class="all-day-cell">
        <div
          v-for="block in column.allDay"
          :key="block.key"
          class="all-day-chip"
          :class="{ 'is-done': block.occurrence.status === 'done' }"
          :style="{ backgroundColor: block.occurrence.resolvedColor }"
          @contextmenu.prevent.stop="emit('menu', { block, x: $event.clientX, y: $event.clientY })"
        >
          {{ block.occurrence.title }}
        </div>
      </div>
    </div>

    <div ref="bodyRef" class="grid-body">
      <div class="hours-gutter" :style="{ height: `${bodyHeight}px` }">
        <div v-for="hour in hours" :key="hour" class="hour-label" :style="{ height: `${HOUR_HEIGHT}px` }">
          {{ formatHourLabel(hour) }}
        </div>
      </div>

      <div
        ref="columnsRef"
        class="day-columns"
        :style="{ height: `${bodyHeight}px` }"
        @pointerdown="onGridPointerDown"
        @pointermove="onHoverMove"
        @pointerleave="hoverPoint = null"
      >
        <div
          v-for="(column, columnIndex) in dayColumns"
          :key="column.day.toISOString()"
          class="day-column"
          :style="{ height: `${bodyHeight}px` }"
        >
          <div v-for="hour in hours" :key="hour" class="hour-line" :style="{ top: `${hour * HOUR_HEIGHT}px` }" />

          <CalendarBlockView
            v-for="positioned in column.timed"
            :key="positioned.box.id"
            :block="positioned.block"
            :box="positioned.box"
            :body-height="bodyHeight"
            :selected="selectedKey === positioned.block.key"
            :can-time="!readonly"
            :overdue="isOverdueBlock(positioned.block)"
            @grab="onBlockGrab($event, contextFor(positioned, columnIndex))"
            @resize="onBlockResize($event, contextFor(positioned, columnIndex))"
            @menu="emit('menu', { block: positioned.block, x: $event.clientX, y: $event.clientY })"
            @toggle="emit('toggle', { block: positioned.block })"
            @edit="emit('edit', { block: positioned.block })"
            @timer="emit('timer', { block: positioned.block })"
          />

          <div
            v-if="draft && draft.dayIndex === columnIndex && ghostStyle"
            class="ghost"
            :class="{ 'is-copy': draft.isCopy }"
            :style="ghostStyle"
          >
            <span v-if="draft.isCopy" class="ghost-badge">＋ copy</span>
          </div>

          <div v-if="dropGhost && dropGhost.dayIndex === columnIndex" class="ghost" :style="{ top: dropGhost.top, height: dropGhost.height }" />

          <div
            v-if="hoverPoint && hoverPoint.dayIndex === columnIndex && hoverGhostStyle"
            class="ghost is-hover"
            :style="hoverGhostStyle"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.time-grid {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  background: var(--surface);
}

.gutter-spacer {
  width: 56px;
  flex: 0 0 56px;
}

.grid-header,
.all-day-row,
.overdue-row {
  display: flex;
  border-bottom: 1px solid var(--border);
}

.overdue-label {
  font-size: 11px;
  color: #b45309;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding-right: 6px;
}

.overdue-cell {
  flex: 1;
  border-left: 1px solid var(--border);
  padding: 3px 4px;
  min-width: 0;
}

/* Anchor for the absolutely-positioned dropdown; the chip is a single row. */
.overdue-anchor {
  position: relative;
}

.overdue-chip {
  display: flex;
  align-items: center;
  gap: 5px;
  width: 100%;
  font: inherit;
  font-size: 11px;
  text-align: left;
  padding: 2px 6px;
  border: 1px solid rgba(180, 83, 9, 0.5);
  border-radius: 4px;
  background: rgba(180, 83, 9, 0.12);
  color: var(--text);
  cursor: pointer;
}

.overdue-chip .oc-title {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.overdue-chip .more {
  flex: 0 0 auto;
  font-weight: 600;
  color: #b45309;
}

.overdue-list {
  position: absolute;
  top: calc(100% + 3px);
  left: 0;
  z-index: 6;
  min-width: 220px;
  max-width: 320px;
  max-height: 260px;
  overflow-y: auto;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
  padding: 4px;
}

.overdue-item {
  border-radius: 6px;
}

.oi-main {
  display: flex;
  align-items: center;
  gap: 6px;
}

.oi-open {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  flex: 1;
  min-width: 0;
  font: inherit;
  text-align: left;
  padding: 6px 8px;
  border: none;
  border-radius: 6px;
  background: none;
  color: var(--text);
  cursor: pointer;
}

.oi-open:hover {
  background: var(--border-subtle, rgba(127, 127, 127, 0.15));
}

.oi-open {
  cursor: grab;
  touch-action: none;
}

.oi-open .oi-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.oi-open .oi-when {
  flex: 0 0 auto;
  font-size: 11px;
  color: var(--text-muted);
}

.oi-resched {
  flex: 0 0 auto;
  font: inherit;
  font-size: 11px;
  padding: 3px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  color: var(--text);
  cursor: pointer;
}

.oi-editor {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
  padding: 4px 8px 8px;
}

.oi-editor input[type='datetime-local'] {
  font: inherit;
  font-size: 12px;
  color: var(--text);
  padding: 3px 5px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
}

.oi-editor .arrow {
  color: var(--text-muted);
}

.btn-mini {
  font: inherit;
  font-size: 12px;
  padding: 3px 9px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  color: var(--text);
  cursor: pointer;
}

.btn-mini.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

.day-header {
  flex: 1;
  padding: 8px 6px;
  text-align: center;
  font-size: 12px;
  font-weight: 600;
  border-left: 1px solid var(--border);
  color: var(--text-muted);
}

.day-header.is-today {
  color: var(--accent);
}

.all-day-label {
  font-size: 11px;
  color: var(--text-muted);
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding-right: 6px;
}

.all-day-cell {
  flex: 1;
  border-left: 1px solid var(--border);
  padding: 3px 4px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.all-day-chip {
  font-size: 11px;
  color: #fff;
  border-radius: 4px;
  padding: 1px 6px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.all-day-chip.is-done {
  opacity: 0.55;
}

.grid-body {
  display: flex;
  overflow-y: auto;
  min-height: 0;
}

.hours-gutter {
  width: 56px;
  flex: 0 0 56px;
  position: relative;
}

.hour-label {
  font-size: 10px;
  color: var(--text-muted);
  text-align: right;
  padding-right: 6px;
  box-sizing: border-box;
  transform: translateY(-6px);
}

.day-columns {
  display: flex;
  flex: 1;
}

.day-column {
  flex: 1;
  position: relative;
  border-left: 1px solid var(--border);
  cursor: pointer; /* empty grid: click to create (blocks override with grab) */
}

.hour-line {
  position: absolute;
  left: 0;
  right: 0;
  border-top: 1px solid var(--border-subtle);
  pointer-events: none; /* clicks reach the column to start create-by-drag */
}

.ghost {
  position: absolute;
  left: 0;
  right: 2px;
  border-radius: 4px;
  background: var(--accent-soft);
  border: 1.5px dashed var(--accent);
  pointer-events: none;
  display: flex;
  align-items: flex-start;
  justify-content: flex-end;
}

/* The hover preview is lighter than an active drag ghost. */
.ghost.is-hover {
  opacity: 0.55;
}

.ghost-badge {
  font-size: 10px;
  color: var(--accent);
  padding: 1px 4px;
  font-weight: 600;
}
</style>
