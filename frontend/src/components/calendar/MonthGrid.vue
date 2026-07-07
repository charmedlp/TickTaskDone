<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { startOfDay } from '@/lib/datetime';
import { DEFAULT_CREATE_MINUTES } from '@/lib/grid';
import { blocksForDay, type CalendarBlock } from '@/lib/renderables';
import { startMinutesForInsert } from '@/lib/monthDrop';
import { formatTime } from '@/lib/format';

const props = defineProps<{
  days: Date[];
  blocks: CalendarBlock[];
  // Live pointer of an in-progress backlog drag, for the drop placeholder.
  dropPoint?: { x: number; y: number; durationMinutes: number } | null;
}>();

const emit = defineEmits<{
  create: [payload: { start: Date; end: Date }];
  move: [payload: { block: CalendarBlock; start: Date; end: Date }];
  menu: [payload: { block: CalendarBlock; x: number; y: number }];
  toggle: [payload: { block: CalendarBlock }];
  edit: [payload: { block: CalendarBlock }];
}>();

const weeks = computed(() => {
  const rows: Date[][] = [];
  for (let index = 0; index < props.days.length; index += 7) {
    rows.push(props.days.slice(index, index + 7));
  }
  return rows;
});

// The focused month owns the middle of the full-weeks grid; other days are dimmed.
const focusMonth = computed(() => props.days[Math.floor(props.days.length / 2)]?.getUTCMonth() ?? 0);
const today = startOfDay(new Date()).getTime();

const weekdayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const chipsFor = (day: Date): CalendarBlock[] => blocksForDay(props.blocks, day);
const isDimmed = (day: Date): boolean => day.getUTCMonth() !== focusMonth.value;

// --- Drag / drop: reorder within a day; the position sets the start time --------

const gridRef = ref<HTMLElement | null>(null);
const draftDayIndex = ref<number | null>(null);
const dragMoved = ref(false);
const draggingKey = ref<string | null>(null); // the chip being moved (excluded from index math)
const previewInsertIndex = ref(0); // position of the dashed placeholder within the target cell

interface Session {
  block: CalendarBlock;
  originDayIndex: number;
  originX: number;
  originY: number;
  pointerId: number;
  moved: boolean;
}
let session: Session | null = null;

const MOVE_THRESHOLD_PX = 4;

// The cell under a screen point, or null if outside the grid.
const cellIndexAt = (clientX: number, clientY: number): number | null => {
  const rect = gridRef.value?.getBoundingClientRect();
  if (!rect || weeks.value.length === 0) {
    return null;
  }
  if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
    return null;
  }
  const column = Math.min(Math.max(Math.floor((clientX - rect.left) / (rect.width / 7)), 0), 6);
  const row = Math.min(Math.max(Math.floor((clientY - rect.top) / (rect.height / weeks.value.length)), 0), weeks.value.length - 1);
  return row * 7 + column;
};

// Insertion index within a cell's chip list from the pointer Y (excludes the chip
// being dragged). Reads the DOM chip positions.
const insertIndexAt = (cellIndex: number, pointerY: number): number => {
  const cell = gridRef.value?.querySelectorAll('.day-cell').item(cellIndex);
  if (!(cell instanceof HTMLElement)) {
    return 0;
  }
  let index = 0;
  for (const chip of cell.querySelectorAll('.chip')) {
    if (chip instanceof HTMLElement && chip.dataset.key === draggingKey.value) {
      continue;
    }
    const box = chip.getBoundingClientRect();
    if (pointerY > box.top + box.height / 2) {
      index += 1;
    }
  }
  return index;
};

// The start minutes implied by dropping at `insertIndex` on `day` (see lib/monthDrop).
const slotStart = (day: Date, insertIndex: number): number => startMinutesForInsert(chipsFor(day), day, insertIndex);

// Backlog drop target cell (for the placeholder), from the live drag pointer.
const backlogDropIndex = computed(() => (props.dropPoint ? cellIndexAt(props.dropPoint.x, props.dropPoint.y) : null));

// Mouse hover over an empty cell area, to preview where a click would create.
const hoverCellIndex = ref<number | null>(null);

const onCellHover = (event: PointerEvent, cellIndex: number): void => {
  if (event.pointerType !== 'mouse' || draggingKey.value !== null || props.dropPoint) {
    return; // a drag is in progress
  }
  if ((event.target as HTMLElement).closest('.chip')) {
    hoverCellIndex.value = null; // over a chip, not empty space
    return;
  }
  hoverCellIndex.value = cellIndex;
  previewInsertIndex.value = insertIndexAt(cellIndex, event.clientY);
};
const clearHover = (): void => {
  hoverCellIndex.value = null;
};

// The cell showing the dashed placeholder: backlog drop, a chip move past origin,
// or a plain hover (to preview a click-to-create).
const previewCellIndex = computed(() => {
  if (backlogDropIndex.value !== null) {
    return backlogDropIndex.value;
  }
  if (dragMoved.value) {
    return draftDayIndex.value;
  }
  return hoverCellIndex.value;
});

// Keep the placeholder position synced to the backlog drag pointer.
watch(
  () => props.dropPoint,
  (point) => {
    if (point) {
      const cell = cellIndexAt(point.x, point.y);
      if (cell !== null) {
        previewInsertIndex.value = insertIndexAt(cell, point.y);
      }
    }
  },
);

const onPointerMove = (event: PointerEvent): void => {
  if (!session || event.pointerId !== session.pointerId) {
    return;
  }
  const index = cellIndexAt(event.clientX, event.clientY);
  if (index === null) {
    return;
  }
  draftDayIndex.value = index;
  previewInsertIndex.value = insertIndexAt(index, event.clientY);
  if (Math.hypot(event.clientX - session.originX, event.clientY - session.originY) > MOVE_THRESHOLD_PX) {
    session.moved = true;
    dragMoved.value = true;
  }
};

const finish = (commit: boolean): void => {
  const current = session;
  const target = draftDayIndex.value;
  const insertIndex = previewInsertIndex.value;
  detach();
  session = null;
  draftDayIndex.value = null;
  dragMoved.value = false;
  draggingKey.value = null;
  if (!current) {
    return;
  }
  if (!commit || !current.moved || target === null) {
    // A click that never moved edits the item.
    if (commit && !current.moved) {
      emit('edit', { block: current.block });
    }
    return;
  }
  const targetDay = props.days[target];
  if (!targetDay) {
    return;
  }
  const duration = current.block.end.getTime() - current.block.start.getTime();
  const start = new Date(startOfDay(targetDay).getTime() + slotStart(targetDay, insertIndex) * 60_000);
  emit('move', { block: current.block, start, end: new Date(start.getTime() + duration) });
};

const onPointerUp = (event: PointerEvent): void => {
  if (session && event.pointerId === session.pointerId) {
    finish(true);
  }
};
const onCancel = (): void => finish(false);

const attach = (): void => {
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onCancel);
  window.addEventListener('blur', onCancel);
};
function detach(): void {
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerup', onPointerUp);
  window.removeEventListener('pointercancel', onCancel);
  window.removeEventListener('blur', onCancel);
}
onBeforeUnmount(detach);

// Touch long-press opens the context menu.
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
  };
  window.addEventListener('pointerup', clear);
};

const onChipPointerDown = (event: PointerEvent, block: CalendarBlock, dayIndex: number): void => {
  if (event.button !== 0) {
    return; // let the right button reach @contextmenu
  }
  if (session) {
    finish(false);
  }
  session = {
    block,
    originDayIndex: dayIndex,
    originX: event.clientX,
    originY: event.clientY,
    pointerId: event.pointerId,
    moved: false,
  };
  draftDayIndex.value = dayIndex;
  draggingKey.value = block.key;
  previewInsertIndex.value = insertIndexAt(dayIndex, event.clientY);
  attach();
  startLongPress(event, block);
};

// Click an empty cell to create — at the time implied by the click position among
// the day's items (same rule as the drag), like the hover preview shows.
const onCellClick = (day: Date, event: MouseEvent, cellIndex: number): void => {
  const start = new Date(startOfDay(day).getTime() + slotStart(day, insertIndexAt(cellIndex, event.clientY)) * 60_000);
  emit('create', { start, end: new Date(start.getTime() + DEFAULT_CREATE_MINUTES * 60_000) });
};

// Convert a screen point to a schedule slot (for the backlog drop): the target day,
// with the start time implied by the drop position among that day's items.
const dropAt = (clientX: number, clientY: number, durationMinutes: number): { start: Date; end: Date } | null => {
  const cellIndex = cellIndexAt(clientX, clientY);
  if (cellIndex === null) {
    return null;
  }
  const day = props.days[cellIndex];
  if (!day) {
    return null;
  }
  const startMinutes = slotStart(day, insertIndexAt(cellIndex, clientY));
  const start = new Date(startOfDay(day).getTime() + startMinutes * 60_000);
  return { start, end: new Date(start.getTime() + durationMinutes * 60_000) };
};
defineExpose({ dropAt });
</script>

<template>
  <div class="month">
    <div class="weekday-row">
      <div v-for="label in weekdayLabels" :key="label" class="weekday">{{ label }}</div>
    </div>

    <div ref="gridRef" class="weeks" @pointerleave="clearHover">
      <div v-for="(week, weekIndex) in weeks" :key="weekIndex" class="week">
        <div
          v-for="(day, columnIndex) in week"
          :key="day.toISOString()"
          class="day-cell"
          :class="{ dimmed: isDimmed(day), today: day.getTime() === today }"
          @click="onCellClick(day, $event, weekIndex * 7 + columnIndex)"
          @pointermove="onCellHover($event, weekIndex * 7 + columnIndex)"
        >
          <div class="day-number">{{ day.getUTCDate() }}</div>
          <div class="chips">
            <template v-for="(block, chipIndex) in chipsFor(day)" :key="block.key">
              <div
                v-if="previewCellIndex === weekIndex * 7 + columnIndex && previewInsertIndex === chipIndex"
                class="chip-placeholder"
              />
              <div
                class="chip"
                :data-key="block.key"
                :class="{ 'is-done': block.occurrence.status === 'done', 'is-dragging': draggingKey === block.key }"
                :style="{ backgroundColor: block.occurrence.resolvedColor }"
                @pointerdown.stop="onChipPointerDown($event, block, weekIndex * 7 + columnIndex)"
                @click.stop
                @contextmenu.prevent.stop="emit('menu', { block, x: $event.clientX, y: $event.clientY })"
              >
                <span
                  v-if="block.occurrence.type === 'task'"
                  class="chip-check"
                  :class="{ checked: block.occurrence.status === 'done' }"
                  @pointerdown.stop
                  @click.stop="emit('toggle', { block })"
                >
                  <svg v-if="block.occurrence.status === 'done'" viewBox="0 0 16 16" class="tick">
                    <path d="M3 8l3.5 3.5L13 5" />
                  </svg>
                </span>
                <span v-if="!block.allDay" class="chip-time">{{ formatTime(block.start) }}</span>
                <span class="chip-title">{{ block.occurrence.title }}</span>
              </div>
            </template>
            <div
              v-if="previewCellIndex === weekIndex * 7 + columnIndex && previewInsertIndex >= chipsFor(day).length"
              class="chip-placeholder"
            />
          </div>
          <!-- Always-clickable trailing space, so a busy day can still take a new item. -->
          <div class="add-space" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.month {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  background: var(--surface);
}

.weekday-row {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  border-bottom: 1px solid var(--border);
}

.weekday {
  padding: 6px;
  text-align: center;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
}

.weeks {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-auto-rows: 1fr;
  overflow-y: auto;
}

.week {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
}

.day-cell {
  display: flex;
  flex-direction: column;
  border-left: 1px solid var(--border-subtle);
  border-top: 1px solid var(--border-subtle);
  min-height: 84px;
  padding: 2px 3px;
  overflow: hidden;
  cursor: pointer;
}

.day-cell:first-child {
  border-left: none;
}

.day-cell.dimmed {
  background: #fafbfc;
  color: var(--text-muted);
}

/* Dashed placeholder chip at the exact spot the dragged item would land — the
   month equivalent of the day/week drop ghost (not a whole-cell frame). */
.chip-placeholder {
  height: 16px;
  border: 1.5px dashed var(--accent);
  border-radius: 4px;
  background: var(--accent-soft);
}

.day-number {
  font-size: 12px;
  font-weight: 600;
  text-align: right;
  padding: 0 2px;
}

.day-cell.today .day-number {
  color: #fff;
  background: var(--accent);
  border-radius: 50%;
  width: 20px;
  height: 20px;
  line-height: 20px;
  margin-left: auto;
  text-align: center;
}

.chips {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 2px;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-width: thin;
}

/* Reserved trailing strip: always empty and clickable to create, even on a busy day. */
.add-space {
  flex: 0 0 16px;
}

.chip {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  padding: 1px 4px;
  border-radius: 4px;
  white-space: nowrap;
  overflow: hidden;
  cursor: grab;
  touch-action: none;
  user-select: none;
  color: #fff;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.12);
}

.chip:hover {
  filter: brightness(0.95);
}

.chip.is-done {
  opacity: 0.55;
}

.chip.is-dragging {
  opacity: 0.4;
}

.chip-check {
  width: 12px;
  height: 12px;
  flex: 0 0 auto;
  border: 1.5px solid rgba(255, 255, 255, 0.85);
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.15);
  cursor: pointer;
}

.chip-check.checked {
  background: rgba(255, 255, 255, 0.85);
}

.tick {
  width: 100%;
  height: 100%;
  fill: none;
  stroke: #222;
  stroke-width: 2.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.chip-time {
  font-variant-numeric: tabular-nums;
  opacity: 0.85;
}

.chip-title {
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 500;
}
</style>
