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
import {
  CC3D_BLOCKER_KINDS,
  CC3D_DEVICE_KINDS,
  CC3D_FLOOR_LIKE_KINDS,
  Cc3dCell,
  Cc3dLevel,
  cellAt,
  cellIndex,
  topTerrain
} from './model';

const WIDTH = 3;
const HEIGHT = 2;

function makeLevel(): Cc3dLevel {
  const cells: Cc3dCell[] = Array.from({ length: WIDTH * HEIGHT }, () => ({
    terrain: [{ kind: 'floor' }],
    panels: [],
    item: null
  }));
  cells[cellIndex({ width: WIDTH }, 2, 1)] = {
    terrain: [{ kind: 'ice' }, { kind: 'bomb' }, { kind: 'door', color: 'red' }],
    panels: ['N'],
    item: { kind: 'key', color: 'blue' }
  };
  return { width: WIDTH, height: HEIGHT, cells, mobs: [], player: { x: 0, y: 0 } };
}

describe('cc3d model helpers', () => {
  it('indexes cells row-major', () => {
    expect(cellIndex({ width: WIDTH }, 0, 0)).toBe(0);
    expect(cellIndex({ width: WIDTH }, 2, 1)).toBe(5);
  });

  it('returns the cell at a position and undefined outside the grid', () => {
    const level = makeLevel();
    expect(cellAt(level, 2, 1)?.item?.kind).toBe('key');
    expect(cellAt(level, 3, 0)).toBeUndefined();
    expect(cellAt(level, 0, 2)).toBeUndefined();
    expect(cellAt(level, -1, 0)).toBeUndefined();
    expect(cellAt(level, 0.5, 0)).toBeUndefined();
  });

  it('reads the top of a terrain stack', () => {
    const level = makeLevel();
    expect(topTerrain(cellAt(level, 0, 0)!).kind).toBe('floor');
    expect(topTerrain(cellAt(level, 2, 1)!).kind).toBe('door');
  });

  it('keeps the three terrain classes disjoint', () => {
    const all = [...CC3D_FLOOR_LIKE_KINDS, ...CC3D_DEVICE_KINDS, ...CC3D_BLOCKER_KINDS];
    expect(new Set(all).size).toBe(all.length);
    expect(CC3D_FLOOR_LIKE_KINDS[0]).toBe('floor');
  });

  it('survives a JSON round trip', () => {
    const level = makeLevel();
    expect(JSON.parse(JSON.stringify(level))).toEqual(level);
  });
});
