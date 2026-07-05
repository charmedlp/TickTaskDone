<script setup lang="ts">
import { computed } from 'vue';
import type { LayoutBox } from '@/lib/layout';
import type { CalendarBlock } from '@/lib/renderables';
import { formatTimeRange } from '@/lib/format';

const props = defineProps<{ block: CalendarBlock; box: LayoutBox; bodyHeight: number; selected: boolean }>();

const emit = defineEmits<{
  grab: [event: PointerEvent];
  resize: [payload: { event: PointerEvent; edge: 'start' | 'end' }];
  menu: [event: MouseEvent];
  toggle: [];
  edit: [];
}>();

// A task carries a checkbox; an event does not (brief §4). Done -> checked + faded.
const isTask = computed(() => props.block.occurrence.type === 'task');
const isDone = computed(() => props.block.occurrence.status === 'done');

// Fill the available height with the title (wrapping across as many lines as fit,
// ellipsis on the last), reserving the bottom line for the time only when there is
// room. The title stays the priority; the time is dropped first.
const LINE_HEIGHT_PX = 14;
const VERTICAL_PADDING_PX = 4;
const fittingLines = computed(() =>
  Math.max(1, Math.floor((props.box.heightFraction * props.bodyHeight - VERTICAL_PADDING_PX) / LINE_HEIGHT_PX)),
);
const showTime = computed(() => fittingLines.value > 1);
const titleLines = computed(() => (showTime.value ? fittingLines.value - 1 : 1));

const style = computed(() => ({
  top: `${props.box.topFraction * props.bodyHeight}px`,
  height: `${props.box.heightFraction * props.bodyHeight}px`,
  left: `${props.box.leftFraction * 100}%`,
  width: `${props.box.widthFraction * 100}%`,
  backgroundColor: props.block.occurrence.resolvedColor,
}));

// Only the primary button starts a move; the right button reaches @contextmenu.
const onBodyPointerDown = (event: PointerEvent): void => {
  if (event.button === 0) {
    emit('grab', event);
  }
};
</script>

<template>
  <div
    class="calendar-block"
    :class="{ 'is-done': isDone, 'is-blocking': block.isBlocking, 'is-selected': selected, 'is-virtual': block.isVirtual }"
    :style="style"
    @pointerdown.stop="onBodyPointerDown"
    @contextmenu.prevent.stop="emit('menu', $event)"
    @dblclick.stop="emit('edit')"
  >
    <span
      class="resize-handle top"
      @pointerdown.stop="emit('resize', { event: $event, edge: 'start' })"
    />

    <span
      v-if="isTask"
      class="checkbox"
      :class="{ checked: isDone }"
      role="checkbox"
      :aria-checked="isDone"
      @pointerdown.stop
      @click.stop="emit('toggle')"
    >
      <svg v-if="isDone" viewBox="0 0 16 16" class="tick"><path d="M3 8l3.5 3.5L13 5" /></svg>
    </span>

    <span class="title" :style="{ '--title-lines': titleLines }">{{ block.occurrence.title }}</span>
    <span v-if="showTime" class="time">{{ formatTimeRange(block.start, block.end) }}</span>
    <span v-if="isTask" class="timer" aria-hidden="true" title="Timer (coming soon)">⏱</span>

    <span
      class="resize-handle bottom"
      @pointerdown.stop="emit('resize', { event: $event, edge: 'end' })"
    />
  </div>
</template>

<style scoped>
.calendar-block {
  position: absolute;
  box-sizing: border-box;
  padding: 2px 6px;
  border-radius: 4px;
  color: #fff;
  font-size: 11px;
  /* Fixed px line-height so the component's line-fitting math stays exact. */
  line-height: 14px;
  overflow: hidden;
  cursor: grab;
  touch-action: none; /* let the pointer layer own the gesture (no scroll hijack) */
  user-select: none; /* dragging must not select the block's text */
  -webkit-user-select: none;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.12);
}

.calendar-block:active {
  cursor: grabbing;
}

/* A tiny inset keeps adjacent split columns visually separate. */
.calendar-block:not(.is-blocking) {
  margin-right: 2px;
}

.is-done {
  opacity: 0.55;
}

.is-selected {
  box-shadow:
    inset 0 0 0 1px rgba(0, 0, 0, 0.12),
    0 0 0 2px var(--accent);
}

/* Title fills the height: it wraps across up to --title-lines lines (set from the
   block height) and ellipsises the last one. It never shrinks below the time —
   the time is dropped first (see script), because the grid position already hints
   at it while the title has no other cue. */
.title {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: var(--title-lines, 1);
  line-clamp: var(--title-lines, 1);
  overflow: hidden;
  overflow-wrap: break-word;
  font-weight: 600;
  padding-right: 16px;
}

.time {
  display: block;
  font-variant-numeric: tabular-nums;
  opacity: 0.9;
}

.checkbox {
  position: absolute;
  top: 3px;
  right: 4px;
  width: 13px;
  height: 13px;
  border: 1.5px solid rgba(255, 255, 255, 0.85);
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.15);
  cursor: pointer;
}

.checkbox.checked {
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

.timer {
  position: absolute;
  bottom: 2px;
  right: 4px;
  font-size: 10px;
  opacity: 0.75;
}

.resize-handle {
  position: absolute;
  left: 0;
  right: 0;
  height: 8px;
  cursor: ns-resize;
  opacity: 0;
  z-index: 2; /* above the title, which is later in the DOM, so the top handle is grabbable */
}

.resize-handle.top {
  top: 0;
}

.resize-handle.bottom {
  bottom: 0;
}

/* Reveal the resize affordance on hover (desktop) or when selected (touch). */
.calendar-block:hover .resize-handle,
.calendar-block.is-selected .resize-handle {
  opacity: 1;
  background: rgba(255, 255, 255, 0.35);
}
</style>
