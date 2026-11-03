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

import { CC3D_CLASS_BLOCKER, type Cc3dCell, type Cc3dLevel, type Cc3dMob, terrainClass } from '../core/cc3d/model';

/**
 * Which cells of a CC3D map must be drawn again after an edit. Cells and mobs are immutable and an edit
 * shares every one it did not touch, so a reference comparison finds the changed ones without reading them.
 */

/**
 * Whether a cell really hides something under what is drawn: more than one layer that is not plain floor
 * (the base counts when it is water, ice...), or a blocker on top of an item or a thin wall. A plain floor
 * under a single layer hides nothing.
 */
export function hasHiddenLayers(cell: Cc3dCell): boolean {
  const solid = cell.terrain.filter((layer) => layer.kind !== 'floor');
  if (solid.length > 1) return true;
  const top = cell.terrain[cell.terrain.length - 1];
  return terrainClass(top.kind) === CC3D_CLASS_BLOCKER && (cell.item !== null || cell.panels.length > 0);
}

function mobsByCell(level: Pick<Cc3dLevel, 'width' | 'mobs'>): Map<number, Cc3dMob> {
  const found = new Map<number, Cc3dMob>();
  for (const mob of level.mobs) found.set(mob.y * level.width + mob.x, mob);
  return found;
}

/**
 * Row-major indices of the cells whose picture may differ between two versions of a level: a cell, its
 * creature or the player start changed. Null when the grid changed size, so nothing can be reused.
 */
export function dirtyCc3dCells(before: Cc3dLevel, after: Cc3dLevel): number[] | null {
  if (before.width !== after.width || before.height !== after.height || before.cells.length !== after.cells.length) return null;
  const dirty = new Set<number>();
  after.cells.forEach((cell, index) => {
    if (cell !== before.cells[index]) dirty.add(index);
  });
  const mobsBefore = mobsByCell(before);
  const mobsAfter = mobsByCell(after);
  for (const index of new Set([...mobsBefore.keys(), ...mobsAfter.keys()])) {
    if (mobsBefore.get(index) !== mobsAfter.get(index)) dirty.add(index);
  }
  if (before.player.x !== after.player.x || before.player.y !== after.player.y || before.player.dir !== after.player.dir) {
    dirty.add(before.player.y * before.width + before.player.x);
    dirty.add(after.player.y * after.width + after.player.x);
  }
  return [...dirty].filter((index) => index >= 0 && index < after.cells.length);
}
