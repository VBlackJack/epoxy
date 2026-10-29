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

import { ConfigRegistry } from '../config/ConfigRegistry';
import { DIRECTION_VECTORS, ORDERED_DIRECTIONS } from '../config/constants';
import { CompiledLevel, GridPoint } from '../core/types';
import { Box } from './LevelAssembler';

/**
 * Whether `target` stays reachable from the start, doors, sockets and
 * hazards counted as open, once every cell of `walled` is filled in.
 */
export function cellReachableWithout(level: CompiledLevel, walled: Box, target: GridPoint): boolean {
  const height = level.terrain.length;
  const width = level.terrain[0].length;
  const open = (p: GridPoint): boolean => {
    if (p.x < 0 || p.y < 0 || p.x >= width || p.y >= height) return false;
    if (p.x >= walled.x0 && p.x <= walled.x1 && p.y >= walled.y0 && p.y <= walled.y1) return false;
    const tile = ConfigRegistry.getTile(level.terrain[p.y][p.x]);
    return Boolean(tile.passableByPlayer || tile.requiredKey || tile.requiresAllChips || tile.togglesTo);
  };
  const teleporters: GridPoint[] = [];
  level.terrain.forEach((row, y) =>
    row.forEach((id, x) => {
      if (ConfigRegistry.getTile(id).isTeleporter && open({ x, y })) teleporters.push({ x, y });
    })
  );
  const seen = new Set<number>([level.playerStart.y * width + level.playerStart.x]);
  const queue: GridPoint[] = [level.playerStart];
  for (let i = 0; i < queue.length; i++) {
    const cell = queue[i];
    if (cell.x === target.x && cell.y === target.y) return true;
    const next = ORDERED_DIRECTIONS.map((d) => ({
      x: cell.x + DIRECTION_VECTORS[d].dx,
      y: cell.y + DIRECTION_VECTORS[d].dy
    }));
    if (ConfigRegistry.getTile(level.terrain[cell.y][cell.x]).isTeleporter) next.push(...teleporters);
    for (const n of next) {
      const k = n.y * width + n.x;
      if (!seen.has(k) && open(n)) {
        seen.add(k);
        queue.push(n);
      }
    }
  }
  return false;
}
