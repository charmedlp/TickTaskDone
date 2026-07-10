import { onBeforeUnmount, ref } from 'vue';
import { MINUTES_PER_DAY } from '@/lib/datetime';
import { DEFAULT_CREATE_MINUTES, MIN_DURATION_MINUTES, snapMinutes, yToMinutes } from '@/lib/grid';
import type { CalendarBlock } from '@/lib/renderables';

// Home-made pointer-event interaction layer for the time grid (guide §10: the most
// uncertain piece, so no library). Handles create-by-drag, move, resize and
// ALT-copy uniformly for mouse and touch. Snapping is applied live. While a drag
// is active, move/up are tracked on `window` so a re-render of the dragged block
// never drops the gesture.
//
// Move/copy work in ABSOLUTE time (a real delta from the grab point), not per-day
// minutes, so a block keeps its true duration and can cross midnight, be grabbed on
// any day of a multi-day span, and shift by exactly the pointer movement. Resize
// moves only the grabbed edge; the opposite edge keeps the block's real value.

export type DragMode = 'create' | 'move' | 'resizeStart' | 'resizeEnd';

export interface BlockContext {
  block: CalendarBlock;
  dayIndex: number;
  startMinutes: number;
  endMinutes: number;
}

export interface DragDraft {
  dayIndex: number;
  startMinutes: number;
  endMinutes: number;
  isCopy: boolean;
  block: CalendarBlock | null;
}

export type CommitKind = 'create' | 'move' | 'resize' | 'copy';

export interface DragCommit {
  kind: CommitKind;
  block: CalendarBlock | null;
  dayIndex: number;
  startMinutes: number;
  endMinutes: number;
  resizeEdge?: 'start' | 'end'; // resize: which edge moved (the other is preserved)
  startMs?: number; // move/copy: absolute new start
  endMs?: number; // move/copy: absolute new end
}

interface Session {
  mode: DragMode;
  block: CalendarBlock | null;
  pointerId: number;
  moved: boolean;
  grabDayIndex: number; // raw pointer at grab (moved detection + create anchor)
  grabMinutes: number;
  // move / copy:
  grabOffsetMs: number; // grab pointer minus the block's true start
  durationMinutes: number; // CLAMPED per-day duration, for the ghost preview only
  durationMs: number; // TRUE duration, for the commit
  resolvedMs: number; // the block's new absolute start, tracked live
}

const MOVE_THRESHOLD_MINUTES = 3;

export const useCalendarDrag = (options: {
  geometry: () => { rect: DOMRect | null; dayCount: number };
  slotDate: (dayIndex: number, minutes: number) => Date; // day column + minutes -> absolute Date
  onCommit: (commit: DragCommit) => void;
}) => {
  const draft = ref<DragDraft | null>(null);
  let session: Session | null = null;

  const positionOf = (event: PointerEvent): { dayIndex: number; minutes: number } | null => {
    const { rect, dayCount } = options.geometry();
    if (!rect || dayCount === 0) {
      return null;
    }
    const columnWidth = rect.width / dayCount;
    const dayIndex = Math.min(Math.max(Math.floor((event.clientX - rect.left) / columnWidth), 0), dayCount - 1);
    // Fixed pixel scale (48px/hour) relative to the container top, which moves with
    // scroll — robust regardless of the container's measured height.
    const minutes = yToMinutes(event.clientY - rect.top);
    return { dayIndex, minutes };
  };

  // Absolute ms -> the day column that contains it (index clamped to the visible
  // range; minutes may fall outside [0, 1440) so the ghost can sit off the day edges).
  const dateToSlot = (ms: number): { dayIndex: number; minutes: number } => {
    const { dayCount } = options.geometry();
    let dayIndex = 0;
    for (let index = 0; index < dayCount; index += 1) {
      if (options.slotDate(index, 0).getTime() <= ms) {
        dayIndex = index;
      }
    }
    return { dayIndex, minutes: (ms - options.slotDate(dayIndex, 0).getTime()) / 60_000 };
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (!session || event.pointerId !== session.pointerId || !draft.value) {
      return;
    }
    const position = positionOf(event);
    if (!position) {
      return;
    }

    if (session.mode === 'create') {
      const current = snapMinutes(position.minutes);
      const start = Math.min(session.grabMinutes, current);
      const end = Math.max(session.grabMinutes, current);
      draft.value = {
        dayIndex: session.grabDayIndex,
        startMinutes: start,
        endMinutes: end <= start ? start + MIN_DURATION_MINUTES : end,
        isCopy: false,
        block: null,
      };
      if (Math.abs(current - session.grabMinutes) >= MOVE_THRESHOLD_MINUTES) {
        session.moved = true;
      }
      return;
    }

    if (session.mode === 'move') {
      // Absolute new start = wherever the pointer is now, minus the grab offset. Snap
      // it to the grid within its own day; the ghost is derived from the same value.
      const raw = options.slotDate(position.dayIndex, position.minutes).getTime() - session.grabOffsetMs;
      const slot = dateToSlot(raw);
      const snapped = snapMinutes(slot.minutes);
      session.resolvedMs = options.slotDate(slot.dayIndex, snapped).getTime();
      draft.value = {
        dayIndex: slot.dayIndex,
        startMinutes: snapped,
        endMinutes: snapped + session.durationMinutes,
        isCopy: event.altKey,
        block: session.block,
      };
    } else if (session.block) {
      // Resize: the grabbed edge follows the pointer in ABSOLUTE time (so it can be
      // dragged into the next/previous day); the opposite edge keeps the block's real
      // value, so a multi-day span never collapses onto the grabbed day.
      const block = session.block;
      const pointerMs = options.slotDate(position.dayIndex, snapMinutes(position.minutes)).getTime();
      if (session.mode === 'resizeStart') {
        const startMs = Math.min(pointerMs, block.end.getTime() - MIN_DURATION_MINUTES * 60_000);
        session.resolvedMs = startMs;
        const slot = dateToSlot(startMs);
        draft.value = {
          dayIndex: slot.dayIndex,
          startMinutes: slot.minutes,
          endMinutes: (block.end.getTime() - options.slotDate(slot.dayIndex, 0).getTime()) / 60_000,
          isCopy: false,
          block,
        };
      } else {
        const endMs = Math.max(pointerMs, block.start.getTime() + MIN_DURATION_MINUTES * 60_000);
        session.resolvedMs = endMs;
        const slot = dateToSlot(endMs);
        draft.value = {
          dayIndex: slot.dayIndex,
          startMinutes: (block.start.getTime() - options.slotDate(slot.dayIndex, 0).getTime()) / 60_000,
          endMinutes: slot.minutes,
          isCopy: false,
          block,
        };
      }
    }

    if (
      position.dayIndex !== session.grabDayIndex ||
      Math.abs(position.minutes - session.grabMinutes) >= MOVE_THRESHOLD_MINUTES
    ) {
      session.moved = true;
    }
  };

  const finish = (commit: boolean): void => {
    const current = session;
    const pending = draft.value;
    detach();
    session = null;
    draft.value = null;
    if (!commit || !current || !pending) {
      return;
    }
    // A create always commits (a plain click makes a default-length block); a
    // move/resize only commits if the pointer actually moved.
    if (current.mode !== 'create' && !current.moved) {
      return;
    }
    const kind: CommitKind =
      current.mode === 'create'
        ? 'create'
        : current.mode === 'move'
          ? pending.isCopy
            ? 'copy'
            : 'move'
          : 'resize';
    const payload: DragCommit = {
      kind,
      block: current.block,
      dayIndex: pending.dayIndex,
      startMinutes: pending.startMinutes,
      endMinutes: pending.endMinutes,
    };
    if (kind === 'move' || kind === 'copy') {
      payload.startMs = current.resolvedMs;
      payload.endMs = current.resolvedMs + current.durationMs;
    } else if (kind === 'resize') {
      payload.resizeEdge = current.mode === 'resizeStart' ? 'start' : 'end';
      if (current.mode === 'resizeStart') {
        payload.startMs = current.resolvedMs;
      } else {
        payload.endMs = current.resolvedMs;
      }
    }
    options.onCommit(payload);
  };

  const onPointerUp = (event: PointerEvent): void => {
    if (session && event.pointerId === session.pointerId) {
      finish(true);
    }
  };
  const onPointerCancel = (): void => finish(false);
  // If the window loses focus mid-drag the pointerup is missed; cancel so the
  // session never gets stuck (which would block the next drag after refocusing).
  const onBlurCancel = (): void => finish(false);

  const attach = (): void => {
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    window.addEventListener('blur', onBlurCancel);
  };
  function detach(): void {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerCancel);
    window.removeEventListener('blur', onBlurCancel);
  }

  const startCreate = (event: PointerEvent): void => {
    if (session) {
      finish(false); // drop any stuck session before starting a new one
    }
    const position = positionOf(event);
    if (!position) {
      return;
    }
    const anchor = snapMinutes(position.minutes);
    session = {
      mode: 'create',
      block: null,
      pointerId: event.pointerId,
      moved: false,
      grabDayIndex: position.dayIndex,
      grabMinutes: anchor,
      grabOffsetMs: 0,
      durationMinutes: MIN_DURATION_MINUTES,
      durationMs: 0,
      resolvedMs: 0,
    };
    draft.value = {
      dayIndex: position.dayIndex,
      startMinutes: anchor,
      endMinutes: snapMinutes(anchor + DEFAULT_CREATE_MINUTES), // a plain click makes a default-length block
      isCopy: false,
      block: null,
    };
    attach();
  };

  const startBlock = (event: PointerEvent, mode: Exclude<DragMode, 'create'>, context: BlockContext): void => {
    if (session) {
      finish(false); // drop any stuck session before starting a new one
    }
    const position = positionOf(event);
    const grabDayIndex = position?.dayIndex ?? context.dayIndex;
    const grabMinutes = position?.minutes ?? context.startMinutes;
    const grabAbsoluteMs = options.slotDate(grabDayIndex, grabMinutes).getTime();
    session = {
      mode,
      block: context.block,
      pointerId: event.pointerId,
      moved: false,
      grabDayIndex,
      grabMinutes,
      grabOffsetMs: grabAbsoluteMs - context.block.start.getTime(),
      durationMinutes: context.endMinutes - context.startMinutes,
      durationMs: context.block.end.getTime() - context.block.start.getTime(),
      resolvedMs: context.block.start.getTime(),
    };
    draft.value = {
      dayIndex: context.dayIndex,
      startMinutes: context.startMinutes,
      endMinutes: context.endMinutes,
      isCopy: event.altKey,
      block: context.block,
    };
    attach();
  };

  onBeforeUnmount(detach);

  return { draft, startCreate, startBlock };
};
