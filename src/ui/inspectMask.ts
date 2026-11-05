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

/** Tiles the inspect tooltip passes off as floor until the player holds boots that reveal hidden walls. */
const HIDDEN_WALL_TILE_IDS: ReadonlySet<string> = new Set(['invisible_wall', 'appearing_wall']);

/** Tile the inspect tooltip shows for a terrain cell: a fake blue wall always reads as a real one. */
export function inspectDisplayTileId(tileId: string, hiddenWallsRevealed: boolean): string {
  if (tileId === 'blue_wall_fake') return 'blue_wall_real';
  if (HIDDEN_WALL_TILE_IDS.has(tileId) && !hiddenWallsRevealed) return 'floor';
  return tileId;
}
