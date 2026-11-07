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

import type { Cc2Cell, Cc2Map, Cc2Tile } from './cc2Model';

/** Builders of synthetic CC2 maps for tests: no licensed data, only codes the format documents. */

export const FLOOR_CODE = 0x01;
const NO_TAIL = new Uint8Array(0);

/** A tile with a one-byte modifier. */
export function modTile(code: number, mod: number): Cc2Tile {
  return { code, mod, modBytes: 1 };
}

/** An actor tile with its facing byte. */
export function actorTile(code: number, dir = 2): Cc2Tile {
  return { code, dir };
}

/** One cell: tiles from the top layer down; a plain floor closes it when no terrain is given. */
export function cell(...tiles: Cc2Tile[]): Cc2Cell {
  return { tiles };
}

/** A [x, y, cell] placement. */
export type Placement = [number, number, Cc2Cell];

/** A map of floors with the given placements. */
export function makeMap(width: number, height: number, placements: Placement[] = []): Cc2Map {
  const cells: Cc2Cell[] = Array.from({ length: width * height }, () => cell({ code: FLOOR_CODE }));
  for (const [x, y, placed] of placements) cells[y * width + x] = placed;
  return { width, height, cells, tail: NO_TAIL };
}

/** Placement of a stack: top-first tiles, the last one being the terrain. */
export function put(x: number, y: number, ...tiles: Cc2Tile[]): Placement {
  return [x, y, cell(...tiles)];
}

/** Placement of a player on a floor. */
export function player(x: number, y: number, dir = 2, code = 0x16): Placement {
  return put(x, y, actorTile(code, dir), { code: FLOOR_CODE });
}
