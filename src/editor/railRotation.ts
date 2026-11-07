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

import type { Direction, TileDefinition } from '../core/types';
import { rotateClockwise } from './editorKeyboard';

/** The sides of a rail, as a sorted key that does not depend on the order the tile lists them in. */
function sideKey(sides: readonly Direction[]): string {
  return [...sides].sort().join('');
}

/**
 * The rail piece the rotate key selects after the given one, read from the tile configs alone: a fixed piece turns
 * a quarter turn clockwise (straight north-south then east-west, a bend north-east then south-east, south-west,
 * north-west), and a rail switch swaps with the form it toggles into. Null when the tile is not a rail or no tile
 * has the turned sides.
 */
export function nextRailPiece(tile: TileDefinition, tiles: Readonly<Record<string, TileDefinition>>): string | null {
  if (tile.railSides === undefined) return null;
  if (tile.togglesTo !== undefined) return tiles[tile.togglesTo]?.railSides === undefined ? null : tile.togglesTo;
  const wanted = sideKey(tile.railSides.map(rotateClockwise));
  const match = Object.values(tiles).find(
    (other) => other.id !== tile.id && other.togglesTo === undefined && other.railSides !== undefined && sideKey(other.railSides) === wanted
  );
  return match?.id ?? null;
}
