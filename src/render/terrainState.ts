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

import { GridPoint, TileDefinition } from '../core/types';

export interface AnimatedCell {
  x: number;
  y: number;
  tileId: string;
}

/** Terrain-derived lists the renderer needs every frame, rebuilt only when the terrain changes. */
export interface TerrainFeatures {
  /** Buttons whose action toggles the toggle walls. */
  toggleButtons: GridPoint[];
  toggleWalls: GridPoint[];
  /** Buttons whose action toggles the flame jets. */
  flameButtons: GridPoint[];
  /** Cells that swap terrain when a flame button is pressed. */
  flameTargets: GridPoint[];
  /** Teleporters by network: ungrouped ones share TELEPORT_UNGROUPED_KEY, the others their teleportGroup. */
  teleporterGroups: Map<string, GridPoint[]>;
  traps: GridPoint[];
  animatedCells: AnimatedCell[];
  /** Cells whose tile gives off light. */
  litCells: AnimatedCell[];
}

const EMPTY_ID_SET: ReadonlySet<string> = new Set();
const EMPTY_TILE_DEFINITIONS: TileDefinitions = {};

/** Group key of teleporters that declare no teleportGroup (they form one network). */
export const TELEPORT_UNGROUPED_KEY = '';

/** Tile definitions by id, as far as the terrain scan needs them. */
export type TileDefinitions = Readonly<Record<string, Readonly<TileDefinition>>>;

/** Network key of a teleporter tile definition. */
export function teleportGroupKey(def: Readonly<TileDefinition> | undefined): string {
  return def?.teleportGroup ?? TELEPORT_UNGROUPED_KEY;
}

export const EMPTY_TERRAIN_FEATURES: Readonly<TerrainFeatures> = {
  toggleButtons: [],
  toggleWalls: [],
  flameButtons: [],
  flameTargets: [],
  teleporterGroups: new Map(),
  traps: [],
  animatedCells: [],
  litCells: []
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

/** Scans the terrain once for mechanism endpoints, animated tiles and lit tiles. */
export function collectTerrainFeatures(
  terrain: readonly (readonly string[])[],
  animatedTileIds: ReadonlySet<string>,
  litTileIds: ReadonlySet<string> = EMPTY_ID_SET,
  tiles: TileDefinitions = EMPTY_TILE_DEFINITIONS
): TerrainFeatures {
  const features: TerrainFeatures = {
    toggleButtons: [],
    toggleWalls: [],
    flameButtons: [],
    flameTargets: [],
    teleporterGroups: new Map(),
    traps: [],
    animatedCells: [],
    litCells: []
  };
  for (let y = 0; y < terrain.length; y++) {
    const row = terrain[y];
    for (let x = 0; x < row.length; x++) {
      const tileId = row[x];
      const def = tiles[tileId];
      if (def) {
        if (def.buttonAction === 'toggle_walls') features.toggleButtons.push({ x, y });
        else if (def.buttonAction === 'toggle_flames') features.flameButtons.push({ x, y });
        if (def.togglesTo) features.toggleWalls.push({ x, y });
        if (def.flameTogglesTo) features.flameTargets.push({ x, y });
        if (def.isTeleporter) {
          const key = teleportGroupKey(def);
          const group = features.teleporterGroups.get(key);
          if (group) group.push({ x, y });
          else features.teleporterGroups.set(key, [{ x, y }]);
        }
      }
      if (tileId === 'trap') features.traps.push({ x, y });
      if (animatedTileIds.has(tileId)) features.animatedCells.push({ x, y, tileId });
      if (litTileIds.has(tileId)) features.litCells.push({ x, y, tileId });
    }
  }
  return features;
}
