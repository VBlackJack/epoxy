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

import type { TileDefinition } from '../core/types';
import { familyMembers, variantFamilyOf } from './paletteVariants';
import { nextRailPiece } from './railRotation';

/** What the rotate key turns the brush into. */
export interface BrushCycleStep {
  /** The tile the brush becomes. */
  id: string;
  /** Whether it is a rail piece (a quarter turn) rather than a variant of a family. */
  rail: boolean;
  /** One-based position of the new tile among its family; 0 for a rail piece. */
  position: number;
  /** How many variants the family has; 0 for a rail piece. */
  count: number;
}

/**
 * The tile the rotate key selects after the given one, read from the tile configs alone: a rail piece turns a quarter
 * turn (see nextRailPiece), and a tile of a variant family moves to the next variant in config order, wrapping from
 * the last back to the first. Null when the tile has nothing to cycle through.
 */
export function nextBrushTile(tile: TileDefinition, tiles: Readonly<Record<string, TileDefinition>>): BrushCycleStep | null {
  const rail = nextRailPiece(tile, tiles);
  if (rail !== null) return { id: rail, rail: true, position: 0, count: 0 };
  const family = variantFamilyOf(tile);
  if (family === null) return null;
  const members = familyMembers(tiles, family, tile.category);
  const index = members.findIndex((member) => member.id === tile.id);
  if (index < 0 || members.length < 2) return null;
  const next = (index + 1) % members.length;
  return { id: members[next].id, rail: false, position: next + 1, count: members.length };
}
