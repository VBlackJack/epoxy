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
/** Retired: stored by imports made before pack format 15, when the pop-up wall was a recessed wall that barred ice blocks, arrow blocks and rovers. The importer no longer emits it. */
export const KEY_POPUP_WALL_BLOCKS = 'popup_wall_blocks';
/** An open trap (code 0x41), played as trap_open: it starts open and closes on the first release of its button or fall of its wire. */
export const KEY_TRAP_OPEN = 'trap_open';
/** Wires Epoxy does not switch as CC2 does: a wire on a blue, yellow or green pad, or on a red pad or transmogrifier that no wire network reaches. */
export const KEY_WIRED_TELEPORT = 'wired_teleport';
export const KEY_WIRED_TRANSMOGRIFIER = 'wired_transmogrifier';
export const KEY_WIRED_TRACK = 'wired_track';
export const KEY_WIRED_TRACK_UNLINKED = 'wired_track_unlinked';
/** The canopy flag of a thin wall: a modifier of the cell, not a terrain. */
export const KEY_CANOPY = 'canopy';
/** A code the importer's table does not know; it stands for the cc2_unknown placeholder. */
export const KEY_UNKNOWN = 'unknown';
/** Two orange buttons (or an orange button and a wire) reach one flame jet: Epoxy ORs the sources. */
export const KEY_BUTTON_ORANGE_SHARED = 'button_orange_shared';
/** A helmet under a no-sign: the sign has no helmet form, so the import falls back to the ward. */
export const KEY_HELMET_NO_SIGN = 'helmet_no_sign';

const EXACT_REASON = 'Epoxy plays this element as CC2 does.';
const WIRE_REASON =
  'Wire topology (floor wires, crossings, tunnels, sources, gates) is played as in CC2; checked against the Lexy Labyrinth wiring rules. Signals settle at the end of a move where CC2 settles every tick: that timing is judged by the replay check. A CC2 logic gate has no collision, so the converter places the passable <gate>_cc2 form (signal_gate_and_cc2, signal_counter_3_cc2): every actor walks through it, with the wiring of the gate it follows. A wire reaching a red pad or a transmogrifier switches it on and off (the powered twin pair); wires Epoxy still does not follow are reported under their own keys (wired_teleport, wired_transmogrifier, wired_flame_jet).';
const RESERVED_REASON =
  'Epoxy does not play this element: the converter keeps it as a reserved placeholder (a wall for a terrain, inert for an item, motionless for an entity), so the level is not playable as imported.';
const TELEPORT_REASON =
  'The target and the exit order differ from CC2: the Epoxy player leaves facing first, then in a fixed order, where CC2 tries other sides [unverified].';
const YELLOW_TELEPORT_REASON =
  'Epoxy plays the yellow pad as its forward pad: same ring order and forward-only exit as CC2. Differences: the imported pad is drawn as the forward pad (blue with a forward mark), not yellow; Lexy lets the player steer off the destination pad (teleport-soft) where Epoxy places it on the exit cell; the CC2 ring ends on the pad itself (the mover leaves forward from it) where the Epoxy forward pad never lands on itself and stays put. A CC2 yellow pad with no free destination is picked up as an item by the player (in a level with several yellow pads), and Epoxy plays that as well, as a pad the player carries and sets down again; only the player takes a yellow pad, where the Lexy Labyrinth engine lets the monsters with pickup priority take it too.';
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
 * (cleats), boots_force (suction boots), invisible_wall, blue_wall_real/fake, thin walls (cell edges),
 * swivel doors, toggle_wall_open/closed, button_green/blue/brown/red, trap, clone_machine, teleport_blue (unwired),
 * thief and thief_keys, bomb, stopwatch_bonus, stopwatch_penalty (time_penalty), score_10/100/1000/2x, purple_wall and
 * purple_floor (flipped by the wire, both edges), toggle_switch_off/on and black_button (wire sources) and nand_gate
 * (signal_gate_nand). The
 * dirt is placed as dirt_cc2, which only the dirt block cannot enter. The
 * logic gates are placed as their passable <gate>_cc2 form, which every actor walks through. The
 * data latch (signal_gate_dlatch, both rotations) plays under the wire key. The wire timing
 * is judged by the wire key, so a wired level stays approximate.
 */
const EXACT_KEYS: readonly string[] = [
  'floor', 'wall', 'ice', 'ice_corner', 'water', 'fire', 'force_floor', 'exit', 'dirt', 'gravel', 'socket', 'hint',
  'key_blue', 'key_red', 'key_yellow', 'key_green', 'door_blue', 'door_red', 'door_yellow', 'door_green',
  'chip', 'flippers', 'fire_boots', 'cleats', 'suction_boots', 'invisible_wall',
  'blue_wall_real', 'blue_wall_fake', 'thin_wall', 'swivel_door', 'toggle_wall_open', 'toggle_wall_closed',
  'button_green', 'button_blue', 'button_brown', 'button_red', 'trap', 'clone_machine', 'custom_floor',
  'teleport_blue', 'thief_tools', 'thief_keys', 'bomb', 'time_bonus', 'time_penalty', 'steel_wall',
  'bonus_flag_10', 'bonus_flag_100', 'bonus_flag_1000', 'bonus_flag_2x', 'extra_chip', 'no_sign_empty',
  'green_chip', 'green_bomb', 'hiking_boots', 'gender_sign_male', 'gender_sign_female', 'melinda_player', 'bribe', 'railroad_sign',
  'purple_wall', 'purple_floor', 'toggle_switch', 'black_button', 'nand_gate',
  'wire_tunnel', 'secret_eye', 'speed_boots', 'steel_foil', 'no_sign_key', 'no_sign_boots', 'no_sign_item',
  'wired_trap', KEY_WIRED_TRACK, 'green_wall', KEY_CANOPY, 'popup_wall', KEY_TRAP_OPEN, 'arrow_block_cross', KEY_WIRE,
  'turtle', 'helmet', 'green_wall_fake'
];

/**
 * Monsters and blocks: the mechanic exists, so the key is exact. Epoxy ids: bug, fireball, glider, paramecium, tank,
 * pink_ball, teeth, walker, blob; timid_teeth, floor_mimic; dirt_block, ice_block, arrow_block_* (directional blocks).
 * Teeth flee Melinda and timid teeth flee Chip (chasing the other), as in CC2. The floor mimic is a chaser four times
 * slower than the ordinary monsters.
 * Chain pushing (an ice or directional block pushing a line of blocks) is an Epoxy rule, and a block that slides on ice or
 * a force floor shoves the resting block it reaches along the slide (see arrow_block_cross).
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
  turtle: 'Epoxy plays the turtle (turtle_cc2) as a lily pad on water that monsters may enter, as in CC2: it bars the fireball and the ghost, and turns to water behind whoever leaves it, a glider excepted. Only the dynamite-on-a-turtle quirk of CC2 is not modelled, and a level with dynamite is approximate on its own.',
  helmet: 'Epoxy plays the helmet as an item that shields its holder from the contact of monsters and blocks, as the invulnerable trait does in the Lexy Labyrinth engine; it does not protect from a bowling ball, as there. Turning the helmet into another item on a CC2 transmogrifier is reported under transmogrifier.',
  green_wall_fake: 'Epoxy plays the fake green wall (popdown floor) as the block barrier floor: the player and the monsters walk over it and every block is barred, as the popdown_floor tile does in the Lexy Labyrinth engine.',
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
  popup_wall: 'Epoxy plays the pop-up wall as popup_wall_cc2, as popwall does in the Lexy Labyrinth engine: the player enters, dirt blocks and typical monsters are barred while ice blocks, arrow blocks, rovers and ghosts walk in, and the cell turns to wall once its last occupant has left (not while another actor still stands on it, and not behind a ghost).',
  [KEY_TRAP_OPEN]: 'Epoxy plays the open trap (code 0x41) as trap_open, as the Lexy Labyrinth trap with its initially-open flag: open from the start, it closes on the first release of a brown button linked to it (or the first fall of its wire input) and then answers as a plain trap, wired or not.',
  arrow_block_cross: 'Epoxy plays the four-arrow directional block as arrow_block_cross, which any push moves and which chains into dirt, ice and arrow blocks. A cross block, like an ice block, that slides on ice or a force floor shoves the resting block it reaches along the slide (never a block that is itself sliding), as a CC2 sliding block moves with the push rule in the Lexy Labyrinth engine.',
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
  wired_flame_jet: 'A CC2 wired flame jet defines only a power-on reaction in the Lexy Labyrinth engine (on_power): it toggles once when its signal rises. Epoxy flips a wired jet on both edges of its signal, so it also flips when the signal falls.',
  // Epoxy: flame_jet_cc2_on/off.
  flame_jet: 'Epoxy plays the CC2 flame jet as flame_jet_cc2_on/off: a lit jet burns the actors standing in it (fire boots protect) and monsters may walk in. Known difference: the Lexy Labyrinth engine also burns blocks standing in a lit jet (on_stand); that Epoxy does so is not confirmed. A jet changes state only by an orange button (link made at import) or a wire.',
  // Epoxy: appearing_wall (the CC2 wall that turns solid when bumped).
  appearing_wall: 'Epoxy plays the CC2 appearing wall as appearing_wall: the player and a pushed block that bump it make it solid. Known difference: in the Lexy Labyrinth engine the wall is also revealed by ice, frame and glass blocks, boulders, rovers and rolling balls (can_reveal_walls); Epoxy lets no monster reveal it (appearing_wall_any, used by the CC3D import, does not match that set either), so a wall bumped only by such an actor stays hidden.',
  // Epoxy: button_orange_cc2 linked to the jet found by the diamond search.
  button_orange: 'Epoxy plays the orange button as button_orange_cc2, a button held by any actor, linked at import to the flame jet the diamond search of the Lexy Labyrinth engine finds around it: the jet toggles on press and again on release. The button is pressed by sliding entities and flying monsters (glider, fireball) standing on it, as by any other actor. Known difference: when two actors arrive or leave together the Lexy button toggles the jet once per actor, where Epoxy keeps one held level (the double toggle is not modelled).',
  // Epoxy: teleport_random.
  teleport_green: 'Epoxy plays the CC2 green teleport as the random pad (teleport_random): the destination and then the side are drawn from the walker generator of the level, and only the pads holding no actor are searched, as the Lexy Labyrinth emulation of the CC2 failure of a crowded pad (green_teleports_can_fail) does, so the generator and that failure are modelled. Known differences: a monster that stands on the green pad jumps at the start of its step (the other pads jump when the step ends), and a block keeps that step-start jump on every pad, where Lexy settles the jump when the step ends [unverified for the cases where the order matters].',
  // Epoxy: force_cycle.
  force_floor_random: 'Epoxy plays the CC2 random force floor as the turning force floor, one shared clockwise counter as in the Lexy Labyrinth engine (true randomness is a Microsoft-ruleset switch there). Two differences an author can see: the Epoxy sequence starts east where CC2 starts north, and Epoxy advances the counter on every arrival, including actors that ignore force floors (suction boots, forceproof), which do not advance it in CC2.',
  // Epoxy: hurl_stone.
  bowling_ball: 'Epoxy plays the bowling ball as the hurl stone item. On a CC2-engine level a player sets it down on his own cell and it becomes a rolling ball actor: it leaves the cell at once, rolls straight on at the walking pace, follows ice, force floors and tracks, takes keys, tools and score bonuses, and blows up killing the actor that blocks it (a helmet does not protect), as the Lexy Labyrinth rolling_ball does; on any other level it is thrown and flies as a shot. Known differences: the rule that an actor probing the cell of a ball dies with it (on_bumped) covers a monster probe and a player step only, a pushed block and a teleport exit probe never bump a ball.',
  // Epoxy: dynamite and dynamite_lit.
  dynamite: DYNAMITE_REASON,
  // Epoxy: boots_pull.
  hook: 'Epoxy plays the hook as its pull boots: the block directly behind the holder is pulled one step after a voluntary step, as the adhesive trait does in the Lexy Labyrinth engine. Edge rules differ: Epoxy does not pull a block off a matching plate, nor when the holder steps onto a teleporter, nor on forced slide steps.',
  // Epoxy: hint.
  // Epoxy: floor.
  letter: 'The glyph is lost; the cell plays as floor.',
  // Epoxy: transmogrifier.
  transmogrifier: 'Epoxy plays the transmogrifier as transmogrifier_cc2, which swaps actors by the CC2 pairs (the blob draws from the CC2 pool with a seeded generator). Known differences: a CC2 blue tank turns into a yellow tank, and Epoxy has a single tank; items (a helmet into an X-ray eye, boots into others) and glass or sokoban blocks are not swapped; a wire reaching it switches it on and off through the transmogrifier_cc2 / transmogrifier_cc2_off pair, as in the Lexy Labyrinth engine, where a wired one starts off [unverified for the pair table beyond the Lexy Labyrinth engine].',
  // Epoxy: teleport_red_cc2 (red), teleport_forward (yellow); the green pad is exact (teleport_random).
  teleport_red: `Epoxy plays the CC2 red pad as teleport_red_cc2: it tries the other red pads in ring order and leaves forward, right, back, then left of the facing of the mover, and a wire switches it on and off through its off twin (a wired pad starts off, as in the Lexy Labyrinth engine); an unpowered pad (teleport_red_cc2_off) sends the mover back out forward, as the Lexy red pad does for itself (teleportsToSelf). Known difference: the level validator, the pathfinder reachability and the block puzzle solver still read the off pad as plain floor, a small over-approximation. Not modelled: the player override of the red pad (Lexy teleport-soft: the player may steer off the destination pad), so a player leaving a red pad follows the Epoxy exit rule (on a classic level he lands on the destination pad and his input is held there until the forced exit step), and the order of the exit sides is [unverified] against CC2 itself.`,
  // Epoxy: teleport_forward (exit forward only, the pad is never its own destination).
  teleport_yellow: YELLOW_TELEPORT_REASON,
  // Epoxy: teleport_blue plus a relay pad for the wire.
  teleport_blue_wired: `${TELEPORT_REASON} A wired teleport also follows its wire, which the Epoxy relay pad only approximates.`,
  // Epoxy: slime.
  slime:
    'Epoxy plays CC2 slime as slime_cc2: it kills every monster but the ghost and the blob, a dirt or ice block pushed onto it clears it and survives, as in the Lexy Labyrinth engine. The Epoxy blob is not hurt by it and, once it has stood on slime, turns each plain, itemless floor cell it leaves into slime. Known differences: CC2 slimes the floor a blob steps onto only while the cell it came from is slime, so the chain stops as soon as the blob steps on anything else, where the Epoxy blob keeps spreading; the boulder (which also spreads slime in CC2) is not modelled.',
  // Epoxy: rail_* pieces and rail_switch_a/b.
  track: TRACK_REASON,
  track_junction: TRACK_REASON,
  // Epoxy: puppet (steered by the puppet control).
  yellow_tank: 'Epoxy plays the yellow tank as a puppet steered by the puppet control. Known difference: gravel bars the yellow tank in CC2 (monster_typical collision in the Lexy Labyrinth engine), where the Epoxy puppet crosses gravel; the step order also differs.',
  button_yellow: 'Epoxy plays the yellow button as the puppet control; only the player works it [unverified].',
  // Epoxy: signal_wire_floor, the floor a wire runs under on a level that holds a bolt.
  lightning_bolt: 'Epoxy powers the wire nets fed by the wire floor the player stands on while holding the bolt, sampled when the signals settle after a move. CC2 powers them only while the holder stands still (the charged trait in the Lexy Labyrinth engine): a holder sliding or walking over wire floor powers a net in Epoxy that CC2 leaves off. CC2 electrified floor, which the bolt also powers, is not handled.',
  // Epoxy: signal_counter_0 to signal_counter_9.
  counter_gate: 'Epoxy has counter gates with up and down inputs and overflow and underflow outputs, as the Lexy Labyrinth counter logic gate, but it settles its signals at the end of a move: when two inputs rise inside one move the final count can differ and an overflow or underflow pulse can be merged or lost, a different result from CC2 and not only a timing shift.',
  // Retired since pack format 15; kept so that a level stored by an earlier import keeps its verdict.
  [KEY_POPUP_WALL_BLOCKS]: 'Stored by an import made before pack format 15, which played the pop-up wall as a recessed wall that barred every block and monster, ice blocks, arrow blocks and rovers included, where CC2 lets them in. Importing the level again plays it as popup_wall_cc2 (see popup_wall).',
  // Epoxy: wired blue, yellow and green pads are played as plain pads; a red pad no wire reaches stays on.
  [KEY_WIRED_TELEPORT]: 'A wire is drawn on a blue, yellow or green teleport, or on a red pad that no wire network reaches. CC2 isolates wired blue pads into networks; Epoxy ignores the wire and keeps one level-wide group. A wired red pad that a network reaches is played by its wire (see teleport_red).',
  // Epoxy: a transmogrifier no wire network reaches stays on.
  [KEY_WIRED_TRANSMOGRIFIER]: 'A wire is drawn on a transmogrifier but no wire network reaches it, so Epoxy keeps it always on, where a wired CC2 transmogrifier starts off. A wired one that a network reaches is played by its wire (see transmogrifier).',
  // Epoxy: rail_junction, a switch no link reaches.
  [KEY_WIRED_TRACK_UNLINKED]: 'A wire touches a track switch but no supported source drives it (dangling, or fed only by gates Epoxy does not play): the Epoxy switch still moves when an actor leaves along the active track, where CC2 makes a wired switch wire-only.',
  // Epoxy: ghost.
  ghost:
    'Epoxy plays the ghost as a monster that walks through walls, doors, sockets and thin walls but not steel walls, clone machines or water, turning forward, left, right, back, and that ice, force floors, rails, traps, bombs, fire and pop-up walls do not affect. It picks up the keys (the red one excepted) and the tools it walks over, as the CC2 ghost does, and leaves chips, bonuses and the red key where they lie; it presses the buttons it crosses. Known differences: it keeps no inventory, so the boots it took do nothing for it (flippers do not let it cross water, which CC2 allows) and a taken item is simply gone; a clone machine stops the Epoxy ghost (deliberate, to keep clone templates well defined), where it passes in CC2. It does not transmogrify: the Epoxy teeth pair with the skitter, so timid teeth have no partner.',
  // Epoxy: mirror_chip and mirror_melinda.
  mirror_chip: `${MIRROR_REASON} Mirror Chip opens green doors and slides on ice.`,
  mirror_melinda: `${MIRROR_REASON} Mirror Melinda opens yellow doors, does not slide on ice and is stopped by dirt and gravel.`,
  // Epoxy: rover.
  rover:
    'Epoxy plays the rover as a monster that follows teeth, glider, bug, ball, timid teeth, fireball, paramecium and walker in turn, moving on after 32 step decisions. Known differences: Epoxy counts one decision per step and one per tick while the rover is blocked, where CC2 decides every tic it is not moving; the rover pushes one block at a time (no chain) and, as in CC2, enters exits, sockets once no chip is missing, dirt (packing it down), gravel and the keys thief, walks over every item and takes the keys (the red one excepted) and the tools. Remaining differences: it keeps no inventory (a taken item is simply gone and does nothing for it); CC2 also lets it onto clone machines, which Epoxy still bars to it, and onto pop-up walls (reported under their own key); it enters the thief_keys tile only, and a CC2 thief_tools tile imports as the shared thief id, which it cannot enter; the rover also takes bonus items in CC2 (only the ghost refuses them), where Epoxy leaves them on the floor. Fake walls bar the rover in CC2 as they do here.',
  // Epoxy: button_orange, a jet reached by several sources.
  [KEY_BUTTON_ORANGE_SHARED]: 'Two orange buttons, or an orange button and a wire, reach the same flame jet. CC2 toggles the jet once per event of each source; Epoxy ORs the sources into one signal and flips the jet on its edges, so overlapping presses merge (known approximation).',
  // Epoxy: ward, the item a helmet falls back to under a no-sign.
  [KEY_HELMET_NO_SIGN]: 'A no-sign over a helmet has no Epoxy sign for the helmet: the import places the ward under its sign, which absorbs the first monster contact where the helmet protects for good [unverified].',
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
