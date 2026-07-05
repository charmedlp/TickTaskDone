import { MINUTES_PER_DAY } from './datetime';

// Grid geometry and snapping. One shared source for the pixel<->minute mapping so
// the grid rendering and the pointer interactions stay in sync.
export const HOUR_HEIGHT = 48; // pixels per hour
export const SNAP_MINUTES = 15; // default drag snap (brief §1, configurable later)
export const MIN_DURATION_MINUTES = SNAP_MINUTES; // a block can never be shorter than one snap step

export const clampMinutes = (minutes: number): number => Math.min(Math.max(minutes, 0), MINUTES_PER_DAY);

export const snapMinutes = (minutes: number, step: number = SNAP_MINUTES): number =>
  clampMinutes(Math.round(minutes / step) * step);

export const yToMinutes = (offsetY: number, hourHeight: number = HOUR_HEIGHT): number => (offsetY / hourHeight) * 60;

export const minutesToY = (minutes: number, hourHeight: number = HOUR_HEIGHT): number => (minutes / 60) * hourHeight;
