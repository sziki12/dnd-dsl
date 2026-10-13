import { describe, expect, test } from 'vitest';
import { assignParallelSlots, labelPosition, scaledBox } from './edge-geometry';

describe('scaledBox', () => {
  const box = { x: 100, y: 50, width: 80, height: 40 };

  test('scale 1 is the same box', () => {
    expect(scaledBox(box, 1)).toEqual(box);
  });

  test('keeps the top edge and the horizontal centre, grows the rest', () => {
    const big = scaledBox(box, 2);
    expect(big).toEqual({ x: 60, y: 50, width: 160, height: 80 });
    expect(big.x + big.width / 2).toBe(box.x + box.width / 2);
    expect(big.y).toBe(box.y);
  });

  test('shrinking mirrors it', () => {
    expect(scaledBox(box, 0.5)).toEqual({ x: 120, y: 50, width: 40, height: 20 });
  });
});

describe('assignParallelSlots', () => {
  test('a lone edge is slot 0 of 1', () => {
    expect(assignParallelSlots([{ source: 'A', target: 'B' }])).toEqual([{ index: 0, count: 1, flip: false }]);
  });

  test('both directions between two nodes share a group', () => {
    const slots = assignParallelSlots([{ source: 'A', target: 'B' }, { source: 'B', target: 'A' }]);
    expect(slots).toEqual([
      { index: 0, count: 2, flip: false },
      { index: 1, count: 2, flip: true },
    ]);
  });

  test('two exits in the same direction share a group', () => {
    const slots = assignParallelSlots([{ source: 'A', target: 'B' }, { source: 'A', target: 'B' }]);
    expect(slots.map(s => [s.index, s.count])).toEqual([[0, 2], [1, 2]]);
  });

  test('different pairs are counted apart, in input order', () => {
    const slots = assignParallelSlots([
      { source: 'A', target: 'B' },
      { source: 'A', target: 'C' },
      { source: 'B', target: 'A' },
    ]);
    expect(slots.map(s => [s.index, s.count])).toEqual([[0, 2], [0, 1], [1, 2]]);
  });

  test('no edges, no slots', () => {
    expect(assignParallelSlots([])).toEqual([]);
  });
});

describe('labelPosition', () => {
  const from = { x: 0, y: 0 };
  const to = { x: 100, y: 0 };

  test('a lone edge: the middle of the line', () => {
    expect(labelPosition(from, to, { index: 0, count: 1, flip: false }, 20)).toEqual({ x: 50, y: 0 });
  });

  test('two edges are pushed to opposite sides by half the spacing each', () => {
    const a = labelPosition(from, to, { index: 0, count: 2, flip: false }, 20);
    const b = labelPosition(from, to, { index: 1, count: 2, flip: false }, 20);
    expect(a.x).toBeCloseTo(50);
    expect(b.x).toBeCloseTo(50);
    expect(Math.abs(a.y - b.y)).toBeCloseTo(20);
    expect(a.y + b.y).toBeCloseTo(0);
  });

  test('the opposite direction of a pair lands on the other side, not on top', () => {
    const forward = labelPosition(from, to, { index: 0, count: 2, flip: false }, 20);
    const back = labelPosition(to, from, { index: 1, count: 2, flip: true }, 20);
    expect(Math.abs(forward.y - back.y)).toBeCloseTo(20);
  });

  test('the same slot gives the same spot whichever way the line runs', () => {
    const one = labelPosition(from, to, { index: 0, count: 2, flip: false }, 20);
    const other = labelPosition(to, from, { index: 0, count: 2, flip: true }, 20);
    expect(other.x).toBeCloseTo(one.x);
    expect(other.y).toBeCloseTo(one.y);
  });

  test('a zero-length line does not produce NaN', () => {
    const p = labelPosition(from, from, { index: 0, count: 3, flip: false }, 20);
    expect(p).toEqual({ x: 0, y: 0 });
  });
});
