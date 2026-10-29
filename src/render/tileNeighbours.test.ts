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
import { cellHash, hasAll, NEIGHBOUR, neighbourMask, tileNeighbours } from './tileNeighbours';

const WALLS: ReadonlySet<string> = new Set(['wall']);
const CASTERS: ReadonlySet<string> = new Set(['wall', 'door_red']);

/** Builds a grid from rows of characters: '#' wall, 'd' red door, anything else floor. */
function grid(...rows: string[]): string[][] {
  return rows.map((row) =>
    [...row].map((c) => (c === '#' ? 'wall' : c === 'd' ? 'door_red' : 'floor'))
  );
}

describe('neighbourMask', () => {
  it('sets one bit per matching neighbour, clockwise from north', () => {
    const terrain = grid('#..', '.x#', '..#');
    const mask = neighbourMask(terrain, 1, 1, WALLS, false);
    expect(mask).toBe(NEIGHBOUR.NW | NEIGHBOUR.E | NEIGHBOUR.SE);
  });

  it('counts cells outside the grid only when asked', () => {
    const terrain = grid('.');
    expect(neighbourMask(terrain, 0, 0, WALLS, false)).toBe(0);
    expect(neighbourMask(terrain, 0, 0, WALLS, true)).toBe(0xff);
  });

  it('ignores the cell itself', () => {
    const terrain = grid('...', '.#.', '...');
    expect(neighbourMask(terrain, 1, 1, WALLS, false)).toBe(0);
  });
});

describe('tileNeighbours', () => {
  it('joins walls with walls only, but takes shadows from every caster', () => {
    const terrain = grid('d#', '..');
    const below = tileNeighbours(terrain, 0, 1, WALLS, CASTERS);
    expect(below.wallMask & NEIGHBOUR.N).toBe(0);
    expect(hasAll(below.shadowMask, NEIGHBOUR.N | NEIGHBOUR.NE)).toBe(true);
  });

  it('treats the map border as wall for joining but not as a shadow caster', () => {
    const terrain = grid('.');
    const cell = tileNeighbours(terrain, 0, 0, WALLS, CASTERS);
    expect(cell.wallMask).toBe(0xff);
    expect(cell.shadowMask).toBe(0);
  });
});

describe('cellHash', () => {
  it('is stable and differs between nearby cells', () => {
    expect(cellHash(3, 7)).toBe(cellHash(3, 7));
    const seen = new Set<number>();
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) seen.add(cellHash(x, y));
    }
    expect(seen.size).toBe(32 * 32);
  });

  it('spreads low bits evenly enough to pick floor variants', () => {
    const buckets = new Array<number>(4).fill(0);
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) buckets[cellHash(x, y) % 4]++;
    }
    for (const count of buckets) {
      expect(count).toBeGreaterThan(200);
      expect(count).toBeLessThan(312);
    }
  });
});
