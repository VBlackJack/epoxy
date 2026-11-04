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

import { CompiledLevel, TileDefinition } from './types';

/**
 * Whether a tile is a top the player removes by walking into it: a key door, a socket, or a tile that turns
 * to something else under a step (a blue fake wall, dirt). Only these can hide an underlay. The level
 * normalisation (normalizeUnderlays) keeps an underlay only under such a top, never when the underlay is one
 * itself, and never when the underlay can turn back into the cell's top (a block sunk in water makes dirt
 * again), so for a normalised level a cell reveals its underlay at most once.
 */
export function isRemovableTop(tile: TileDefinition): boolean {
  return Boolean(tile.requiredKey || tile.requiresAllChips || tile.transformsToOnStep);
}

interface UnderlayMemo {
  width: number;
  height: number;
  map: ReadonlyMap<number, string> | null;
}

const underlayMemo = new WeakMap<object, UnderlayMemo>();

/**
 * The underlays of a level by cell index (y * width + x); null when the level has none. Never throws: an
 * entry that is not a record, lies outside the grid or names no terrain is skipped, and the first entry
 * of a cell wins. The result is memoised on the `underlays` array.
 */
export function underlayMap(level: CompiledLevel): ReadonlyMap<number, string> | null {
  const entries: unknown = level.underlays;
  if (!Array.isArray(entries) || entries.length === 0) return null;
  const height = Array.isArray(level.terrain) ? level.terrain.length : 0;
  const width = height > 0 && Array.isArray(level.terrain[0]) ? level.terrain[0].length : 0;
  const memo = underlayMemo.get(entries);
  if (memo && memo.width === width && memo.height === height) return memo.map;

  let map: Map<number, string> | null = null;
  if (width > 0 && height > 0) {
    const found = new Map<number, string>();
    for (const entry of entries as unknown[]) {
      if (typeof entry !== 'object' || entry === null) continue;
      const { x, y, terrain } = entry as { x?: unknown; y?: unknown; terrain?: unknown };
      if (typeof x !== 'number' || typeof y !== 'number' || !Number.isInteger(x) || !Number.isInteger(y)) continue;
      if (x < 0 || x >= width || y < 0 || y >= height || typeof terrain !== 'string' || terrain === '') continue;
      const index = y * width + x;
      if (!found.has(index)) found.set(index, terrain);
    }
    map = found.size > 0 ? found : null;
  }
  underlayMemo.set(entries, { width, height, map });
  return map;
}

/** The terrain id hidden under the cell, or undefined when the cell hides none. */
export function underlayAt(
  map: ReadonlyMap<number, string> | null,
  width: number,
  x: number,
  y: number
): string | undefined {
  return map === null ? undefined : map.get(y * width + x);
}

/**
 * The terrain a removable top hides at the cell in a working copy of the terrain, or undefined when the
 * cell hides none or no longer holds the top the level started with (a cell already rewritten reveals
 * nothing). The tools that walk a copy of the grid (validator, pathfinder) reveal through this.
 */
export function hiddenUnder(
  level: CompiledLevel,
  terrain: readonly (readonly string[])[],
  x: number,
  y: number
): string | undefined {
  const map = underlayMap(level);
  if (map === null) return undefined;
  const hidden = map.get(y * (terrain[0]?.length ?? 0) + x);
  return hidden !== undefined && terrain[y][x] === level.terrain[y][x] ? hidden : undefined;
}
