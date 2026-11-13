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
 * the four keys, every pair of boots and boot-like item (the steel foil too), the blast charge, the dynamite, the pocket gate, the hurl stone,
 * the toll token, the bribe, the lightning bolt and the railroad sign.
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
  'dynamite',
  'pocket_gate',
  'hurl_stone',
  'toll_token',
  'steel_foil',
  'bribe',
  'lightning_bolt',
  'railroad_sign'
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

/** The character a transmogrifier turns the given character into: Chip becomes Melinda and Melinda becomes Chip. */
export function transmogrifiedCharacter(character: PlayerCharacter): PlayerCharacter {
  return character === MELINDA_CHARACTER ? DEFAULT_PLAYER_CHARACTER : MELINDA_CHARACTER;
}

/** Half-width (Chebyshev radius) of the square region where a gray button swaps chips and bombs. */
export const GRAY_BUTTON_RADIUS = 2;

/**
 * The kinds of item a monster that picks things up (the CC2 ghost and rover) takes: the keys and the tools. The chips and
 * the bonuses stay on the map, and so does the red key, which only a player takes (Lexy's Labyrinth item priorities).
 */
export const MONSTER_PICKUP_COLLECTIBLES: readonly string[] = ['key', 'boot', 'charge', 'gate', 'stone', 'token'];
/** The colour of the key that no monster picks up. */
export const MONSTER_IGNORED_KEY_COLOR = 'red';

/** Item id of the blast charge a player carries and drops. */
export const CHARGE_ITEM_ID = 'charge';

/** Item id of the Chip's Challenge 2 dynamite a player carries and sets down. */
export const DYNAMITE_ITEM_ID = 'dynamite';

/** Item id of the lit Chip's Challenge 2 dynamite. */
export const DYNAMITE_LIT_ITEM_ID = 'dynamite_lit';

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

/** Counted items that are spent at a thief and never set down: the toll token, the bribe and the lightning bolt. */
export const THIEF_PAYMENT_ITEM_IDS: ReadonlySet<string> = new Set([TOKEN_ITEM_ID, BRIBE_ITEM_ID]);

/** Payload of a shot the player threw, as opposed to one a launcher fired. */
export const STONE_SHOT_PAYLOAD = 'hurl_stone';

/** Message key of the death caused by a thrown stone that came back. */
export const STONE_DEATH_REASON_KEY = 'hud.messages.death_stone';

/** Half-width (Chebyshev radius) of the square a blast charge clears of monsters and blocks, and kills the player in. */
export const CHARGE_BLAST_RADIUS = 1;

/** Half-width (Chebyshev radius) of the square that bounds the dynamite blast. */
export const DYNAMITE_BLAST_RADIUS = 2;

/** The dynamite blast spares the cells whose |dx| + |dy| reaches this sum: the four far corners of its square. */
export const DYNAMITE_BLAST_CORNER_SUM = 4;

/** Stand-in blast tick of a set-down dynamite whose player has not left yet: it never comes due. */
export const DYNAMITE_NOT_LIT_TICK = Number.MAX_SAFE_INTEGER;

/** What dynamite leaves under a creature standing on plain floor: fire, or water under an ice block. */
export const DYNAMITE_FIRE_TILE_ID = 'fire';

/** Tile id of the pink button of format 16 (the wire plate): the one held source a CC2 level reads from an actor at rest. */
export const SIGNAL_PLATE_TILE_ID = 'signal_plate';
/** Tile id of the held orange button of format 16: pressed by every actor standing on it. */
export const BUTTON_ORANGE_CC2_TILE_ID = 'button_orange_cc2';
/** Tile ids of the wired flame jet of format 16, off and lit. */
export const FLAME_JET_CC2_OFF_TILE_ID = 'flame_jet_cc2_off';
export const FLAME_JET_CC2_ON_TILE_ID = 'flame_jet_cc2_on';
/** Entity id of the dirt block, the one block the CC2 item bar (blocksDirtBlock) applies to. */
export const DIRT_BLOCK_ENTITY_ID = 'dirt_block';
export const DYNAMITE_WATER_TILE_ID = 'water';
export const DYNAMITE_ICE_BLOCK_TYPE = 'ice_block';

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

/** Most players a level may place beyond the first (a level with several players): a stored list longer than this is cut. */
export const EXTRA_PLAYERS_MAX = 7;

/** Length bounds of the optional port name of a signal link. */
export const SIGNAL_PORT_MIN_LENGTH = 1;
export const SIGNAL_PORT_MAX_LENGTH = 16;

/** Port names of a gate with ordered ports: `in0` and `in1` are inputs, `out0` and `out1` outputs; `>` joins an output to an input. */
export const SIGNAL_PORT_IN_PREFIX = 'in';
export const SIGNAL_PORT_OUT_PREFIX = 'out';
export const SIGNAL_PORT_JOINER = '>';

/** The largest digit a counter gate holds; it wraps to 0 above and to this below 0. */
export const SIGNAL_COUNTER_MAX = 9;

/** Item id of the lightning bolt: while held, the player powers the wires of the cell they stand on. */
export const LIGHTNING_BOLT_ITEM_ID = 'lightning_bolt';

/** Tile id of the floor a wire runs under, a signal source that is on while a player holding the lightning bolt stands there. */
export const WIRE_FLOOR_TILE_ID = 'signal_wire_floor';

/** Tile id prefix of the counter gates; the digit the counter starts with follows it. */
export const SIGNAL_COUNTER_TILE_ID_PREFIX = 'signal_counter_';

/**
 * Id suffix of the Chip's Challenge 2 passable form of a signal gate (`signal_gate_and_cc2`, `signal_counter_3_cc2`): the
 * same logic as the gate it follows, but every actor walks through it, as through the CC2 logic gate.
 */
export const SIGNAL_GATE_CC2_ID_SUFFIX = '_cc2';

/** The ids of the signal gates that have a CC2 passable form: the logic gates and the ten counters. */
export const CC2_GATE_BASE_IDS: readonly string[] = [
  'signal_gate_and',
  'signal_gate_or',
  'signal_gate_not',
  'signal_gate_xor',
  'signal_gate_nand',
  'signal_gate_dlatch',
  ...Array.from({ length: SIGNAL_COUNTER_MAX + 1 }, (_, digit) => `${SIGNAL_COUNTER_TILE_ID_PREFIX}${digit}`)
];

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

/**
 * Movement pattern of a monster that draws one direction at random each time it may move and waits when the drawn way
 * is blocked, without spending the rest of its step (the CC3D omni).
 */
export const RANDOM_DRAW_PATTERN = 'random_draw';

/**
 * Movement pattern of a monster that goes straight on and, when that way is blocked, draws one direction at random
 * and waits when the drawn way is blocked too, without spending the rest of its step (the CC3D walker).
 */
export const FORWARD_ELSE_DRAW_PATTERN = 'forward_else_draw';

/** Id of the turtle tile: a floor that sinks into water behind whoever leaves it. */
export const TURTLE_TILE_ID = 'turtle';

/** Template cloned by a clone link whose cloner has no entity sitting on it. */
export const DEFAULT_CLONE_TEMPLATE_TYPE = 'dirt_block';

/** Facing given to an element that does not define one. */
export const DEFAULT_FACING: Direction = 'S';

/** Move interval of a monster whose definition does not set moveIntervalTicks. */
export const DEFAULT_MONSTER_MOVE_INTERVAL_TICKS = 5;

/**
 * Classic Chip's Challenge monster cadence, used only by a level that plays with the classic rules (ccRules). A step
 * lasts this many ticks for the classic monsters, and a monster decides again the tick its step ends.
 */
export const CC_MONSTER_STEP_TICKS = 4;

/**
 * Entity passes between the blue button press and the tank turning around, on a classic-rules level counted from the passes
 * begun before the press, whoever pressed. Measured against the reference engine
 * on the official levels: tanks of the classic ruleset turn four passes after the press.
 */
export const CC_TANK_TURN_DELAY_PASSES = 4;

/**
 * Slide delay of a force floor on a classic-rules level: the floor carries the player one cell every two ticks (the
 * cooldown is the wait between two slide steps, so one tick of it makes two ticks per cell), with none of the extra
 * delay a native force floor adds.
 */
export const CC_FORCE_SLIDE_COOLDOWN_TICKS = 1;

/** Slide delay of ice on a classic-rules level: like a force floor, one cell every two ticks. */
export const CC_ICE_SLIDE_COOLDOWN_TICKS = 1;

/** Slide delay of a block on ice or a force floor on a classic-rules level: one cell every two ticks, like the player. */
export const CC_BLOCK_SLIDE_COOLDOWN_TICKS = 1;

/**
 * Ticks a chosen step onto ice or a force floor, and the arrival of a slide step, wait before the first slide step on a
 * converted CC3D level (CC3D fast step: two ticks), whatever the floor.
 */
export const CC3D_SLIDE_ENTRY_COOLDOWN_TICKS = 2;

/**
 * Ticks the player waits on a teleporter after his step ended on it, before the forced exit step starts, on a converted
 * CC3D level: the jump happens when the step ends and the exit step is decided on the next tick.
 */
export const CC3D_TELEPORT_LANDING_WAIT_TICKS = 1;

/** Slide delay between two cells of a slide of the player on a converted CC3D level: one cell every two ticks. */
export const CC3D_SLIDE_STEP_COOLDOWN_TICKS = 1;

/** Ticks the player stays busy after the step that ends a slide, before his input is read again (converted CC3D level). */
export const CC3D_SLIDE_END_WAIT_TICKS = 1;

/** Slide delay of the first slide step of a block the player pushed onto ice or a force floor (converted CC3D level). */
export const CC3D_PUSHED_BLOCK_ENTRY_COOLDOWN_TICKS = 2;

/**
 * Entity passes a monster's button press waits before it takes effect on a classic-rules level (a blob waits
 * CC_BLOB_BUTTON_DELAY_PASSES). Calibrated against Chip's Challenge 1 (Steam and the original .DAT levels) and the
 * official Chip's Challenge 2 levels.
 */
export const CC_MONSTER_BUTTON_DELAY_PASSES = 2;

/** Entity passes a blob's button press waits (see CC_MONSTER_BUTTON_DELAY_PASSES). */
export const CC_BLOB_BUTTON_DELAY_PASSES = 6;

/**
 * Entity passes between a queued monster press that reverses the tanks and the tanks turning, counted from the pass
 * that applies the press (a player's own press keeps CC_TANK_TURN_DELAY_PASSES). Same calibration as the button delay.
 */
export const CC_QUEUED_TANK_TURN_DELAY_PASSES = 1;

/**
 * Ticks a player who slid onto a teleporter waits before the forced exit step: the time of a slide step, not the
 * walking wait. Same calibration as the button delay.
 */
export const CC_TELEPORT_SLIDE_WAIT_TICKS = 2;

/** Ticks a classic blob step lasts (a blob covers a cell at half the speed of the other monsters). */
export const CC_BLOB_STEP_TICKS = 8;

/** The classic monsters that follow the cadence above; any other monster keeps its own move interval. */
export const CC_BLOB_TYPE = 'blob';
export const CC_WALKER_TYPE = 'walker';
export const CC_TEETH_TYPE = 'teeth';
export const CC_CADENCE_TYPES: readonly string[] = ['bug', 'paramecium', 'pink_ball', 'walker', 'glider', 'fireball', 'tank', CC_TEETH_TYPE, CC_BLOB_TYPE];

/** The timid teeth and the ghost: they follow the classic cadence on a CC2-engine level only (CC2 gives them the classic step). */
export const CC_TIMID_TEETH_TYPE = 'timid_teeth';
export const CC_GHOST_TYPE = 'ghost';
export const CC2_EXTRA_CADENCE_TYPES: readonly string[] = [CC_TIMID_TEETH_TYPE, CC_GHOST_TYPE];

/** True when `type` follows the classic cadence; `cc2Engine` adds the CC2-only types (timid teeth, ghost). */
export function followsCcCadence(type: string, cc2Engine: boolean): boolean {
  return CC_CADENCE_TYPES.includes(type) || (cc2Engine && CC2_EXTRA_CADENCE_TYPES.includes(type));
}

/** True for monsters that decide only in the active half of the teeth cycle; the timid teeth do so on a CC2-engine level only. */
export function followsTeethPhase(type: string, cc2Engine: boolean): boolean {
  return type === CC_TEETH_TYPE || (cc2Engine && type === CC_TIMID_TEETH_TYPE);
}

/** CC2-engine levels: a monster step onto ice or a force floor lasts this share of a step (the destination's speed factor). */
export const CC2_FLOOR_STEP_DIVISOR = 2;

/** CC2-engine levels: keys that do not stop a monster, and the one of them a monster picks up (the red key is left lying). */
export const CC2_MONSTER_PASSABLE_KEYS: readonly string[] = ['key_blue', 'key_red'];
export const CC2_MONSTER_PICKED_KEY = 'key_blue';

/** Converted CC3D levels: ticks of a monster step on plain floor, and on ice or a force floor (the floor carries it faster). */
export const CC3D_MONSTER_STEP_TICKS = 4;
export const CC3D_MONSTER_FLOOR_STEP_TICKS = 2;
/**
 * Converted CC3D levels: a snappy and a nibble rest after a step they chose, and after a blocked try, for this many ticks
 * (times the slow-time factor), during which they decide nothing.
 */
export const CC3D_REST_PHASE_TICKS = 4;
export const CC3D_RESTING_TYPES: readonly string[] = ['snappy', 'nibble'];

/** Ticks one step of a classic monster lasts; the blob steps at half the speed of the others. */
export function ccStepTicks(type: string): number {
  return type === CC_BLOB_TYPE ? CC_BLOB_STEP_TICKS : CC_MONSTER_STEP_TICKS;
}

/** Teeth decide only during the first CC_TEETH_ACTIVE_TICKS ticks of each CC_TEETH_CYCLE_TICKS cycle (they move at half rate). */
export const CC_TEETH_CYCLE_TICKS = 8;
export const CC_TEETH_ACTIVE_TICKS = 4;

/** CC2-engine levels: the teeth cycle is shifted by this many ticks (Lexy step_parity 5), so they decide when (tick + 5) mod 8 < 4. */
export const CC2_TEETH_PHASE_OFFSET = 5;

/** Whether teeth (and timid teeth) may decide at monster clock `clock`; a CC2-engine level shifts the cycle by CC2_TEETH_PHASE_OFFSET. */
export function teethMayDecide(clock: number, cc2: boolean): boolean {
  return (clock + (cc2 ? CC2_TEETH_PHASE_OFFSET : 0)) % CC_TEETH_CYCLE_TICKS < CC_TEETH_ACTIVE_TICKS;
}

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

/** Prefix of the player's character in a search state key; written only while a transmogrifier made it differ from the level's. */
export const PLAYER_CHARACTER_KEY_PREFIX = 'pc';

/** Prefix of the parked players and the exit count in a search state key; written only on a level with several players. */
export const PLAYERS_KEY_PREFIX = 'pl';

/** Prefix of the turning force floor turn in a search state key. */
export const FORCE_CYCLE_KEY_PREFIX = 'fc';

/** Prefix of the lit blast charges in a search state key. */
export const LIT_CHARGE_KEY_PREFIX = 'lc';

/** Prefix of the spent reveal cells in a search state key. */
export const SPENT_REVEAL_KEY_PREFIX = 'rv';

/** Prefix of the swivel door entry sides in a search state key. */
export const SWIVEL_ENTRY_KEY_PREFIX = 'sw';

/** Terrain id of a Chip's Challenge 2 track cell; its segments live in the level's `railTracks`. */
export const RAIL_JUNCTION_TILE_ID = 'rail_junction';

/** Item id of the Chip's Challenge 2 railroad sign: boots whose holder ignores the track constraints. */
export const RAILROAD_SIGN_ITEM_ID = 'railroad_sign';

/**
 * The two sides each track segment of a track cell joins, in the order of the mask bits (the Lexy's Labyrinth railroad
 * `track_order`): north-east, south-east, south-west, north-west, east-west, north-south.
 */
export const RAIL_TRACK_SIDES: ReadonlyArray<readonly [Direction, Direction]> = [
  ['N', 'E'],
  ['S', 'E'],
  ['S', 'W'],
  ['N', 'W'],
  ['E', 'W'],
  ['N', 'S']
];

/** Number of track segments a track cell can hold. */
export const RAIL_TRACK_COUNT = RAIL_TRACK_SIDES.length;

/** Mask with every segment of a track cell set. */
export const RAIL_TRACK_MASK_ALL = (1 << RAIL_TRACK_COUNT) - 1;

/** Entry side of a track cell nobody came into: the south side, as for an actor that came in moving north (the modifier default). */
export const RAIL_DEFAULT_ENTRY: Direction = 'S';

/** Prefix of the step-end effects waiting on the players of a converted CC3D level in a search state key; written only while one waits. */
export const CC3D_ARRIVAL_KEY_PREFIX = 'ca';
/** Prefix of the apparent player position in the runtime key of a CC2-engine level. */
export const CC2_PLAYER_VIEW_KEY_PREFIX = 'pv';

/** Prefix of the track cell state in a search state key. */
export const RAIL_STATE_KEY_PREFIX = 'rl';

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

/** Bit of the canopy flag in the mask of a level's cell edges: a roof over the cell, not a side (see cellEdgeMask). */
export const CELL_EDGE_CANOPY_BIT = 16;

/** Entity id of the arrow block that shows no arrow: no push moves it (the one block allowed an empty pushArrows list). */
export const LOCKED_ARROW_BLOCK_ID = 'arrow_block_none';

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
