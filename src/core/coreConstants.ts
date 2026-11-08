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

import { ButtonAction, ChannelColor, Direction, MirrorAxis, MirrorCorner, PlayerCharacter, Ruleset, WinRule } from './types';

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

/** Item id of the hiking boots Melinda needs on dirt and gravel. */
export const HIKING_BOOTS_ITEM_ID = 'hiking_boots';

/** Prefix of the item-layer no-signs: `no_sign_<item>` bars a player who carries that item, on any terrain. */
export const NO_SIGN_ITEM_PREFIX = 'no_sign_';

/**
 * The items a player can carry, hence the items a no-sign can name (one `no_sign_<item>` tile each, in the item layer):
 * the four keys, every pair of boots and boot-like item (the steel foil too), the blast charge, the pocket gate, the hurl stone,
 * the toll token and the bribe.
 */
export const NO_SIGN_ITEM_IDS: readonly string[] = [
  'key_red',
  'key_blue',
  'key_yellow',
  'key_green',
  'boots_water',
  'boots_fire',
  'boots_ice',
  'boots_force',
  'slow_time',
  'boots_speed',
  'boots_eye',
  'boots_pull',
  'ward',
  'hiking_boots',
  'charge',
  'pocket_gate',
  'hurl_stone',
  'toll_token',
  'steel_foil',
  'bribe'
];

/** Item id of the Chip's Challenge 2 steel foil: boots that turn a bumped wall into a steel wall. */
export const STEEL_FOIL_ITEM_ID = 'steel_foil';

/** Item id of the Chip's Challenge 2 bribe: a counted item that every thief takes instead of what it steals. */
export const BRIBE_ITEM_ID = 'bribe';

/** Item id of the toggle clock, which pauses and resumes the level timer when stepped on. */
export const TOGGLE_CLOCK_ITEM_ID = 'toggle_clock';

/** Terrain id of plain ice; its `protectedByItem` names the boots that stop the slide. */
export const ICE_TILE_ID = 'ice';

/** Every character a level can be played with, in the order the editor offers them. */
export const PLAYER_CHARACTERS: readonly PlayerCharacter[] = ['chip', 'melinda'];

/** The character of a level that names none. */
export const DEFAULT_PLAYER_CHARACTER: PlayerCharacter = 'chip';

/** The character that does not slide on ice and needs hiking boots on dirt and gravel. */
export const MELINDA_CHARACTER: PlayerCharacter = 'melinda';

/** Half-width (Chebyshev radius) of the square region where a gray button swaps chips and bombs. */
export const GRAY_BUTTON_RADIUS = 2;

/** Item id of the blast charge a player carries and drops. */
export const CHARGE_ITEM_ID = 'charge';

/** Item id of the pocket gate a player carries and sets down as a teleporter pad. */
export const GATE_ITEM_ID = 'pocket_gate';

/** Terrain id of the pad a pocket gate becomes where it is set down. */
export const GATE_PAD_TILE_ID = 'pocket_gate_pad';

/** Teleport group of the relay pads, lit and dark: they link only with each other. */
export const RELAY_TELEPORT_GROUP = 'relay';

/** Item id of the hurl stone a player carries and throws. */
export const STONE_ITEM_ID = 'hurl_stone';

/** Item id of the toll token a player carries and a thief takes instead of the boots or keys. */
export const TOKEN_ITEM_ID = 'toll_token';

/** Counted items that are spent at a thief and never set down: the toll token and the bribe. */
export const THIEF_PAYMENT_ITEM_IDS: ReadonlySet<string> = new Set([TOKEN_ITEM_ID, BRIBE_ITEM_ID]);

/** Payload of a shot the player threw, as opposed to one a launcher fired. */
export const STONE_SHOT_PAYLOAD = 'hurl_stone';

/** Message key of the death caused by a thrown stone that came back. */
export const STONE_DEATH_REASON_KEY = 'hud.messages.death_stone';

/** Half-width (Chebyshev radius) of the square a blast charge clears of monsters and blocks, and kills the player in. */
export const CHARGE_BLAST_RADIUS = 1;

/** Sound effect of a blast charge going off. */
export const CHARGE_BLAST_SFX = 'bomb';

/** Message key of the death caused by a blast charge. */
export const CHARGE_DEATH_REASON_KEY = 'hud.messages.death_blast';

/** Hazards that end the game on contact unless their immunity boot is held. */
export const DEADLY_HAZARDS: ReadonlySet<string> = new Set(['water', 'fire', 'slime']);

/** Terrain left behind by a block sunk in water when neither config names one. */
export const SUNK_BLOCK_TILE_ID = 'dirt';

/** Terrain a block must cover to win a level whose win rule is 'targets'. */
export const BLOCK_TARGET_TILE_ID = 'block_target';

/** Tile ids the pack format check reads without the tile registry (an early export may run before the configs load). */
export const SIGNAL_BUTTON_TILE_ID = 'signal_button';
export const CLONE_MACHINE_TILE_ID = 'clone_machine';
/** The shipped tiles a signal link can flip (green toggle walls and rail switches), read by name before the configs are loaded. */
export const FLIP_SINK_TILE_IDS: ReadonlySet<string> = new Set([
  'toggle_wall_closed',
  'toggle_wall_open',
  'rail_switch_a',
  'rail_switch_b'
]);
export const SHOT_LAUNCHER_TILE_ID_PREFIX = 'shot_launcher_';

/** Terrain that only shows a hint: walkable by the player and pushable across by a block, with no effect. */
export const HINT_TILE_ID = 'hint';

/** Win rule of a level that declares none. */
export const DEFAULT_WIN_RULE: WinRule = 'exit';

/** Ruleset of a level that declares none. */
export const DEFAULT_RULESET: Ruleset = 'epoxy';

/** Button action of a steering pad: every steered monster takes one step the way the player moved. */
export const STEER_MONSTERS_ACTION: ButtonAction = 'steer_monsters';

/**
 * Button action of a gray area button: when an actor arrives, every wired device (a sink of the signal network) within the
 * square of GRAY_BUTTON_RADIUS cells around it is pulsed, with no wire from the button.
 */
export const PULSE_WIRED_ACTION: ButtonAction = 'pulse_wired_area';

/** Button action of a shot trigger: every launcher linked to the button fires one shot. */
export const FIRE_LAUNCHERS_ACTION: ButtonAction = 'fire_launchers';

/** Signal links a level may hold per cell at most (a shape check on stored levels, not a design limit). */
export const SIGNAL_LINKS_PER_CELL_MAX = 4;

/** Length bounds of the optional port name of a signal link. */
export const SIGNAL_PORT_MIN_LENGTH = 1;
export const SIGNAL_PORT_MAX_LENGTH = 16;

/** Tile id of the shot trigger, the tile whose action is fire_launchers. */
export const SHOT_TRIGGER_TILE_ID = 'shot_trigger';

/** Movement pattern of a monster that steps toward the player. */
export const CHASE_PLAYER_PATTERN = 'chase_player';

/** Movement pattern of a monster that steps away from the player (a chase with the candidates reversed). */
export const FLEE_PLAYER_PATTERN = 'flee_player';

/** Movement pattern of a monster that never moves by itself (a sleeping lurker). */
export const STATIONARY_PATTERN = 'stationary';

/** Prefix of every id reserved for a Chip's Challenge 2 mechanic Epoxy does not play (public/configs/cc2-tiles.json). */
export const CC2_ID_PREFIX = 'cc2_';

/** Name of the validator issue parameter that lists the reserved ids of unplayable mechanics. */
export const MECHANICS_PARAM = 'mechanics';

/** Separator of the ids in the mechanics parameter. */
export const MECHANICS_SEPARATOR = ',';

/** Value of the `unimplemented` flag of a reserved Chip's Challenge 2 definition. */
export const CC2_UNIMPLEMENTED_SOURCE = 'cc2';

/**
 * Movement pattern of a monster that walks straight ahead through every tile (a wisp): terrain has no effect on
 * it, only cell edges, the map edge and other entities stop it, and it turns round once when blocked.
 */
export const PHASE_LINE_PATTERN = 'phase_line';

/**
 * Movement pattern of a monster that borrows the behaviour of other monsters in turn (a rover): its definition
 * lists them in `emulates` and says after how many step decisions it moves on to the next one.
 */
export const EMULATE_CYCLE_PATTERN = 'emulate_cycle';

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

/** Parity bit of the green toggle walls (the plain toggle_walls action). */
export const GREEN_TOGGLE_PARITY_BIT = 1;

/** Parity bit of each colour toggle channel, above the green bit. */
export const CHANNEL_TOGGLE_PARITY_BITS: Readonly<Partial<Record<ChannelColor, number>>> = {
  red: 2,
  blue: 4,
  yellow: 8
};

/** Parity bit of the flame jets (the toggle_flames action), above the colour channel bits. */
export const FLAME_TOGGLE_PARITY_BIT = 16;

/** Prefix of the toggle parity in a search state key. */
export const TOGGLE_PARITY_KEY_PREFIX = 'tp';

/** Prefix of the paused flag of the level timer in a search state key; only a level with a toggle clock has one. */
export const TIMER_PAUSE_KEY_PREFIX = 'tm';

/** Prefix of the turning force floor turn in a search state key. */
export const FORCE_CYCLE_KEY_PREFIX = 'fc';

/** Prefix of the lit blast charges in a search state key. */
export const LIT_CHARGE_KEY_PREFIX = 'lc';

/** Prefix of the spent reveal cells in a search state key. */
export const SPENT_REVEAL_KEY_PREFIX = 'rv';

/** Prefix of the swivel door entry sides in a search state key. */
export const SWIVEL_ENTRY_KEY_PREFIX = 'sw';

/** Value of `swivelRule` on the swivel doors that play by the Chip's Challenge 2 rule (see TileDefinition.swivelRule). */
export const CC2_SWIVEL_RULE = 'cc2';

/** The fields of a tile that tell which toggle family it belongs to. */
interface ToggleFamilyFields {
  togglesTo?: string;
  toggleChannel?: ChannelColor;
  channelTogglesTo?: string;
  flameTogglesTo?: string;
}

/** The parity bit of the toggle family (green or colour wall, flame jet) a tile belongs to, or 0 when it is in none. */
export function toggleParityBitOf(tile: ToggleFamilyFields): number {
  if (tile.toggleChannel !== undefined) {
    return tile.channelTogglesTo === undefined ? 0 : (CHANNEL_TOGGLE_PARITY_BITS[tile.toggleChannel] ?? 0);
  }
  if (tile.togglesTo !== undefined) return GREEN_TOGGLE_PARITY_BIT;
  return tile.flameTogglesTo === undefined ? 0 : FLAME_TOGGLE_PARITY_BIT;
}

/** The other form of a toggle wall (green or colour) or of a flame jet, or undefined for any other tile. */
export function toggleWallOtherForm(tile: ToggleFamilyFields): string | undefined {
  return tile.toggleChannel !== undefined ? tile.channelTogglesTo : (tile.togglesTo ?? tile.flameTogglesTo);
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
