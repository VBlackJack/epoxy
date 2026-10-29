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
import { collectTerrainFeatures, TerrainSnapshot } from './terrainState';

function grid(): string[][] {
  return [
    ['floor', 'button_green', 'teleport'],
    ['toggle_wall_closed', 'water', 'trap'],
    ['teleport', 'toggle_wall_open', 'floor']
  ];
}

describe('TerrainSnapshot', () => {
  it('reports a change on first sight, then only when a cell differs', () => {
    const snapshot = new TerrainSnapshot();
    const terrain = grid();
    expect(snapshot.update(terrain)).toBe(true);
    expect(snapshot.update(terrain)).toBe(false);
    expect(snapshot.update(grid())).toBe(false);
  });

  it('detects in-place mutation of the same grid', () => {
    const snapshot = new TerrainSnapshot();
    const terrain = grid();
    snapshot.update(terrain);
    terrain[1][1] = 'dirt';
    expect(snapshot.update(terrain)).toBe(true);
    expect(snapshot.update(terrain)).toBe(false);
  });

  it('detects dimension changes', () => {
    const snapshot = new TerrainSnapshot();
    snapshot.update(grid());
    expect(snapshot.update(grid().slice(0, 2))).toBe(true);
    expect(snapshot.update(grid().map((row) => row.slice(0, 2)))).toBe(true);
  });
});

describe('collectTerrainFeatures', () => {
  it('lists mechanism endpoints and animated cells', () => {
    const features = collectTerrainFeatures(grid(), new Set(['water', 'teleport']));
    expect(features.greenButtons).toEqual([{ x: 1, y: 0 }]);
    expect(features.toggleWalls).toEqual([
      { x: 0, y: 1 },
      { x: 1, y: 2 }
    ]);
    expect(features.teleporters).toEqual([
      { x: 2, y: 0 },
      { x: 0, y: 2 }
    ]);
    expect(features.traps).toEqual([{ x: 2, y: 1 }]);
    expect(features.animatedCells).toEqual([
      { x: 2, y: 0, tileId: 'teleport' },
      { x: 1, y: 1, tileId: 'water' },
      { x: 0, y: 2, tileId: 'teleport' }
    ]);
    expect(features.litCells).toEqual([]);
  });

  it('lists lit cells only for the lit tile ids given', () => {
    const features = collectTerrainFeatures(grid(), new Set(), new Set(['teleport']));
    expect(features.litCells).toEqual([
      { x: 2, y: 0, tileId: 'teleport' },
      { x: 0, y: 2, tileId: 'teleport' }
    ]);
    expect(features.animatedCells).toEqual([]);
  });
});
