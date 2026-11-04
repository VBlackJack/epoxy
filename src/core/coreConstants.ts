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

import { ButtonAction, ChannelColor, Direction, MirrorAxis, MirrorCorner, Ruleset, WinRule } from './types';

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

/** Button action of a steering pad: every steered monster takes one step the way the player moved. */
export const STEER_MONSTERS_ACTION: ButtonAction = 'steer_monsters';

/** Button action of a shot trigger: every launcher linked to the button fires one shot. */
export const FIRE_LAUNCHERS_ACTION: ButtonAction = 'fire_launchers';

/** Tile id of the shot trigger, the tile whose action is fire_launchers. */
export const SHOT_TRIGGER_TILE_ID = 'shot_trigger';

/** Movement pattern of a monster that steps toward the player. */
export const CHASE_PLAYER_PATTERN = 'chase_player';

/** Movement pattern of a monster that steps away from the player (a chase with the candidates reversed). */
export const FLEE_PLAYER_PATTERN = 'flee_player';

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

/**
 * The axis of a one-sided mirror by the corner its reflecting face looks toward: the mirror runs along the
 * diagonal that cuts the corner off, which is a backslash for the NE and SW corners and a slash for NW and SE.
 */
export const MIRROR_FRONT_AXIS: Readonly<Record<MirrorCorner, MirrorAxis>> = {
  NE: 'backslash',
  SW: 'backslash',
  NW: 'slash',
  SE: 'slash'
};

/** The two sides of the cell that meet at each corner: a one-sided mirror reflects what enters through them. */
export const MIRROR_FRONT_SIDES: Readonly<Record<MirrorCorner, readonly Direction[]>> = {
  NE: ['N', 'E'],
  NW: ['N', 'W'],
  SE: ['S', 'E'],
  SW: ['S', 'W']
};

export const OPPOSITE_DIRECTION: Readonly<Record<Direction, Direction>> = {
  N: 'S',
  S: 'N',
  E: 'W',
  W: 'E'
};

/** The colours a plate, hold door, colour block or toggle channel may have. */
export const CHANNEL_COLORS: readonly ChannelColor[] = ['red', 'green', 'blue', 'yellow'];

/** The colour channels that have toggle walls; green is the plain toggle_walls action, not a colour channel. */
export const TOGGLE_CHANNEL_COLORS: readonly ChannelColor[] = ['red', 'blue', 'yellow'];

/** Locale key prefix of the channel colour names ("Red", "Rouge"...), followed by the colour. */
export const CHANNEL_COLOR_NAME_KEY_PREFIX = 'editor.cc3d.color.';

/** The button action that drives each colour wall channel; the green button is the plain toggle_walls action. */
export const CHANNEL_BUTTON_ACTIONS: Readonly<Partial<Record<ChannelColor, ButtonAction>>> = {
  red: 'toggle_walls_red',
  blue: 'toggle_walls_blue',
  yellow: 'toggle_walls_yellow'
};

/** The colour wall channel each colour toggle button drives, the inverse of CHANNEL_BUTTON_ACTIONS. */
const CHANNEL_OF_BUTTON_ACTION: Readonly<Partial<Record<ButtonAction, ChannelColor>>> = Object.fromEntries(
  Object.entries(CHANNEL_BUTTON_ACTIONS).map(([color, action]) => [action, color])
);

/** The channel a colour toggle button drives, or undefined for any other button action. */
export function channelOfButtonAction(action: ButtonAction | undefined): ChannelColor | undefined {
  return action === undefined ? undefined : CHANNEL_OF_BUTTON_ACTION[action];
}

/** Bit of each side in the mask of a level's cell edges (see cellEdgeMask). */
export const CELL_EDGE_BITS: Readonly<Record<Direction, number>> = {
  N: 1,
  E: 2,
  S: 4,
  W: 8
};

/** Order in which the sides of a cell edge are stored and listed. */
export const CELL_EDGE_SIDE_ORDER: readonly Direction[] = ['N', 'E', 'S', 'W'];

/**
 * The direction a mirror sends something travelling in `dir` in, or null when it hits the back of a
 * one-sided mirror. A mirror without a front corner is double-sided and always turns it. Something that
 * travels south entered through the north side, so it meets the front when the opposite of its
 * direction is one of the two sides that meet at the front corner.
 */
export function reflectOnMirror(axis: MirrorAxis, frontCorner: MirrorCorner | undefined, dir: Direction): Direction | null {
  if (frontCorner !== undefined && !MIRROR_FRONT_SIDES[frontCorner].includes(OPPOSITE_DIRECTION[dir])) return null;
  return MIRROR_REFLECTIONS[axis][dir];
}
