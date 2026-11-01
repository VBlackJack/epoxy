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

/** Entity kind of a pushable block. */
const BLOCK_KIND = 'block';

/** Separator between cell keys in a cache key. */
const CELL_KEY_SEPARATOR = ',';

/**
 * Collects the cells covered by pushable blocks into `out` (cleared first) and returns it.
 * A cell is keyed as `y * mapWidth + x`. The caller passes one set it reuses every frame.
 */
export function collectBlockCells(
  entities: readonly { kind: string; x: number; y: number }[],
  mapWidth: number,
  out: Set<number>
): Set<number> {
  out.clear();
  for (const ent of entities) {
    if (ent.kind === BLOCK_KIND) out.add(ent.y * mapWidth + ent.x);
  }
  return out;
}

/** Stable string for a set of covered cells, independent of insertion order. */
export function blockCellsKey(cells: ReadonlySet<number>): string {
  return Array.from(cells)
    .sort((a, b) => a - b)
    .join(CELL_KEY_SEPARATOR);
}
