<script setup lang="ts">
import { computed, ref, watch, onUnmounted } from 'vue';
import { browserTimezone } from '@/lib/datetime';
import { createTimeLog, deleteTimeLog, updateTimeLog } from '@/api/timelogs';
import { materializeOccurrence } from '@/api/occurrenceActions';
import type { TimerSession } from './timer.types';

const props = defineProps<{ session: TimerSession | null; index?: number }>();
const emit = defineEmits<{ close: [] }>();

// One captured segment = one timeLog, persisted the moment it starts (fil de l'eau),
// so a crash or a page close never loses time. We keep the log id to close it (pause/
// stop) or delete it (cancel / manual override). Timestamps are ms for easy maths.
interface Segment {
  idTimeLog: number;
  startedAt: number;
  endedAt: number | null;
}

const occurrenceId = ref<number | null>(null);
const segments = ref<Segment[]>([]);
const running = ref(false);
const phase = ref<'timing' | 'report'>('timing');
const busy = ref(false);
const error = ref<string | null>(null);
const manualOpen = ref(false);
const manualMinutes = ref<number | null>(null);
const closeConfirmOpen = ref(false);

// The widget floats over the app (no backdrop) so the calendar stays fully usable
// while timing, and the user can drag it out of the way. `pos` is null until first
// moved (default anchor = bottom-left, from CSS); then it becomes an explicit
// top-left position in px.
const cardRef = ref<HTMLElement | null>(null);
const pos = ref<{ x: number; y: number } | null>(null);
let drag: { offsetX: number; offsetY: number } | null = null;

// Until dragged, widgets cascade from the bottom-left corner (staggered by index) so
// several stay visible and distinguishable rather than stacking on the exact spot.
const cardStyle = computed(() => {
  if (pos.value) {
    return { left: `${pos.value.x}px`, top: `${pos.value.y}px`, right: 'auto', bottom: 'auto' };
  }
  const offset = 16 + (props.index ?? 0) * 26;
  return { left: `${offset}px`, bottom: `${offset}px` };
});

const onDragMove = (event: PointerEvent): void => {
  if (!drag || !cardRef.value) {
    return;
  }
  const width = cardRef.value.offsetWidth;
  const height = cardRef.value.offsetHeight;
  pos.value = {
    x: Math.min(Math.max(0, event.clientX - drag.offsetX), window.innerWidth - width),
    y: Math.min(Math.max(0, event.clientY - drag.offsetY), window.innerHeight - height),
  };
};
const endDrag = (): void => {
  drag = null;
  window.removeEventListener('pointermove', onDragMove);
  window.removeEventListener('pointerup', endDrag);
};
const startDrag = (event: PointerEvent): void => {
  if (event.button !== 0 || !cardRef.value) {
    return;
  }
  const rect = cardRef.value.getBoundingClientRect();
  drag = { offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top };
  pos.value = { x: rect.left, y: rect.top };
  window.addEventListener('pointermove', onDragMove);
  window.addEventListener('pointerup', endDrag);
};
onUnmounted(endDrag);

// A 1s tick drives the live elapsed display while a segment is running.
const now = ref(Date.now());
let ticker: number | undefined;
const startTicker = (): void => {
  stopTicker();
  ticker = window.setInterval(() => {
    now.value = Date.now();
  }, 1000);
};
const stopTicker = (): void => {
  if (ticker !== undefined) {
    window.clearInterval(ticker);
    ticker = undefined;
  }
};
onUnmounted(stopTicker);

const iso = (ms: number): string => new Date(ms).toISOString();

const segmentMs = (segment: Segment): number => (segment.endedAt ?? now.value) - segment.startedAt;
const totalMs = computed(() => segments.value.reduce((sum, segment) => sum + segmentMs(segment), 0));

const formatDuration = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
};

const formatClock = (ms: number): string =>
  new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

// Open a new segment: persist it immediately (endedAt null = running) and record it.
const beginSegment = async (): Promise<void> => {
  if (occurrenceId.value === null) {
    return;
  }
  const startedAt = Date.now();
  const created = await createTimeLog({
    itemOccurrenceId: occurrenceId.value,
    startedAt: iso(startedAt),
    endedAt: null,
    source: 'timer',
    timezone: browserTimezone(),
  });
  segments.value.push({ idTimeLog: created.idTimeLog, startedAt, endedAt: null });
  running.value = true;
};

// Close the running segment (pause / stop): stamp endedAt on the server and locally.
const closeRunning = async (): Promise<void> => {
  const current = segments.value[segments.value.length - 1];
  if (!current || current.endedAt !== null) {
    return;
  }
  const endedAt = Date.now();
  await updateTimeLog(current.idTimeLog, { endedAt: iso(endedAt) });
  current.endedAt = endedAt;
  running.value = false;
};

const guard = async (action: () => Promise<void>): Promise<void> => {
  if (busy.value) {
    return;
  }
  busy.value = true;
  error.value = null;
  try {
    await action();
  } catch {
    error.value = 'Something went wrong. Your captured segments are safe on the server.';
  } finally {
    busy.value = false;
  }
};

const pause = (): Promise<void> => guard(closeRunning);
const resume = (): Promise<void> => guard(beginSegment);
const stop = (): Promise<void> =>
  guard(async () => {
    if (running.value) {
      await closeRunning();
    }
    phase.value = 'report';
  });

// Keep the captured logs and close (they are already persisted).
const validateKeep = (): void => {
  stopTicker();
  emit('close');
};

// Manual override: DELETE the captured segments, then create ONE manual log spanning
// the entered minutes from the session's first start. Deletion happens only here, on
// validation — not when the manual field opens (brief §7).
const submitManual = (): Promise<void> =>
  guard(async () => {
    const minutes = manualMinutes.value;
    if (minutes === null || !Number.isFinite(minutes) || minutes <= 0) {
      error.value = 'Enter a positive number of minutes.';
      return;
    }
    if (occurrenceId.value === null) {
      return;
    }
    for (const segment of segments.value) {
      await deleteTimeLog(segment.idTimeLog);
    }
    const anchor = segments.value[0]?.startedAt ?? Date.now();
    await createTimeLog({
      itemOccurrenceId: occurrenceId.value,
      startedAt: iso(anchor),
      endedAt: iso(anchor + minutes * 60_000),
      source: 'manual',
      timezone: browserTimezone(),
    });
    stopTicker();
    emit('close');
  });

// The X (close overlay): stop first if still running, then confirm — Validate keeps
// the logs, Cancel deletes them (brief §7).
const requestClose = (): Promise<void> =>
  guard(async () => {
    if (running.value) {
      await closeRunning();
    }
    closeConfirmOpen.value = true;
  });

const confirmClose = (keep: boolean): Promise<void> =>
  guard(async () => {
    if (!keep) {
      for (const segment of segments.value) {
        await deleteTimeLog(segment.idTimeLog);
      }
    }
    stopTicker();
    emit('close');
  });

// (Re)initialize whenever a session opens: resolve the occurrence (materialize a
// virtual slot) then start the first segment.
watch(
  () => props.session,
  (session) => {
    if (!session) {
      stopTicker();
      return;
    }
    occurrenceId.value = null;
    segments.value = [];
    running.value = false;
    phase.value = 'timing';
    manualOpen.value = false;
    manualMinutes.value = null;
    closeConfirmOpen.value = false;
    error.value = null;
    pos.value = null; // re-anchor to the default corner for a fresh session
    startTicker();
    void guard(async () => {
      occurrenceId.value =
        session.idItemOccurrence ??
        (await materializeOccurrence(session.itemId, {
          occurrenceDate: session.occurrenceDate ? new Date(session.occurrenceDate) : null,
        })).idItemOccurrence;
      await beginSegment();
    });
  },
  { immediate: true },
);
</script>

<template>
  <div
    v-if="session"
    ref="cardRef"
    class="timer-widget"
    :style="cardStyle"
    role="dialog"
    aria-label="Task timer"
  >
    <div class="timer-card">
      <header class="timer-head" @pointerdown="startDrag">
        <div class="labels">
          <span class="eyebrow">⠿ Timing</span>
          <h3 class="task-title">{{ session.title }}</h3>
        </div>
        <button
          type="button"
          class="icon-close"
          aria-label="Close"
          :disabled="busy"
          @pointerdown.stop
          @click="requestClose"
        >
          ×
        </button>
      </header>

      <p class="elapsed" :class="{ paused: !running && phase === 'timing' }">{{ formatDuration(totalMs) }}</p>

      <!-- Timing controls -->
      <div v-if="phase === 'timing'" class="controls">
        <button v-if="running" type="button" class="btn" :disabled="busy" @click="pause">Pause</button>
        <button v-else type="button" class="btn" :disabled="busy" @click="resume">Resume</button>
        <button type="button" class="btn primary" :disabled="busy" @click="stop">Stop</button>
      </div>

      <!-- Stop report -->
      <div v-else class="report">
        <h4 class="report-title">{{ segments.length }} segment{{ segments.length > 1 ? 's' : '' }} captured</h4>
        <ul class="segments">
          <li v-for="(segment, index) in segments" :key="segment.idTimeLog">
            <span class="seg-index">#{{ index + 1 }}</span>
            <span class="seg-range">{{ formatClock(segment.startedAt) }}–{{ segment.endedAt ? formatClock(segment.endedAt) : '…' }}</span>
            <span class="seg-dur">{{ formatDuration(segmentMs(segment)) }}</span>
          </li>
        </ul>

        <div v-if="!manualOpen" class="controls">
          <button type="button" class="btn ghost" :disabled="busy" @click="manualOpen = true">Manual entry…</button>
          <button type="button" class="btn primary" :disabled="busy" @click="validateKeep">Validate</button>
        </div>

        <div v-else class="manual">
          <p class="warn">⚠ Entering a manual time will erase your timed segments.</p>
          <label class="manual-field">
            <span>Minutes</span>
            <input v-model.number="manualMinutes" type="number" min="1" step="1" inputmode="numeric" />
          </label>
          <div class="controls">
            <button type="button" class="btn ghost" :disabled="busy" @click="manualOpen = false">Back</button>
            <button type="button" class="btn primary" :disabled="busy" @click="submitManual">Save manual time</button>
          </div>
        </div>
      </div>

      <p v-if="error" class="timer-error">{{ error }}</p>

      <!-- Close confirmation -->
      <div v-if="closeConfirmOpen" class="confirm">
        <p>Keep the captured time?</p>
        <div class="controls">
          <button type="button" class="btn" :disabled="busy" @click="confirmClose(false)">Cancel (discard)</button>
          <button type="button" class="btn primary" :disabled="busy" @click="confirmClose(true)">Validate (keep)</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Floating, non-blocking widget: fixed to the viewport, default bottom-left, and
   draggable by its header. No backdrop, so the rest of the app stays interactive. */
.timer-widget {
  position: fixed;
  width: min(320px, 92vw);
  z-index: 50;
}

.timer-card {
  background: var(--surface);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 16px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.3);
}

.timer-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  cursor: move;
  touch-action: none; /* let the drag own the gesture on touch */
  user-select: none;
}

.eyebrow {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-muted);
}

.task-title {
  margin: 2px 0 0;
  font-size: 16px;
  overflow-wrap: break-word;
}

.icon-close {
  font-size: 22px;
  line-height: 1;
  border: none;
  background: none;
  color: var(--text-muted);
  cursor: pointer;
  padding: 0 4px;
}

.elapsed {
  font-size: 40px;
  font-variant-numeric: tabular-nums;
  text-align: center;
  margin: 14px 0;
  font-weight: 600;
}

.elapsed.paused {
  opacity: 0.5;
}

.controls {
  display: flex;
  gap: 8px;
  justify-content: center;
}

.btn {
  font: inherit;
  padding: 8px 16px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
  cursor: pointer;
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

.btn.ghost {
  background: none;
}

.report-title {
  margin: 4px 0 8px;
  font-size: 13px;
  color: var(--text-muted);
  text-align: center;
}

.segments {
  list-style: none;
  margin: 0 0 14px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 160px;
  overflow-y: auto;
}

.segments li {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  padding: 4px 8px;
  border: 1px solid var(--border-subtle, var(--border));
  border-radius: 6px;
}

.seg-index {
  color: var(--text-muted);
}

.seg-range {
  flex: 1;
  font-variant-numeric: tabular-nums;
}

.seg-dur {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}

.manual {
  margin-top: 6px;
}

.warn {
  font-size: 12px;
  color: #b45309;
  background: rgba(180, 83, 9, 0.1);
  padding: 6px 8px;
  border-radius: 6px;
  margin: 0 0 10px;
}

.manual-field {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 12px;
}

.manual-field input {
  font: inherit;
  width: 100px;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  color: var(--text);
}

.timer-error {
  margin: 12px 0 0;
  font-size: 12px;
  color: #dc2626;
  text-align: center;
}

.confirm {
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid var(--border);
  text-align: center;
}

.confirm p {
  margin: 0 0 10px;
  font-size: 14px;
}
</style>
