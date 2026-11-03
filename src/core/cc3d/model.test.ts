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
  Cc3dTerrain,
  baseConflict,
  cellAt,
  cellIndex,
  normalizeCell,
  placeTerrain,
  terrainClass,
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

describe('terrainClass', () => {
  it('classifies every kind and rejects unknown ones', () => {
    expect(terrainClass('water')).toBe(1);
    expect(terrainClass('bomb')).toBe(2);
    expect(terrainClass('wall')).toBe(3);
    expect(terrainClass('nonsense')).toBeUndefined();
  });
});

describe('normalizeCell', () => {
  it('falls back to plain floor when no layer is floor-like', () => {
    expect(normalizeCell([{ kind: 'wall' }])).toEqual([{ kind: 'floor' }, { kind: 'wall' }]);
    expect(normalizeCell([])).toEqual([{ kind: 'floor' }]);
  });

  it('takes the floor-like layer that is not plain floor as base, wherever it sits', () => {
    expect(normalizeCell([{ kind: 'wall' }, { kind: 'floor' }, { kind: 'water' }])).toEqual([{ kind: 'water' }, { kind: 'wall' }]);
  });

  it('orders devices before blockers and keeps input order inside a class', () => {
    const stack = normalizeCell([
      { kind: 'door', color: 'red' },
      { kind: 'trap' },
      { kind: 'wall' },
      { kind: 'bomb' },
      { kind: 'ice' }
    ]);
    expect(stack.map((l) => l.kind)).toEqual(['ice', 'trap', 'bomb', 'door', 'wall']);
  });

  it('keeps duplicates of a kind (the importer does)', () => {
    expect(normalizeCell([{ kind: 'trap' }, { kind: 'trap' }]).map((l) => l.kind)).toEqual(['floor', 'trap', 'trap']);
  });

  it('lets the last real base win and reports the conflict', () => {
    const layers: Cc3dTerrain[] = [{ kind: 'floor' }, { kind: 'water' }, { kind: 'fire' }];
    expect(baseConflict(layers)).toEqual([1, 2]);
    expect(normalizeCell(layers)[0].kind).toBe('fire');
    expect(baseConflict([{ kind: 'floor' }, { kind: 'water' }, { kind: 'wall' }])).toBeNull();
  });

  it('throws on an unknown kind', () => {
    expect(() => normalizeCell([{ kind: 'nonsense' } as unknown as Cc3dTerrain])).toThrow();
  });
});

describe('placeTerrain', () => {
  it('replaces the base with a floor-like layer and keeps what is above', () => {
    expect(placeTerrain([{ kind: 'floor' }, { kind: 'trap' }], { kind: 'ice' })).toEqual([{ kind: 'ice' }, { kind: 'trap' }]);
  });

  it('replaces a layer of the same kind in place', () => {
    const stack = placeTerrain([{ kind: 'floor' }, { kind: 'door', color: 'red' }, { kind: 'wall' }], { kind: 'door', color: 'blue' });
    expect(stack).toEqual([{ kind: 'floor' }, { kind: 'door', color: 'blue' }, { kind: 'wall' }]);
  });

  it('inserts a device below the blockers and a blocker above the devices', () => {
    expect(placeTerrain([{ kind: 'floor' }, { kind: 'wall' }], { kind: 'bomb' }).map((l) => l.kind)).toEqual(['floor', 'bomb', 'wall']);
    expect(placeTerrain([{ kind: 'floor' }, { kind: 'bomb' }], { kind: 'wall' }).map((l) => l.kind)).toEqual(['floor', 'bomb', 'wall']);
  });

  it('does not change the stack it is given', () => {
    const stack: Cc3dTerrain[] = [{ kind: 'floor' }];
    placeTerrain(stack, { kind: 'wall' });
    expect(stack).toEqual([{ kind: 'floor' }]);
  });
});
