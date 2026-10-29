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

import { Direction } from './types';

/** Terrain id used when a cell has no explicit terrain, or a tile has no transform target. */
export const FLOOR_TILE_ID = 'floor';

/** Terrain left behind by a block sunk in water when neither config names one. */
export const SUNK_BLOCK_TILE_ID = 'dirt';

/** Template cloned by a clone link whose cloner has no entity sitting on it. */
export const DEFAULT_CLONE_TEMPLATE_TYPE = 'dirt_block';

/** Facing given to an element that does not define one. */
export const DEFAULT_FACING: Direction = 'S';

/** Move interval of a monster whose definition does not set moveIntervalTicks. */
export const DEFAULT_MONSTER_MOVE_INTERVAL_TICKS = 5;

export const OPPOSITE_DIRECTION: Readonly<Record<Direction, Direction>> = {
  N: 'S',
  S: 'N',
  E: 'W',
  W: 'E'
};
