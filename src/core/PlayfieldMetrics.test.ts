/*
 * Copyright 2026 Julien Bombled
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { describe, expect, it } from 'vitest';
import { measurePlayfield, reachableCells } from './PlayfieldMetrics';

/** Builds a walkability grid from rows where '.' is walkable. */
function grid(rows: string[]): boolean[][] {
  return rows.map((row) => [...row].map((c) => c === '.'));
}

describe('measurePlayfield', () => {
  it('measures a straight corridor', () => {
    const m = measurePlayfield(grid(['.....']), { x: 0, y: 0 });
    expect(m.cells).toBe(5);
    expect(m.boundsWidth).toBe(5);
    expect(m.boundsHeight).toBe(1);
    expect(m.fill).toBe(1);
    expect(m.openShare).toBe(0);
    expect(m.deadShare).toBeCloseTo(2 / 5);
    expect(m.junctionShare).toBe(0);
    expect(m.symmetry).toBe(1);
  });

  it('measures a 3x3 room', () => {
    const m = measurePlayfield(grid(['...', '...', '...']), { x: 1, y: 1 });
    expect(m.fill).toBe(1);
    expect(m.openShare).toBe(1);
    expect(m.deadShare).toBe(0);
    // The four edge middles and the centre have three or more neighbours.
    expect(m.junctionShare).toBeCloseTo(5 / 9);
    expect(m.symmetry).toBe(1);
  });

  it('measures an L shape: low fill, two dead ends, partial symmetry', () => {
    const m = measurePlayfield(grid(['...', '.##', '.##']), { x: 0, y: 0 });
    expect(m.cells).toBe(5);
    expect(m.fill).toBeCloseTo(5 / 9);
    expect(m.deadShare).toBeCloseTo(2 / 5);
    expect(m.openShare).toBe(0);
    expect(m.symmetry).toBeCloseTo(5 / 9);
  });

  it('counts a cell once when it sits in several open squares', () => {
    const m = measurePlayfield(grid(['....', '....']), { x: 0, y: 0 });
    expect(m.openShare).toBe(1);
  });

  it('sees a mirror symmetric playfield as symmetric', () => {
    const m = measurePlayfield(grid(['.#.', '...', '.#.']), { x: 0, y: 0 });
    expect(m.symmetry).toBe(1);
  });

  it('ignores walkable cells the start cannot reach', () => {
    const rows = ['..#..', '..#..'];
    const m = measurePlayfield(grid(rows), { x: 0, y: 0 });
    expect(m.cells).toBe(4);
    expect(m.boundsWidth).toBe(2);
    expect(reachableCells(grid(rows), { x: 0, y: 0 })[0][3]).toBe(false);
  });

  it('is empty when the start is not walkable', () => {
    const m = measurePlayfield(grid(['#..']), { x: 0, y: 0 });
    expect(m.cells).toBe(0);
    expect(m.fill).toBe(0);
  });
});
