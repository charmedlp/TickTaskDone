import { describe, expect, it } from 'vitest';
import { NON_BLOCKING_BAND, layoutColumn, type LayoutInput } from './layout';

const at = (id: string, startMinutes: number, endMinutes: number, isBlocking = false): LayoutInput => ({
  id,
  startMinutes,
  endMinutes,
  isBlocking,
});

const byId = (boxes: ReturnType<typeof layoutColumn>): Map<string, (typeof boxes)[number]> =>
  new Map(boxes.map((box) => [box.id, box]));

describe('layoutColumn', () => {
  it('gives a lone non-blocking item the full band, leaving the gutter free', () => {
    const [box] = layoutColumn([at('a', 540, 600)]);
    expect(box?.leftFraction).toBe(0);
    expect(box?.widthFraction).toBeCloseTo(NON_BLOCKING_BAND);
    expect(box?.topFraction).toBeCloseTo(540 / 1440);
    expect(box?.heightFraction).toBeCloseTo(60 / 1440);
  });

  it('splits two overlapping non-blocking items evenly, side by side', () => {
    const boxes = byId(layoutColumn([at('a', 540, 600), at('b', 570, 630)]));
    expect(boxes.get('a')?.widthFraction).toBeCloseTo(NON_BLOCKING_BAND / 2);
    expect(boxes.get('b')?.widthFraction).toBeCloseTo(NON_BLOCKING_BAND / 2);
    expect(boxes.get('a')?.leftFraction).toBe(0);
    expect(boxes.get('b')?.leftFraction).toBeCloseTo(NON_BLOCKING_BAND / 2);
  });

  it('reuses a column once an earlier item has ended (no false overlap)', () => {
    // a: 9-10, b: 10-11 do not overlap -> one column, full band each.
    const boxes = byId(layoutColumn([at('a', 540, 600), at('b', 600, 660)]));
    expect(boxes.get('a')?.widthFraction).toBeCloseTo(NON_BLOCKING_BAND);
    expect(boxes.get('b')?.widthFraction).toBeCloseTo(NON_BLOCKING_BAND);
    expect(boxes.get('b')?.leftFraction).toBe(0);
  });

  it('gives a blocking item the full column, gutter included', () => {
    const [box] = layoutColumn([at('x', 540, 600, true)]);
    expect(box?.leftFraction).toBe(0);
    expect(box?.widthFraction).toBe(1);
  });

  it('keeps blocking and non-blocking independent (blocking spans full width)', () => {
    const boxes = byId(layoutColumn([at('block', 540, 600, true), at('free', 540, 600)]));
    expect(boxes.get('block')?.widthFraction).toBe(1);
    // The non-blocking item still lays out within its band.
    expect(boxes.get('free')?.widthFraction).toBeCloseTo(NON_BLOCKING_BAND);
  });

  it('handles three overlapping items as thirds of the band', () => {
    const boxes = layoutColumn([at('a', 540, 600), at('b', 550, 610), at('c', 560, 620)]);
    expect(boxes).toHaveLength(3);
    for (const box of boxes) {
      expect(box.widthFraction).toBeCloseTo(NON_BLOCKING_BAND / 3);
    }
  });
});
