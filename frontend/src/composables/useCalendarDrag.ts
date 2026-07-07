import { onBeforeUnmount, ref } from 'vue';
import { MINUTES_PER_DAY } from '@/lib/datetime';
import { DEFAULT_CREATE_MINUTES, MIN_DURATION_MINUTES, snapMinutes, yToMinutes } from '@/lib/grid';
import type { CalendarBlock } from '@/lib/renderables';

// Home-made pointer-event interaction layer for the time grid (guide §10: the most
// uncertain piece, so no library). Handles create-by-drag, move, resize and
// ALT-copy uniformly for mouse and touch. Snapping is applied live. While a drag
// is active, move/up are tracked on `window` so a re-render of the dragged block
// never drops the gesture.

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
}

interface Session {
  mode: DragMode;
  block: CalendarBlock | null;
  pointerId: number;
  grabOffsetMinutes: number; // move: pointer offset within the block
  durationMinutes: number;
  originDayIndex: number;
  originMinutes: number; // create: the anchor edge
  moved: boolean;
}

const MOVE_THRESHOLD_MINUTES = 3;

export const useCalendarDrag = (options: {
  geometry: () => { rect: DOMRect | null; dayCount: number };
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
      const start = Math.min(session.originMinutes, current);
      const end = Math.max(session.originMinutes, current);
      draft.value = {
        dayIndex: session.originDayIndex,
        startMinutes: start,
        endMinutes: end <= start ? start + MIN_DURATION_MINUTES : end,
        isCopy: false,
        block: null,
      };
      if (Math.abs(current - session.originMinutes) >= MOVE_THRESHOLD_MINUTES) {
        session.moved = true;
      }
      return;
    }

    if (session.mode === 'move') {
      const start = snapMinutes(
        Math.min(position.minutes - session.grabOffsetMinutes, MINUTES_PER_DAY - session.durationMinutes),
      );
      draft.value = {
        dayIndex: position.dayIndex,
        startMinutes: start,
        endMinutes: start + session.durationMinutes,
        isCopy: event.altKey,
        block: session.block,
      };
    } else if (session.mode === 'resizeStart') {
      draft.value = {
        ...draft.value,
        startMinutes: Math.min(snapMinutes(position.minutes), draft.value.endMinutes - MIN_DURATION_MINUTES),
      };
    } else {
      draft.value = {
        ...draft.value,
        endMinutes: Math.max(snapMinutes(position.minutes), draft.value.startMinutes + MIN_DURATION_MINUTES),
      };
    }

    if (
      position.dayIndex !== session.originDayIndex ||
      Math.abs(position.minutes - session.originMinutes) >= MOVE_THRESHOLD_MINUTES
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
    options.onCommit({
      kind,
      block: current.block,
      dayIndex: pending.dayIndex,
      startMinutes: pending.startMinutes,
      endMinutes: pending.endMinutes,
    });
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
      grabOffsetMinutes: 0,
      durationMinutes: MIN_DURATION_MINUTES,
      originDayIndex: position.dayIndex,
      originMinutes: anchor,
      moved: false,
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
    session = {
      mode,
      block: context.block,
      pointerId: event.pointerId,
      grabOffsetMinutes: position ? position.minutes - context.startMinutes : 0,
      durationMinutes: context.endMinutes - context.startMinutes,
      originDayIndex: context.dayIndex,
      originMinutes: context.startMinutes,
      moved: false,
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
