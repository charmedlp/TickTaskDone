<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { startOfDay } from '@/lib/datetime';
import { displayStart, type CalendarBlock } from '@/lib/renderables';
import { formatFullDay, formatTime } from '@/lib/format';

const props = defineProps<{ days: Date[]; blocks: CalendarBlock[] }>();

const emit = defineEmits<{
  menu: [payload: { block: CalendarBlock; x: number; y: number }];
  toggle: [payload: { block: CalendarBlock }];
  edit: [payload: { block: CalendarBlock }];
}>();

const PAGE_SIZES = [20, 50, 75, 100];
const pageSize = ref(20);
const page = ref(0);

// The anchor day: everything from here forward (the store fetches a year horizon).
const fromDay = computed(() => props.days[0] ?? startOfDay(new Date()));

// All scheduled entries from the anchor day onward, chronological (all-day sorts
// first within a day since its start is 00:00). One entry per timeBlock, so a split
// task appears several times.
const allEntries = computed(() =>
  props.blocks
    .filter((block) => displayStart(block).getTime() >= fromDay.value.getTime())
    .sort((left, right) => displayStart(left).getTime() - displayStart(right).getTime()),
);

const total = computed(() => allEntries.value.length);
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)));
const rangeStart = computed(() => page.value * pageSize.value);
const pageEntries = computed(() => allEntries.value.slice(rangeStart.value, rangeStart.value + pageSize.value));

// Group the current page by day for display.
const pageGroups = computed(() => {
  const groups: { day: Date; entries: CalendarBlock[] }[] = [];
  let currentKey: number | null = null;
  for (const block of pageEntries.value) {
    const key = startOfDay(displayStart(block)).getTime();
    if (key !== currentKey) {
      groups.push({ day: startOfDay(block.start), entries: [] });
      currentKey = key;
    }
    groups[groups.length - 1]?.entries.push(block);
  }
  return groups;
});

// Reset to the first page when the anchor day or the page size changes — but NOT on
// a same-window reconcile reload (getTime() is stable across those).
watch([() => fromDay.value.getTime(), pageSize], () => {
  page.value = 0;
});

const previousPage = (): void => {
  page.value = Math.max(0, page.value - 1);
};
const nextPage = (): void => {
  page.value = Math.min(pageCount.value - 1, page.value + 1);
};

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
</script>

<template>
  <div class="list">
    <div class="controls">
      <div class="page-sizes">
        <span>Show</span>
        <button
          v-for="size in PAGE_SIZES"
          :key="size"
          type="button"
          :class="{ active: pageSize === size }"
          @click="pageSize = size"
        >
          {{ size }}
        </button>
      </div>
      <div class="pager">
        <span v-if="total > 0" class="range">
          {{ rangeStart + 1 }}–{{ Math.min(rangeStart + pageSize, total) }} of {{ total }}
        </span>
        <button type="button" :disabled="page === 0" @click="previousPage">‹</button>
        <span class="page-of">{{ page + 1 }} / {{ pageCount }}</span>
        <button type="button" :disabled="page >= pageCount - 1" @click="nextPage">›</button>
      </div>
    </div>

    <div class="entries">
      <p v-if="total === 0" class="empty">Nothing scheduled from this day onward.</p>

      <section v-for="group in pageGroups" :key="group.day.toISOString()" class="day-group">
        <h3 class="day-title">{{ formatFullDay(group.day) }}</h3>
        <ul>
          <li
            v-for="block in group.entries"
            :key="block.key"
            class="entry"
            :class="{ 'is-done': block.occurrence.status === 'done' }"
            :style="{ backgroundColor: block.occurrence.resolvedColor }"
            @click="emit('edit', { block })"
            @pointerdown="startLongPress($event, block)"
            @contextmenu.prevent="emit('menu', { block, x: $event.clientX, y: $event.clientY })"
          >
            <span class="time">{{ block.allDay ? 'All day' : formatTime(block.start) }}</span>
            <span
              v-if="block.occurrence.type === 'task'"
              class="check"
              :class="{ checked: block.occurrence.status === 'done' }"
              @pointerdown.stop
              @click.stop="emit('toggle', { block })"
            >
              <svg v-if="block.occurrence.status === 'done'" viewBox="0 0 16 16" class="tick">
                <path d="M3 8l3.5 3.5L13 5" />
              </svg>
            </span>
            <span class="title">{{ block.occurrence.title }}</span>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>

<style scoped>
.list {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
}

.controls {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  font-size: 12px;
  color: var(--text-muted);
}

.page-sizes,
.pager {
  display: flex;
  align-items: center;
  gap: 6px;
}

.controls button {
  font: inherit;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
  padding: 3px 8px;
  border-radius: 6px;
  cursor: pointer;
}

.controls button:disabled {
  opacity: 0.5;
  cursor: default;
}

.page-sizes button.active {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

.range {
  font-variant-numeric: tabular-nums;
}

.page-of {
  font-variant-numeric: tabular-nums;
  min-width: 44px;
  text-align: center;
}

.entries {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 8px 12px;
}

.empty {
  color: var(--text-muted);
  text-align: center;
  padding: 24px;
}

.day-group {
  margin-bottom: 14px;
}

.day-title {
  font-size: 13px;
  margin: 6px 0;
  color: var(--text-muted);
  border-bottom: 1px solid var(--border-subtle);
  padding-bottom: 4px;
}

ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.entry {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 8px;
  border-radius: 6px;
  cursor: pointer;
  color: #fff;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.12);
}

.entry:hover {
  filter: brightness(0.96);
}

.entry.is-done {
  opacity: 0.55;
}

.entry.is-done .title {
  text-decoration: line-through;
}

.time {
  width: 64px;
  flex: 0 0 64px;
  font-variant-numeric: tabular-nums;
  font-size: 13px;
  opacity: 0.9;
}

.check {
  width: 15px;
  height: 15px;
  flex: 0 0 auto;
  border: 1.5px solid rgba(255, 255, 255, 0.85);
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.15);
  cursor: pointer;
}

.check.checked {
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

.title {
  font-weight: 500;
}
</style>
