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

import { DEFAULT_PLAYER_CHARACTER } from '../coreConstants';
import { PathEngine } from '../Pathfinder';
import { CclpEngine } from './CclpEngine';

/**
 * Terrain the player cannot tell from a plain wall: a fake or a real blue wall, an invisible wall and an appearing wall.
 * The path and objective searches see all of them as walls, so a plan never leans on what the board does not show.
 */
const LOOKS_LIKE_WALL: ReadonlySet<string> = new Set(['blue_wall_fake', 'blue_wall_real', 'invisible_wall', 'appearing_wall']);
const WALL_TILE_ID = 'wall';

/**
 * The CCLP engine as the path and objective searches read it. Read only: every answer comes from the engine's own views,
 * and nothing here reaches the simulation. The Lynx rules have no beams, no tracks and one character, and a CC1 tile bars
 * Chip only through its own passability.
 */
export function cclpPathView(engine: CclpEngine): PathEngine {
  return {
    getLevel: () => engine.getLevel(),
    getTerrain: () => engine.getTerrain().map((row) => row.map((id) => (LOOKS_LIKE_WALL.has(id) ? WALL_TILE_ID : id))),
    getItems: () => engine.getItems(),
    getEntities: () => engine.getEntities(),
    getPlayer: () => engine.getPlayer(),
    getBeamCells: () => [],
    isCellClosedTrap: (x, y) => engine.isCellClosedTrap(x, y),
    getChipsRemaining: () => engine.getChipsRemaining(),
    holdsItem: (itemId) => engine.holdsItem(itemId),
    getPlayerCharacter: () => DEFAULT_PLAYER_CHARACTER,
    getRailState: () => undefined,
    canPlayerStepOn: (tile) => tile.passableByPlayer === true && (tile.forbiddenItem === undefined || !engine.holdsItem(tile.forbiddenItem))
  };
}
