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

import { PACK_JSON_VERSION_V12_IDS } from '../../config/constants';
import { CC2_ID_PREFIX } from '../coreConstants';
import type { Cc2Coverage, Cc2CoverageVerdict } from '../types';

/**
 * Coverage of the Chip's Challenge 2 elements by the native Epoxy engine: for one level, which elements Epoxy plays
 * exactly, approximately, or loses. Modelled on the CC3D table (src/core/cc3d/epoxyCoverage.ts). Keys are the names of
 * the CC2 elements in snake_case, with the same words as the reserved ids (cc2_purple_wall is the key purple_wall).
 * The importer collects the keys of a level from its tile codes and calls `classifyCc2Level`; the result is saved with
 * the level.
 *
 * Policy. `exact` means no known mechanism difference with CC2, as the Lexy's Labyrinth engine implements it (the
 * behaviour reference). Per-tick timing is judged by the replay check of the importer, not by coverage. A known
 * mechanism deviation, even a small one, keeps the key `approx`.
 */

export interface Cc2CoverageEntry {
  level: Cc2CoverageVerdict;
  reason: string;
}

/** Structural keys: properties of a level or of a relation between elements rather than of one element. */
export const KEY_MULTIPLE_PLAYERS = 'multiple_players';
export const KEY_STEEL_WALL_DESTROYER = 'steel_wall_with_destroyer';
export const KEY_WIRE = 'wire';
export const KEY_WIRE_TUNNEL = 'wire_tunnel';
/** A pop-up wall in a level whose blocks or rovers CC2 lets into the cell; the plain popup_wall key is exact. */
export const KEY_POPUP_WALL_BLOCKS = 'popup_wall_blocks';
/** An open trap (code 0x41): CC2 starts it open, Epoxy places the closed trap. */
export const KEY_TRAP_OPEN = 'trap_open';
/** Wired sinks Epoxy does not play as CC2 does. */
export const KEY_WIRED_TELEPORT = 'wired_teleport';
export const KEY_WIRED_TRANSMOGRIFIER = 'wired_transmogrifier';
export const KEY_WIRED_TRACK = 'wired_track';
export const KEY_WIRED_TRACK_UNLINKED = 'wired_track_unlinked';
/** The canopy flag of a thin wall: a modifier of the cell, not a terrain. */
export const KEY_CANOPY = 'canopy';
/** A code the importer's table does not know; it stands for the cc2_unknown placeholder. */
export const KEY_UNKNOWN = 'unknown';

const EXACT_REASON = 'Epoxy plays this element as CC2 does.';
const WIRE_REASON =
  'Wire topology (floor wires, crossings, tunnels, sources, gates) is played as in CC2; checked against the Lexy Labyrinth wiring rules. Signals settle at the end of a move where CC2 settles every tick: that timing is judged by the replay check. Wired sinks Epoxy does not play as CC2 are reported under their own keys (wired_teleport, wired_transmogrifier, wired_flame_jet).';
const RESERVED_REASON =
  'Epoxy does not play this element: the converter keeps it as a reserved placeholder (a wall for a terrain, inert for an item, motionless for an entity), so the level is not playable as imported.';
const TELEPORT_REASON =
  'The target and the exit order differ from CC2: the Epoxy player leaves facing first, then in a fixed order, where CC2 tries other sides [unverified].';
const YELLOW_TELEPORT_REASON =
  'Epoxy plays the yellow pad as its forward pad: same ring order and forward-only exit as CC2. Three differences: the imported pad is drawn as the forward pad (blue with a forward mark), not yellow; Lexy lets the player steer off the destination pad (teleport-soft) where Epoxy places it on the exit cell; a CC2 yellow pad with no free destination is picked up as an item by the player (in a level with several yellow pads), which Epoxy cannot do, and the CC2 ring ends on the pad itself (the mover leaves forward from it) where the Epoxy forward pad never lands on itself and stays put.';
const GREEN_BUTTON_REASON =
  'Epoxy plays the green button as CC2 does: it flips the toggle walls and swaps every green chip with a green bomb and back.';
const MECHANIC_REASON =
  'The mechanic exists in Epoxy and is mapped one to one. Timing fidelity is judged by the replay check of the importer, not by coverage.';
const CANOPY_REASON =
  'A canopy is a flag on the thin wall of a cell (0x10): Epoxy keeps it with the cell edges, hides the cell under a roof, and bugs and rovers cannot enter it (blobs do not step from one canopy to another), as the canopy layer does in the Lexy Labyrinth engine. Epoxy draws it semi-opaque (cosmetic). The dynamite shield of the canopy is reported under the dynamite key.';
const NO_SIGN_REASON =
  'Epoxy plays a no-sign over a key or boots as its forbid tile: the player cannot enter while carrying the item and the item is not placed, so it cannot be picked up [unverified, medium-high confidence in the CC2 rule].';
const NO_SIGN_ITEM_REASON =
  'Epoxy plays a no-sign over a carried item as a sign on the item layer: the item is not placed so it cannot be picked up, a player carrying it cannot enter the cell, and the terrain under it keeps working. Blocks carry nothing, so they pass; monsters do not enter a cell that holds an item, as in CC2. The bar follows Lexy\'s Labyrinth (no_sign in tiletypes.js) [unverified against CC2 itself].';
const NO_SIGN_BONUS_REASON =
  'A no-sign over a bonus flag, a stopwatch or the toggle clock bars nobody, since no player ever carries one: Epoxy drops the item so it cannot be picked up, as the sign does in Lexy\'s Labyrinth; the cell is then open to monsters (and, for the clock, to blocks), which an item would have kept out [unverified against CC2 itself].';
const NO_SIGN_NO_EFFECT_REASON =
  'A no-sign bars only an actor that already carries the item shown under it (Lexy\'s Labyrinth no_sign.blocks in tiletypes.js). On a wall everyone is stopped anyway, and no player carries a chip or a bomb (chips are counted, a bomb is not an item), so Epoxy drops the sign and keeps the wall, chip or bomb working as usual. Not modelled: a sign that would also stop the chip or bomb from being taken or set off, and a wall destroyed later that would uncover the sign [unverified against CC2 itself].';
const EXTRA_CHIP_REASON =
  'The extra chip is picked up like a chip but is not counted toward the socket: Epoxy plays it as a chip and the socket requirement counts only the computer chips of the level.';
const STEEL_WALL_REASON =
  'Epoxy plays the steel wall as a wall that blasts never destroy; what else resists a blast in CC2 is judged by steel_wall_with_destroyer.';
const GREEN_CHIP_REASON =
  'Epoxy plays the green chip as an item that counts toward the socket and swaps with the green button. That CC2 counts green chips toward the chips required is medium confidence.';
const MELINDA_PLAYER_REASON =
  'Epoxy plays a level whose only player is Melinda with its melinda character: no slide on ice, hiking boots for dirt and gravel.';
const BRIBE_REASON =
  'Epoxy plays the bribe as a counted item that every thief takes instead of what it steals, spent even when the thief had nothing to take (the rule of the Lexy Labyrinth engine; whether the CC2 key thief also accepts it is medium confidence).';
const STEEL_FOIL_REASON =
  'Epoxy plays the steel foil as boots that turn a bumped plain wall into a steel wall without using up the foil, as the foiled trait does in the Lexy Labyrinth engine (wall and foil in tiletypes.js). Corner cases (a ghost bump, a wall under a no-foil sign) are not mechanisms an author builds.';
const TOGGLE_CLOCK_REASON =
  'Epoxy plays the toggle clock as an item that stays on the map, pauses or resumes the level timer when the player steps on it and keeps monsters and every block out of its cell. CC2 bars the plain dirt block only, and the interplay with the time bonus items is [unverified].';
const DYNAMITE_REASON =
  'Epoxy plays dynamite with the CC2 blast of the Lexy Labyrinth engine: lit once the player leaves the cell, a fuse of 85 ticks, a 5 x 5 square without its far corners that destroys items and turns terrain into floor (steel wall, socket and logic gates resist, creatures are killed). Differences: a lit dynamite is an item in Epoxy, so it blocks nothing and never slides on ice or force floors; thin walls on the cells are not destroyed and canopies do not shield their cell; a cracked floor would become a hole but Epoxy has no such tile; a no-sign on the cell does not stop the lighting; a lit dynamite does not block re-entry of its cell; the explosion animation does not block the player; the fuse may be one tick off [unverified].';
const TRACK_REASON =
  'Epoxy plays a CC2 track cell as a track cell of its own (rail_junction): entering only through a side an open track touches, leaving only along a track that joins the side of entry (a block may back out), a blocked step of the player, a pushed block or a monster turned right, left then back, and a switch that advances when an actor leaves along the active track or a gray button works. The validator and the hints read a track cell as open floor (they over-approximate). Deviations: the thin walls of the cell are not read when a step is turned, the ghost leaves no entry side, and a switch that a wire touches but no source drives is not wire-only (see wired_track_unlinked) [unverified against the game: the rules are those of the Lexy Labyrinth engine].';
const RAILROAD_SIGN_REASON =
  'Epoxy plays the railroad sign as boots: the player who holds it ignores the track cells (enters and leaves on any side, is never turned, and still moves the switches). A thief takes it with the other boots, as in CC2.';
const GENDER_SIGN_REASON =
  'Epoxy plays the gender sign as a terrain tile that stops the other character.';

/*
 * Keys are CC2 wiki names in snake_case. The comment on each group maps them to the Epoxy ids they play as.
 */

/**
 * Exact. Epoxy ids: floor, wall, ice and the four ice corners, water, fire, force_n/e/s/w, exit, dirt, gravel, socket,
 * hint, key_* and door_* (red, blue, yellow, green), chip, boots_water (flippers), boots_fire (fire boots), boots_ice
 * (cleats), boots_force (suction boots), invisible_wall, appearing_wall, blue_wall_real/fake, thin walls (cell edges),
 * swivel doors, toggle_wall_open/closed, button_green/blue/brown/red, trap, clone_machine, teleport_blue (unwired),
 * thief and thief_keys, bomb, stopwatch_bonus, stopwatch_penalty (time_penalty), score_10/100/1000/2x, purple_wall and
 * purple_floor (flipped by the wire, both edges), toggle_switch_off/on and black_button (wire sources) and nand_gate
 * (signal_gate_nand). The
 * data latch (signal_gate_dlatch, both rotations) plays under the wire key. The wire timing
 * is judged by the wire key, so a wired level stays approximate.
 */
const EXACT_KEYS: readonly string[] = [
  'floor', 'wall', 'ice', 'ice_corner', 'water', 'fire', 'force_floor', 'exit', 'dirt', 'gravel', 'socket', 'hint',
  'key_blue', 'key_red', 'key_yellow', 'key_green', 'door_blue', 'door_red', 'door_yellow', 'door_green',
  'chip', 'flippers', 'fire_boots', 'cleats', 'suction_boots', 'invisible_wall', 'appearing_wall',
  'blue_wall_real', 'blue_wall_fake', 'thin_wall', 'swivel_door', 'toggle_wall_open', 'toggle_wall_closed',
  'button_green', 'button_blue', 'button_brown', 'button_red', 'trap', 'clone_machine', 'custom_floor',
  'teleport_blue', 'thief_tools', 'thief_keys', 'bomb', 'time_bonus', 'time_penalty', 'steel_wall',
  'bonus_flag_10', 'bonus_flag_100', 'bonus_flag_1000', 'bonus_flag_2x', 'extra_chip', 'no_sign_empty',
  'green_chip', 'green_bomb', 'hiking_boots', 'gender_sign_male', 'gender_sign_female', 'melinda_player', 'bribe', 'railroad_sign',
  'purple_wall', 'purple_floor', 'toggle_switch', 'black_button', 'nand_gate',
  'wire_tunnel', 'secret_eye', 'speed_boots', 'steel_foil', 'no_sign_key', 'no_sign_boots', 'no_sign_item',
  'wired_trap', KEY_WIRED_TRACK, 'green_wall', KEY_CANOPY, 'popup_wall', KEY_WIRE
];

/**
 * Monsters and blocks: the mechanic exists, so the key is exact. Epoxy ids: bug, fireball, glider, paramecium, tank,
 * pink_ball, teeth, walker, blob; timid_teeth, floor_mimic; dirt_block, ice_block, arrow_block_* (directional blocks).
 * Teeth flee Melinda and timid teeth flee Chip (chasing the other), as in CC2. The floor mimic is a chaser four times
 * slower than the ordinary monsters.
 * Chain pushing (an ice or directional block pushing a line of blocks) is an Epoxy rule; a block that slides on ice or a
 * force floor still stops at the first block it meets, where CC2 may push it along [unverified].
 */
const MECHANIC_KEYS: readonly string[] = [
  'bug', 'fireball', 'glider', 'paramecium', 'tank', 'pink_ball', 'teeth', 'walker', 'blob',
  'dirt_block', 'ice_block', 'arrow_block', 'timid_teeth', 'floor_mimic'
];

/** What the two mirror players share: how Epoxy plays them and where it differs from CC2 [unverified]. */
const MIRROR_REASON =
  'Epoxy plays the mirror player as a monster that copies each move the player attempts (a blocked one too) while the player is the character it mirrors, and does nothing otherwise. It obeys the terrain rules of its character, pushes blocks, presses buttons, takes keys, boots and other items on its way (chips stay), reveals no wall by touching it (Lexy can_reveal_walls is not modelled), dies in water, fire and bombs without ending the level, and kills the player on contact, as the Lexy Labyrinth engine does. Known differences: it steps at once with the player, where CC2 moves it at its own pace; it keeps no inventory (it opens only the doors of its own key colour); a trapped player does not move it; the floors it ignores are rails, turning force floors and teleport rules other than the plain ones [unverified].';

/** Exact keys that carry their own reason instead of the generic one. */
const EXACT_REASONS: Readonly<Record<string, string>> = {
  button_green: GREEN_BUTTON_REASON,
  steel_wall: STEEL_WALL_REASON,
  extra_chip: EXTRA_CHIP_REASON,
  green_chip: GREEN_CHIP_REASON,
  bribe: BRIBE_REASON,
  railroad_sign: RAILROAD_SIGN_REASON,
  melinda_player: MELINDA_PLAYER_REASON,
  gender_sign_male: GENDER_SIGN_REASON,
  gender_sign_female: GENDER_SIGN_REASON,
  wire_tunnel: 'Epoxy matches tunnels like brackets with nesting, as the Lexy Labyrinth engine does (algorithms.js tunnel matching).',
  secret_eye: 'Epoxy plays the secret eye as the eye boots; the Lexy Labyrinth engine uses the perceptive trait nowhere in game rules (visual only), and the eye boots only reveal hidden walls in the renderer.',
  speed_boots: 'Epoxy halves the walk cooldown of the holder and leaves ice and force floor timing untouched, as the hasty trait does in the Lexy Labyrinth engine (attempt_step).',
  steel_foil: STEEL_FOIL_REASON,
  no_sign_key: NO_SIGN_REASON,
  no_sign_boots: NO_SIGN_REASON,
  no_sign_item: NO_SIGN_ITEM_REASON,
  wired_trap: 'A wired trap (code 0x42) is open while its signal is on or a brown button is held, as a CC2 trap counts wire power as an extra press (trap on_power and on_depower in the Lexy Labyrinth engine). The pre-opened trap (0x41) is reported under trap_open.',
  green_wall: 'The solid green wall (0x7d, popdown_wall) bars everything but the ghost in the Lexy Labyrinth engine; Epoxy plays it as a plain wall, which the Epoxy ghost also crosses.',
  [KEY_CANOPY]: CANOPY_REASON,
  popup_wall: 'Epoxy plays the pop-up wall as a recessed wall: the player enters, monsters are barred and the cell turns to wall when its occupant leaves, as popwall does in the Lexy Labyrinth engine. Emitted only when the level holds no ice block, arrow block or rover (those enter a CC2 pop-up wall); see popup_wall_blocks.',
  [KEY_WIRE]: WIRE_REASON,
  [KEY_WIRED_TRACK]:
    'A wire reaches a track switch: it advances the switch on the rising edge of its input and a wired switch moves by wire only, as the railroad does in the Lexy Labyrinth engine (on_power).'
};

const APPROX_ENTRIES: Readonly<Record<string, string>> = {
  // Epoxy: extraPlayers, with the swap move.
  [KEY_MULTIPLE_PLAYERS]: 'Epoxy plays every player of the level: the first in reading order is the start, the others are extra starts, a swap hands control on and the level ends when all players have left. Known difference: with three or more players the swap key walks the queue forward in Epoxy, where the Lexy Labyrinth engine goes to the previous live player in reading order (identical for two players). How CC2 itself picks the controlled player when one dies is not checked.',
  // Epoxy: toggle_clock.
  toggle_clock: TOGGLE_CLOCK_REASON,
  // Epoxy: steel_wall next to a destroyer other than dynamite; the importer no longer sets this key for dynamite.
  [KEY_STEEL_WALL_DESTROYER]:
    'A steel wall resists what destroys plain walls in CC2 (dynamite, a time bomb); Epoxy steel walls resist dynamite as CC2 does, and the time bomb is not played [unverified].',
  // Epoxy: the sign is dropped, the wall, chip or bomb stays.
  no_sign_no_effect: NO_SIGN_NO_EFFECT_REASON,
  // Epoxy: the bonus or time item is dropped.
  no_sign_bonus: NO_SIGN_BONUS_REASON,
  // Epoxy: button_gray_area.
  button_gray:
    'Epoxy plays the CC2 gray button as a button that works, within its 5 x 5 square and wire or no wire, the green toggle walls and the purple tiles (flipped), the force floors that point one way (turned round), the swivel doors (a quarter turn), the flame jets and the rail switches (flipped or moved on), and the launchers and clone machines (fired once), as gray_button in the Lexy Labyrinth engine does. Known differences: it also pulses a wired trap, which CC2 leaves alone; it does not work the turntables, which Epoxy does not have; and the order in which the devices of the square are worked is the Epoxy one (the signal network first, then row by row), where CC2 goes column by column [unverified for the cases where the order matters].',
  // Epoxy: flame_jet_wired_off, flame_jet_wired_on.
  wired_flame_jet: 'Epoxy flips a wired flame jet on both edges of its signal; that CC2 flips it on both edges is [unverified].',
  // Epoxy: button_orange.
  button_orange: 'Epoxy plays the orange button as its flame button; the CC2 button acts on the flame jets around it, where Epoxy toggles them all [unverified].',
  // Epoxy: flame_jet_on, flame_jet_off.
  flame_jet: 'Epoxy flame jets follow the Epoxy orange button, which toggles every jet where the CC2 one is local [unverified].',
  // Epoxy: force_cycle.
  force_floor_random: 'Epoxy plays the CC2 random force floor as the turning force floor, one shared clockwise counter as in the Lexy Labyrinth engine (true randomness is a Microsoft-ruleset switch there). Two differences an author can see: the Epoxy sequence starts east where CC2 starts north, and Epoxy advances the counter on every arrival, including actors that ignore force floors (suction boots, forceproof), which do not advance it in CC2.',
  // Epoxy: hurl_stone.
  bowling_ball: 'Epoxy plays the bowling ball as a hurl stone: it flies the same way but its range and what it breaks differ [unverified].',
  // Epoxy: ward.
  helmet: 'Epoxy plays the helmet as a ward, which absorbs the first monster contact; the CC2 helmet protects against other things too [unverified]. The reserved id cc2_helmet stays available for a stricter import.',
  // Epoxy: dynamite and dynamite_lit.
  dynamite: DYNAMITE_REASON,
  // Epoxy: boots_pull.
  hook: 'Epoxy plays the hook as its pull boots: the block directly behind the holder is pulled one step after a voluntary step, as the adhesive trait does in the Lexy Labyrinth engine. Edge rules differ: Epoxy does not pull a block off a matching plate, nor when the holder steps onto a teleporter, nor on forced slide steps.',
  // Epoxy: hint.
  // Epoxy: floor.
  letter: 'The glyph is lost; the cell plays as floor.',
  // Epoxy: transmogrifier.
  transmogrifier: 'Epoxy swaps monsters of its own pairs, and a powered CC2 transmogrifier follows its wire where the Epoxy one is always on [unverified].',
  // Epoxy: teleport_red, teleport_yellow, teleport_green.
  teleport_red: TELEPORT_REASON,
  // Epoxy: teleport_forward (exit forward only, the pad is never its own destination).
  teleport_yellow: YELLOW_TELEPORT_REASON,
  teleport_green: 'The CC2 green teleport picks a random destination, where the Epoxy one is deterministic [unverified].',
  // Epoxy: teleport_blue plus a relay pad for the wire.
  teleport_blue_wired: `${TELEPORT_REASON} A wired teleport also follows its wire, which the Epoxy relay pad only approximates.`,
  // Epoxy: slime.
  slime:
    'Slime kills every monster but the ghost and the blob, as in the Lexy Labyrinth engine; the Epoxy blob is not hurt by it and, once it has stood on slime, turns each plain, itemless floor cell it leaves into slime. Known differences: CC2 slimes the floor a blob steps onto only while the cell it came from is slime, so the chain stops as soon as the blob steps on anything else, where the Epoxy blob keeps spreading; the boulder (which also spreads slime in CC2) is not modelled; and a dirt or ice block pushed onto slime clears it and survives in CC2, where Epoxy consumes the block (the CC3D rule, shared on purpose).',
  // Epoxy: turtle.
  turtle: 'Turtle behaviour is close to the Epoxy equivalent, not identical [unverified].',
  // Epoxy: rail_* pieces and rail_switch_a/b.
  track: TRACK_REASON,
  track_junction: TRACK_REASON,
  // Epoxy: puppet (steered by the puppet control).
  yellow_tank: 'Epoxy plays the yellow tank as a puppet steered by the puppet control. Known difference: gravel bars the yellow tank in CC2 (monster_typical collision in the Lexy Labyrinth engine), where the Epoxy puppet crosses gravel; the step order also differs.',
  button_yellow: 'Epoxy plays the yellow button as the puppet control; only the player works it [unverified].',
  // Epoxy: recessed_wall, in a level where CC2 lets an ice block, an arrow block or a rover into the cell.
  // Epoxy: signal_wire_floor, the floor a wire runs under on a level that holds a bolt.
  lightning_bolt: 'Epoxy powers the wire nets fed by the wire floor the player stands on while holding the bolt, sampled when the signals settle after a move. CC2 powers them only while the holder stands still (the charged trait in the Lexy Labyrinth engine): a holder sliding or walking over wire floor powers a net in Epoxy that CC2 leaves off. CC2 electrified floor, which the bolt also powers, is not handled.',
  // Epoxy: signal_counter_0 to signal_counter_9.
  counter_gate: 'Epoxy has counter gates with up and down inputs and overflow and underflow outputs, as the Lexy Labyrinth counter logic gate, but it settles its signals at the end of a move: when two inputs rise inside one move the final count can differ and an overflow or underflow pulse can be merged or lost, a different result from CC2 and not only a timing shift.',
  [KEY_POPUP_WALL_BLOCKS]: 'Epoxy plays the pop-up wall as a recessed wall, which bars every block and monster. The Lexy Labyrinth engine bars only dirt blocks and typical monsters (popwall in tiletypes.js), so ice blocks, arrow blocks and rovers may enter a CC2 pop-up wall: this level holds one of them (or a clone machine holding one).',
  // Epoxy: trap, placed closed.
  [KEY_TRAP_OPEN]: 'CC2 starts a trap placed open (code 0x41) open until the first release of its button; Epoxy places the plain, closed trap.',
  // Epoxy: wired teleports are played as plain pads.
  [KEY_WIRED_TELEPORT]: 'A wire reaches a teleport (red, yellow, green or blue). CC2 isolates wired blue pads into networks and lets a wire switch a red pad off; Epoxy ignores the wire and keeps one level-wide group.',
  // Epoxy: transmogrifier ignores its wire.
  [KEY_WIRED_TRANSMOGRIFIER]: 'A wire reaches a transmogrifier. A powered CC2 transmogrifier switches on and off with its wire; the Epoxy one is always on.',
  // Epoxy: rail_junction, a switch no link reaches.
  [KEY_WIRED_TRACK_UNLINKED]: 'A wire touches a track switch but no supported source drives it (dangling, or fed only by gates Epoxy does not play): the Epoxy switch still moves when an actor leaves along the active track, where CC2 makes a wired switch wire-only.',
  // Epoxy: blue_wall_fake.
  green_wall_fake: 'Epoxy plays the fake green wall as a fake blue wall [unverified].',
  // Epoxy: ghost.
  ghost:
    'Epoxy plays the ghost as a monster that walks through walls, doors, sockets and thin walls but not steel walls, clone machines or water, turning forward, left, right, back, and that ice, force floors, rails, traps, bombs, fire and pop-up walls do not affect. It picks up the keys (the red one excepted) and the tools it walks over, as the CC2 ghost does, and leaves chips, bonuses and the red key where they lie; it presses the buttons it crosses. Known differences: it keeps no inventory, so the boots it took do nothing for it (flippers do not let it cross water, which CC2 allows) and a taken item is simply gone; a clone machine stops the Epoxy ghost (deliberate, to keep clone templates well defined), where it passes in CC2. It does not transmogrify: the Epoxy teeth pair with the skitter, so timid teeth have no partner.',
  // Epoxy: mirror_chip and mirror_melinda.
  mirror_chip: `${MIRROR_REASON} Mirror Chip opens green doors and slides on ice.`,
  mirror_melinda: `${MIRROR_REASON} Mirror Melinda opens yellow doors, does not slide on ice and is stopped by dirt and gravel.`,
  // Epoxy: rover.
  rover:
    'Epoxy plays the rover as a monster that follows teeth, glider, bug, ball, timid teeth, fireball, paramecium and walker in turn, moving on after 32 step decisions. Known differences: Epoxy counts one decision per step and one per tick while the rover is blocked, where CC2 decides every tic it is not moving; the rover pushes one block at a time (no chain) and, as in CC2, enters exits, sockets once no chip is missing, dirt (packing it down), gravel and the keys thief, walks over every item and takes the keys (the red one excepted) and the tools. Remaining differences: it keeps no inventory (a taken item is simply gone and does nothing for it); CC2 also lets it onto clone machines, which Epoxy still bars to it, and onto pop-up walls (reported under their own key); it enters the thief_keys tile only, and a CC2 thief_tools tile imports as the shared thief id, which it cannot enter; the rover also takes bonus items in CC2 (only the ghost refuses them), where Epoxy leaves them on the floor. Fake walls bar the rover in CC2 as they do here.',
  // Epoxy: dirt_block.
  arrow_block_cross: 'A directional block with four arrows is played as a dirt block, which any push moves but which cannot push other blocks along as the CC2 directional block does.'
};

const LOST_ENTRIES: Readonly<Record<string, string>> = {
  no_sign: 'A no-sign over an item that has no Epoxy sign tile (and is not a wall, chip or bomb) has no Epoxy equivalent: the sign is dropped and the level is not playable as imported.',
  [KEY_UNKNOWN]: 'The importer met a code its table does not know; the cell is kept as the cc2_unknown placeholder.'
};

/** Reserved ids whose key is classified by a mapping above instead of being lost. */
const MAPPED_RESERVED_NAMES: readonly string[] = [
  'helmet', 'steel_wall', 'extra_chip', 'purple_wall', 'purple_floor', 'toggle_switch', 'black_button', 'button_gray',
  'green_chip', 'green_bomb', 'hiking_boots', 'gender_sign_male', 'gender_sign_female', 'steel_foil', 'toggle_clock',
  'ghost', 'rover', 'floor_mimic', 'timid_teeth', 'nand_gate', 'counter_gate', 'lightning_bolt', 'track_junction', 'railroad_sign', 'mirror_chip', 'mirror_melinda'
];

const VERDICT_RANK: Readonly<Record<Cc2CoverageVerdict, number>> = { exact: 0, approx: 1, lost: 2 };

function entry(level: Cc2CoverageVerdict, reason: string): Cc2CoverageEntry {
  return { level, reason };
}

/** The key of a reserved id: the id without its prefix. */
export function cc2KeyOfReservedId(id: string): string {
  return id.startsWith(CC2_ID_PREFIX) ? id.slice(CC2_ID_PREFIX.length) : id;
}

function buildTable(): Record<string, Cc2CoverageEntry> {
  const table: Record<string, Cc2CoverageEntry> = {};
  // Every reserved id is lost unless a mapping below plays it as an Epoxy element.
  for (const id of PACK_JSON_VERSION_V12_IDS) {
    const key = cc2KeyOfReservedId(id);
    if (!MAPPED_RESERVED_NAMES.includes(key)) table[key] = entry('lost', RESERVED_REASON);
  }
  for (const [key, reason] of Object.entries(LOST_ENTRIES)) table[key] = entry('lost', reason);
  for (const [key, reason] of Object.entries(APPROX_ENTRIES)) table[key] = entry('approx', reason);
  for (const key of MECHANIC_KEYS) table[key] = entry('exact', MECHANIC_REASON);
  for (const key of EXACT_KEYS) table[key] = entry('exact', EXACT_REASONS[key] ?? EXACT_REASON);
  return table;
}

/** Coverage of every element key. */
export const CC2_COVERAGE: Readonly<Record<string, Cc2CoverageEntry>> = Object.freeze(buildTable());

/** Every key the table classifies, sorted: the list the importer's tile table must stay inside. */
export const CC2_COVERAGE_KEYS: readonly string[] = Object.freeze(Object.keys(CC2_COVERAGE).sort());

/** The explicit lists the table is built from, for the test that no key is listed twice. */
export const CC2_KEY_GROUPS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  exact: EXACT_KEYS,
  mechanic: MECHANIC_KEYS,
  approx: Object.keys(APPROX_ENTRIES),
  lost: Object.keys(LOST_ENTRIES)
});

/** The worse of two verdicts (lost is worse than approx, approx than exact). */
export function worstVerdict(a: Cc2CoverageVerdict, b: Cc2CoverageVerdict): Cc2CoverageVerdict {
  return VERDICT_RANK[a] >= VERDICT_RANK[b] ? a : b;
}

/**
 * Classifies a level from the keys of its elements: the verdict is the worst of them, and the lost and approximate
 * keys are listed (sorted, without repeats). A key the table does not know counts as the `unknown` key (lost), so a new
 * CC2 code can never slip through unclassified.
 */
export function classifyCc2Level(keys: Iterable<string>): Cc2Coverage {
  const lost = new Set<string>();
  const approx = new Set<string>();
  for (const key of keys) {
    const found = CC2_COVERAGE[key];
    if (!found) lost.add(KEY_UNKNOWN);
    else if (found.level === 'lost') lost.add(key);
    else if (found.level === 'approx') approx.add(key);
  }
  const verdict: Cc2CoverageVerdict = lost.size > 0 ? 'lost' : approx.size > 0 ? 'approx' : 'exact';
  return { verdict, lost: [...lost].sort(), approx: [...approx].sort() };
}
