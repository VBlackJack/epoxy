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

import type { EntityPlacement } from '../types';
import { displayItemId, displayMobId, displayTerrainId } from './display';
import type { Cc3dLevel } from './model';

/** The usual CompiledLevel layers that show a CC3D level: what the renderer and the editor palette read. */
export interface Cc3dDisplayLayers {
  terrain: string[][];
  items: (string | null)[][];
  entities: EntityPlacement[];
}

/** Derives the terrain, item and entity layers of a CC3D level from its cells and mobs. */
export function deriveDisplayLayers(cc3d: Pick<Cc3dLevel, 'width' | 'height' | 'cells' | 'mobs'>): Cc3dDisplayLayers {
  const { width, height, cells, mobs } = cc3d;
  const terrain: string[][] = [];
  const items: (string | null)[][] = [];
  for (let y = 0; y < height; y++) {
    const row = cells.slice(y * width, (y + 1) * width);
    terrain.push(row.map(displayTerrainId));
    items.push(row.map((cell) => displayItemId(cell.item)));
  }
  const entities: EntityPlacement[] = mobs.map((mob) => ({ x: mob.x, y: mob.y, type: displayMobId(mob), dir: mob.dir }));
  return { terrain, items, entities };
}
