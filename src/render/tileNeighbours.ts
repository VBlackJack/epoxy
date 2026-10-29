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

/**
 * Neighbourhood of a terrain cell, so walls can join into one mass and floors can
 * receive the shadow of the walls next to them. Computed while the terrain cache is
 * rebuilt, never per frame.
 */

/** One bit per neighbour, clockwise from north. */
export const NEIGHBOUR = {
  N: 1,
  NE: 2,
  E: 4,
  SE: 8,
  S: 16,
  SW: 32,
  W: 64,
  NW: 128
} as const;

const OFFSETS: ReadonlyArray<readonly [number, number, number]> = [
  [0, -1, NEIGHBOUR.N],
  [1, -1, NEIGHBOUR.NE],
  [1, 0, NEIGHBOUR.E],
  [1, 1, NEIGHBOUR.SE],
  [0, 1, NEIGHBOUR.S],
  [-1, 1, NEIGHBOUR.SW],
  [-1, 0, NEIGHBOUR.W],
  [-1, -1, NEIGHBOUR.NW]
];

/** What the renderer needs to know about a cell's surroundings. */
export interface TileNeighbours {
  /** Neighbours that belong to the same wall mass. */
  wallMask: number;
  /** Neighbours that cast a shadow onto this cell. */
  shadowMask: number;
  /** Stable pseudo-random value for this cell, used to vary floor details. */
  hash: number;
}

/** A cell with no known surroundings: drawn as a free-standing tile (editor, icons). */
export const ISOLATED_TILE: Readonly<TileNeighbours> = { wallMask: 0, shadowMask: 0, hash: 0 };

/**
 * Returns the bits of the neighbours of (x, y) whose tile is in `tileIds`.
 * Cells outside the grid count as matching when `outsideMatches` is set, so walls
 * along the border of the map show no rim facing the void.
 */
export function neighbourMask(
  terrain: readonly (readonly string[])[],
  x: number,
  y: number,
  tileIds: ReadonlySet<string>,
  outsideMatches: boolean
): number {
  let mask = 0;
  for (const [dx, dy, bit] of OFFSETS) {
    const row = terrain[y + dy];
    const tileId = row?.[x + dx];
    if (tileId === undefined ? outsideMatches : tileIds.has(tileId)) mask |= bit;
  }
  return mask;
}

/** True when every bit of `bits` is set in `mask`. */
export function hasAll(mask: number, bits: number): boolean {
  return (mask & bits) === bits;
}

/** Integer hash of a cell position, stable across sessions and well spread over 32 bits. */
export function cellHash(x: number, y: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Builds the neighbourhood of one cell. */
export function tileNeighbours(
  terrain: readonly (readonly string[])[],
  x: number,
  y: number,
  wallTileIds: ReadonlySet<string>,
  shadowCasterIds: ReadonlySet<string>
): TileNeighbours {
  return {
    wallMask: neighbourMask(terrain, x, y, wallTileIds, true),
    shadowMask: neighbourMask(terrain, x, y, shadowCasterIds, false),
    hash: cellHash(x, y)
  };
}
