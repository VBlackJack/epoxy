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

import { GridPoint } from '../core/types';

export interface AnimatedCell {
  x: number;
  y: number;
  tileId: string;
}

/** Terrain-derived lists the renderer needs every frame, rebuilt only when the terrain changes. */
export interface TerrainFeatures {
  greenButtons: GridPoint[];
  toggleWalls: GridPoint[];
  teleporters: GridPoint[];
  traps: GridPoint[];
  animatedCells: AnimatedCell[];
}

export const EMPTY_TERRAIN_FEATURES: Readonly<TerrainFeatures> = {
  greenButtons: [],
  toggleWalls: [],
  teleporters: [],
  traps: [],
  animatedCells: []
};

/**
 * Keeps a private copy of the last terrain grid seen, so terrain edits are detected
 * even when the engine mutates its grid in place.
 */
export class TerrainSnapshot {
  private cells: string[] = [];
  private rowLengths: number[] = [];

  /** Copies `terrain` and returns true when it differs from the previous snapshot. */
  public update(terrain: readonly (readonly string[])[]): boolean {
    let changed = terrain.length !== this.rowLengths.length;
    this.rowLengths.length = terrain.length;
    let index = 0;
    for (let y = 0; y < terrain.length; y++) {
      const row = terrain[y];
      if (this.rowLengths[y] !== row.length) {
        this.rowLengths[y] = row.length;
        changed = true;
      }
      for (let x = 0; x < row.length; x++, index++) {
        if (this.cells[index] !== row[x]) {
          this.cells[index] = row[x];
          changed = true;
        }
      }
    }
    if (this.cells.length !== index) {
      this.cells.length = index;
      changed = true;
    }
    return changed;
  }
}

/** Scans the terrain once for mechanism endpoints and animated tiles. */
export function collectTerrainFeatures(
  terrain: readonly (readonly string[])[],
  animatedTileIds: ReadonlySet<string>
): TerrainFeatures {
  const features: TerrainFeatures = {
    greenButtons: [],
    toggleWalls: [],
    teleporters: [],
    traps: [],
    animatedCells: []
  };
  for (let y = 0; y < terrain.length; y++) {
    const row = terrain[y];
    for (let x = 0; x < row.length; x++) {
      const tileId = row[x];
      if (tileId === 'button_green') features.greenButtons.push({ x, y });
      else if (tileId === 'toggle_wall_closed' || tileId === 'toggle_wall_open') features.toggleWalls.push({ x, y });
      else if (tileId === 'teleport') features.teleporters.push({ x, y });
      else if (tileId === 'trap') features.traps.push({ x, y });
      if (animatedTileIds.has(tileId)) features.animatedCells.push({ x, y, tileId });
    }
  }
  return features;
}
