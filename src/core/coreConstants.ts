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

import { Direction, MirrorAxis, Ruleset, WinRule } from './types';

/** Terrain id used when a cell has no explicit terrain, or a tile has no transform target. */
export const FLOOR_TILE_ID = 'floor';

/** Terrain used to fill the cells of a map that lie outside a smaller level. */
export const WALL_TILE_ID = 'wall';

/** Terrain id of a level exit. */
export const EXIT_TILE_ID = 'exit';

/** Item id of a standard collectible chip. */
export const CHIP_ITEM_ID = 'chip';

/** Item id of a bomb hazard. */
export const BOMB_ITEM_ID = 'bomb';

/** Half-width (Chebyshev radius) of the square region where a gray button swaps chips and bombs. */
export const GRAY_BUTTON_RADIUS = 2;

/** Hazards that end the game on contact unless their immunity boot is held. */
export const DEADLY_HAZARDS: ReadonlySet<string> = new Set(['water', 'fire', 'slime']);

/** Terrain left behind by a block sunk in water when neither config names one. */
export const SUNK_BLOCK_TILE_ID = 'dirt';

/** Terrain a block must cover to win a level whose win rule is 'targets'. */
export const BLOCK_TARGET_TILE_ID = 'block_target';

/** Terrain that only shows a hint: walkable by the player and pushable across by a block, with no effect. */
export const HINT_TILE_ID = 'hint';

/** Win rule of a level that declares none. */
export const DEFAULT_WIN_RULE: WinRule = 'exit';

/** Ruleset of a level that declares none. */
export const DEFAULT_RULESET: Ruleset = 'epoxy';

/** Template cloned by a clone link whose cloner has no entity sitting on it. */
export const DEFAULT_CLONE_TEMPLATE_TYPE = 'dirt_block';

/** Facing given to an element that does not define one. */
export const DEFAULT_FACING: Direction = 'S';

/** Move interval of a monster whose definition does not set moveIntervalTicks. */
export const DEFAULT_MONSTER_MOVE_INTERVAL_TICKS = 5;

/**
 * Visits a laser trace may make per cell of the map: one per direction a beam
 * can cross the cell in, which bounds every trace even on a ring of mirrors.
 */
export const LASER_VISITS_PER_CELL = 4;

/**
 * Direction a laser beam leaves a mirror in, by the direction it was travelling
 * when it hit. A '/' mirror turns an east-moving beam to the north, a backslash
 * mirror turns it to the south; both are double-sided.
 */
export const MIRROR_REFLECTIONS: Readonly<Record<MirrorAxis, Readonly<Record<Direction, Direction>>>> = {
  slash: { E: 'N', N: 'E', W: 'S', S: 'W' },
  backslash: { E: 'S', S: 'E', W: 'N', N: 'W' }
};

export const OPPOSITE_DIRECTION: Readonly<Record<Direction, Direction>> = {
  N: 'S',
  S: 'N',
  E: 'W',
  W: 'E'
};
