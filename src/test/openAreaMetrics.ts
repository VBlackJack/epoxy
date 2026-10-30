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
import { ORDERED_DIRECTIONS } from '../config/constants';
import { GeneratedLevel } from '../core/ProceduralGenerator';
import { isPlayerWalkable } from '../core/Walkability';

/** How far, in steps over walkable ground, a floor cell may be from content and still count as served. */
export const CONTENT_REACH_STEPS = 4;

export interface OpenAreaMetrics {
  /** Walkable cells outside every piece box. */
  outsideFloor: number;
  /** Outside floor cells within CONTENT_REACH_STEPS of a chip, a monster lane cell or a hazard cell; 1 when there is no outside floor. */
  contentShare: number;
}

/**
 * Measures how much of the open floor of a level carries content. Content is
 * a chip anywhere in the level, a cell of a hub monster lane, or a hazard
 * cell of the hub region. Distances follow walkable ground, as the player does.
 */
export function measureOpenArea(generated: GeneratedLevel): OpenAreaMetrics {
  const { level, pieceBoxes, open } = generated;
  const height = level.terrain.length;
  const width = height > 0 ? level.terrain[0].length : 0;
  const walkable = level.terrain.map((row) => row.map((id) => isPlayerWalkable(ConfigRegistry.getTile(id))));
  const inBox = (x: number, y: number): boolean =>
    pieceBoxes.some((b) => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1);

  const distance = new Array<number>(width * height).fill(-1);
  const queue: number[] = [];
  const seed = (x: number, y: number): void => {
    if (x < 0 || y < 0 || x >= width || y >= height || distance[y * width + x] === 0) return;
    distance[y * width + x] = 0;
    queue.push(y * width + x);
  };
  level.items.forEach((row, y) =>
    row.forEach((id, x) => {
      if (id && ConfigRegistry.getTile(id).collectible === 'chip') seed(x, y);
    })
  );
  for (const c of open?.lanes ?? []) seed(c.x, c.y);
  for (const c of open?.hazards ?? []) seed(c.x, c.y);

  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i];
    if (distance[cur] >= CONTENT_REACH_STEPS) continue;
    const x = cur % width;
    const y = Math.floor(cur / width);
    for (const d of ORDERED_DIRECTIONS) {
      const nx = x + (d === 'E' ? 1 : d === 'W' ? -1 : 0);
      const ny = y + (d === 'S' ? 1 : d === 'N' ? -1 : 0);
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const next = ny * width + nx;
      if (distance[next] !== -1 || !walkable[ny][nx]) continue;
      distance[next] = distance[cur] + 1;
      queue.push(next);
    }
  }

  let outsideFloor = 0;
  let served = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!walkable[y][x] || inBox(x, y)) continue;
      outsideFloor++;
      if (distance[y * width + x] !== -1) served++;
    }
  }
  return { outsideFloor, contentShare: outsideFloor > 0 ? served / outsideFloor : 1 };
}
