import { MINUTES_PER_DAY } from './datetime';

// Horizontal layout of a day column (brief §5).
//
// Column model on a 200px reference:
//  - Non-blocking items share a 170px band (85%); the right 30px (15%) is a
//    gutter kept free (always clickable to create). Overlapping non-blocking
//    items split the band evenly, side by side (classic calendar packing),
//    capped at the band — never the full column.
//  - A blocking item takes the full 200px (gutter included) and forbids overlap.
//
// Pure and deterministic — the subtle part, so it is unit-tested.

export const NON_BLOCKING_BAND = 0.85;

export interface LayoutInput {
  id: string;
  startMinutes: number; // minutes from the top of the column [0, 1440]
  endMinutes: number; // exclusive; clamped by the caller to the day
  isBlocking: boolean;
}

export interface LayoutBox {
  id: string;
  topFraction: number; // vertical position as a fraction of the column height
  heightFraction: number;
  leftFraction: number; // horizontal position/size as a fraction of the column width
  widthFraction: number;
}

const verticalBox = (input: LayoutInput): Pick<LayoutBox, 'topFraction' | 'heightFraction'> => ({
  topFraction: input.startMinutes / MINUTES_PER_DAY,
  heightFraction: Math.max(input.endMinutes - input.startMinutes, 0) / MINUTES_PER_DAY,
});

// Greedy interval packing within one overlap cluster: each item takes the first
// column whose last item has ended; the cluster's column count sets every item's
// width, so nothing overlaps horizontally.
const packCluster = (cluster: LayoutInput[]): LayoutBox[] => {
  const columnEnds: number[] = [];
  const columnOf = new Map<string, number>();

  for (const input of cluster) {
    let column = columnEnds.findIndex((end) => end <= input.startMinutes);
    if (column === -1) {
      column = columnEnds.length;
    }
    columnEnds[column] = input.endMinutes;
    columnOf.set(input.id, column);
  }

  const columnCount = columnEnds.length;
  const width = NON_BLOCKING_BAND / columnCount;
  return cluster.map((input) => ({
    id: input.id,
    ...verticalBox(input),
    leftFraction: (columnOf.get(input.id) ?? 0) * width,
    widthFraction: width,
  }));
};

export const layoutColumn = (inputs: LayoutInput[]): LayoutBox[] => {
  const blocking = inputs.filter((input) => input.isBlocking);
  const nonBlocking = inputs
    .filter((input) => !input.isBlocking)
    .sort((left, right) => left.startMinutes - right.startMinutes || left.endMinutes - right.endMinutes);

  const boxes: LayoutBox[] = blocking.map((input) => ({
    id: input.id,
    ...verticalBox(input),
    leftFraction: 0,
    widthFraction: 1, // full column, gutter included
  }));

  // Break the non-blocking items into maximal overlap clusters, then pack each.
  let cluster: LayoutInput[] = [];
  let clusterEnd = -Infinity;
  const flush = (): void => {
    if (cluster.length > 0) {
      boxes.push(...packCluster(cluster));
    }
    cluster = [];
    clusterEnd = -Infinity;
  };

  for (const input of nonBlocking) {
    if (input.startMinutes >= clusterEnd) {
      flush();
    }
    cluster.push(input);
    clusterEnd = Math.max(clusterEnd, input.endMinutes);
  }
  flush();

  return boxes;
};
