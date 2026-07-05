<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { layoutColumn, type LayoutBox } from '@/lib/layout';
import { allDayBlocksForDay, timedBlocksForDay, type CalendarBlock } from '@/lib/renderables';
import { formatDayHeader, formatHourLabel } from '@/lib/format';
import { MINUTES_PER_DAY, startOfDay } from '@/lib/datetime';
import { HOUR_HEIGHT, minutesToY } from '@/lib/grid';
import { useCalendarDrag, type BlockContext } from '@/composables/useCalendarDrag';
import CalendarBlockView from './CalendarBlockView.vue';

const props = defineProps<{ days: Date[]; blocks: CalendarBlock[] }>();

const emit = defineEmits<{
  create: [payload: { start: Date; end: Date }];
  move: [payload: { block: CalendarBlock; start: Date; end: Date }];
  resize: [payload: { block: CalendarBlock; start: Date; end: Date }];
  copy: [payload: { block: CalendarBlock; start: Date; end: Date }];
  menu: [payload: { block: CalendarBlock; x: number; y: number }];
  toggle: [payload: { block: CalendarBlock }];
  edit: [payload: { block: CalendarBlock }];
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

// --- Interaction wiring -----------------------------------------------------

const columnsRef = ref<HTMLElement | null>(null);
const selectedKey = ref<string | null>(null);

const { draft, startCreate, startBlock } = useCalendarDrag({
  geometry: () => ({ rect: columnsRef.value?.getBoundingClientRect() ?? null, dayCount: props.days.length }),
  onCommit: (commit) => {
    const day = props.days[commit.dayIndex];
    if (!day) {
      return;
    }
    const start = new Date(day.getTime() + commit.startMinutes * 60_000);
    const end = new Date(day.getTime() + commit.endMinutes * 60_000);
    if (commit.kind === 'create') {
      emit('create', { start, end });
      return;
    }
    const block = commit.block;
    if (!block) {
      return;
    }
    if (commit.kind === 'move') {
      emit('move', { block, start, end });
    } else if (commit.kind === 'resize') {
      emit('resize', { block, start, end });
    } else {
      emit('copy', { block, start, end });
    }
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
  if (event.pointerType === 'mouse' && event.button === 0) {
    selectedKey.value = null;
    startCreate(event);
  }
};

const onBlockGrab = (event: PointerEvent, context: BlockContext): void => {
  selectedKey.value = context.block.key;
  startBlock(event, 'move', context);
  startLongPress(event, context.block);
};

const onBlockResize = (payload: { event: PointerEvent; edge: 'start' | 'end' }, context: BlockContext): void => {
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

const bodyRef = ref<HTMLElement | null>(null);
onMounted(() => {
  if (bodyRef.value) {
    bodyRef.value.scrollTop = 7 * HOUR_HEIGHT; // open on a useful range, not midnight
  }
});
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

    <div v-if="hasAllDay" class="all-day-row">
      <div class="gutter-spacer all-day-label">All day</div>
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
            @grab="onBlockGrab($event, contextFor(positioned, columnIndex))"
            @resize="onBlockResize($event, contextFor(positioned, columnIndex))"
            @menu="emit('menu', { block: positioned.block, x: $event.clientX, y: $event.clientY })"
            @toggle="emit('toggle', { block: positioned.block })"
            @edit="emit('edit', { block: positioned.block })"
          />

          <div
            v-if="draft && draft.dayIndex === columnIndex && ghostStyle"
            class="ghost"
            :class="{ 'is-copy': draft.isCopy }"
            :style="ghostStyle"
          >
            <span v-if="draft.isCopy" class="ghost-badge">＋ copy</span>
          </div>
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
.all-day-row {
  display: flex;
  border-bottom: 1px solid var(--border);
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

.ghost-badge {
  font-size: 10px;
  color: var(--accent);
  padding: 1px 4px;
  font-weight: 600;
}
</style>
