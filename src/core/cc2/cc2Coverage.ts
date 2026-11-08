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
/** The canopy flag of a thin wall: a modifier of the cell, not a terrain. */
export const KEY_CANOPY = 'canopy';
/** A code the importer's table does not know; it stands for the cc2_unknown placeholder. */
export const KEY_UNKNOWN = 'unknown';

const EXACT_REASON = 'Epoxy plays this element as CC2 does.';
const WIRED_REASON =
  'Wired levels are approximate until a replay of the official solution shows otherwise: Epoxy signals settle at the end of a move, where CC2 wires settle tick by tick.';
const RESERVED_REASON =
  'Epoxy does not play this element: the converter keeps it as a reserved placeholder (a wall for a terrain, inert for an item, motionless for an entity), so the level is not playable as imported.';
const TELEPORT_REASON =
  'The target and the exit order differ from CC2: the Epoxy player leaves facing first, then in a fixed order, where CC2 tries other sides [unverified].';
const GREEN_BUTTON_REASON =
  'Epoxy plays the green button as CC2 does for the toggle walls. CC2 also flips green chips and green bombs with it, which Epoxy does not have: a level that places them is lost through their own keys.';
const MECHANIC_REASON =
  'The mechanic exists in Epoxy and is mapped one to one. Timing fidelity is judged by the replay check of the importer, not by coverage.';
const PLACEHOLDER_REASON =
  'Epoxy has no equivalent: the converter keeps the cell as the cc2_unknown placeholder, so the level is not playable as imported.';
const EXTRA_CHIP_REASON =
  'The extra chip is picked up like a chip but is not counted toward the socket: Epoxy plays it as a chip and the socket requirement counts only the computer chips of the level.';
const STEEL_WALL_REASON =
  'Epoxy plays the steel wall as a plain wall, which is exact as long as nothing in the level destroys walls (see steel_wall_with_destroyer).';

/*
 * Keys are CC2 wiki names in snake_case. The comment on each group maps them to the Epoxy ids they play as.
 */

/**
 * Exact. Epoxy ids: floor, wall, ice and the four ice corners, water, fire, force_n/e/s/w, exit, dirt, gravel, socket,
 * hint, key_* and door_* (red, blue, yellow, green), chip, boots_water (flippers), boots_fire (fire boots), boots_ice
 * (cleats), boots_force (suction boots), invisible_wall, appearing_wall, blue_wall_real/fake, thin walls (cell edges),
 * swivel doors, toggle_wall_open/closed, button_green/blue/brown/red, trap, clone_machine, teleport_blue (unwired),
 * thief and thief_keys, bomb, stopwatch_bonus, stopwatch_penalty (time_penalty), score_10/100/1000/2x.
 */
const EXACT_KEYS: readonly string[] = [
  'floor', 'wall', 'ice', 'ice_corner', 'water', 'fire', 'force_floor', 'exit', 'dirt', 'gravel', 'socket', 'hint',
  'key_blue', 'key_red', 'key_yellow', 'key_green', 'door_blue', 'door_red', 'door_yellow', 'door_green',
  'chip', 'flippers', 'fire_boots', 'cleats', 'suction_boots', 'invisible_wall', 'appearing_wall',
  'blue_wall_real', 'blue_wall_fake', 'thin_wall', 'swivel_door', 'toggle_wall_open', 'toggle_wall_closed',
  'button_green', 'button_blue', 'button_brown', 'button_red', 'trap', 'clone_machine', 'custom_floor',
  'teleport_blue', 'thief_tools', 'thief_keys', 'bomb', 'time_bonus', 'time_penalty', 'steel_wall',
  'bonus_flag_10', 'bonus_flag_100', 'bonus_flag_1000', 'bonus_flag_2x', 'extra_chip'
];

/**
 * Monsters and blocks: the mechanic exists, so the key is exact. Epoxy ids: bug, fireball, glider, paramecium, tank,
 * pink_ball, teeth, walker, blob; dirt_block, ice_block, arrow_block_* (directional blocks).
 */
const MECHANIC_KEYS: readonly string[] = [
  'bug', 'fireball', 'glider', 'paramecium', 'tank', 'pink_ball', 'teeth', 'walker', 'blob',
  'dirt_block', 'ice_block', 'arrow_block'
];

/** Exact keys that carry their own reason instead of the generic one. */
const EXACT_REASONS: Readonly<Record<string, string>> = {
  button_green: GREEN_BUTTON_REASON,
  steel_wall: STEEL_WALL_REASON,
  extra_chip: EXTRA_CHIP_REASON
};

const APPROX_ENTRIES: Readonly<Record<string, string>> = {
  // Epoxy: button_orange.
  button_orange: 'Epoxy plays the orange button as its flame button; the CC2 button acts on the flame jets around it, where Epoxy toggles them all [unverified].',
  // Epoxy: flame_jet_on, flame_jet_off.
  flame_jet: 'Epoxy flame jets follow the Epoxy orange button, which toggles every jet where the CC2 one is local [unverified].',
  // Epoxy: force_cycle.
  force_floor_random: 'Epoxy plays the CC2 random force floor as the turning force floor: one shared counter instead of a random direction.',
  // Epoxy: hurl_stone.
  bowling_ball: 'Epoxy plays the bowling ball as a hurl stone: it flies the same way but its range and what it breaks differ [unverified].',
  // Epoxy: ward.
  helmet: 'Epoxy plays the helmet as a ward, which absorbs the first monster contact; the CC2 helmet protects against other things too [unverified]. The reserved id cc2_helmet stays available for a stricter import.',
  // Epoxy: charge.
  dynamite: 'Epoxy plays dynamite as a blast charge: the blast rules differ from CC2 [unverified].',
  // Epoxy: boots_speed.
  speed_boots: 'Epoxy plays the speed boots as its own speed boots; the speed gain and the ice and force floor behaviour may differ [unverified].',
  // Epoxy: boots_pull.
  hook: 'Epoxy plays the hook as its pull boots; what the CC2 hook pulls may differ [unverified].',
  // Epoxy: hint.
  letter: 'Epoxy plays a letter tile as a hint tile: the text is lost, only the place is kept.',
  // Epoxy: transmogrifier.
  transmogrifier: 'Epoxy swaps monsters of its own pairs, and a powered CC2 transmogrifier follows its wire where the Epoxy one is always on [unverified].',
  // Epoxy: teleport_red, teleport_yellow, teleport_green.
  teleport_red: TELEPORT_REASON,
  teleport_yellow: TELEPORT_REASON,
  teleport_green: 'The CC2 green teleport picks a random destination, where the Epoxy one is deterministic [unverified].',
  // Epoxy: teleport_blue plus a relay pad for the wire.
  teleport_blue_wired: `${TELEPORT_REASON} A wired teleport also follows its wire, which the Epoxy relay pad only approximates.`,
  // Epoxy: slime.
  slime: 'Slime is close to the Epoxy equivalent, not identical [unverified].',
  // Epoxy: turtle.
  turtle: 'Turtle behaviour is close to the Epoxy equivalent, not identical [unverified].',
  // Epoxy: rail_* pieces and rail_switch_a/b.
  track: 'Epoxy rail pieces cover the plain CC2 track; switch and junction behaviour differ [unverified].',
  // Epoxy: puppet (steered by the puppet control).
  yellow_tank: 'Epoxy plays the yellow tank as a puppet steered by the puppet control; the step order differs [unverified].',
  button_yellow: 'Epoxy plays the yellow button as the puppet control; only the player works it [unverified].',
  // Epoxy: recessed_wall.
  popup_wall: 'Epoxy plays the pop-up wall as a recessed wall: the timing of the pop differs [unverified].',
  // Epoxy: boots_eye.
  secret_eye: 'Epoxy plays the secret eye as the eye boots, which reveal hidden walls; the CC2 reveal range may differ [unverified].',
  // Epoxy: wall.
  green_wall: 'Epoxy plays the solid green wall as a plain wall [unverified].',
  // Epoxy: blue_wall_fake.
  green_wall_fake: 'Epoxy plays the fake green wall as a fake blue wall [unverified].',
  // Epoxy: dirt_block.
  arrow_block_cross: 'A directional block with four arrows is played as a dirt block, which any push moves.',
  [KEY_WIRE]: WIRED_REASON,
  [KEY_WIRE_TUNNEL]: `${WIRED_REASON} Tunnels and crossings are kept as wire topology.`
};

const LOST_ENTRIES: Readonly<Record<string, string>> = {
  [KEY_MULTIPLE_PLAYERS]: 'Epoxy has one player: a level with several players keeps the first and loses the others.',
  [KEY_STEEL_WALL_DESTROYER]:
    'A steel wall resists what destroys plain walls in CC2 (dynamite, a time bomb); Epoxy has no wall that resists a blast, so the level is lost.',
  [KEY_CANOPY]:
    'A canopy is a flag on the thin wall of a cell (0x10), not a terrain: Epoxy has no canopy, so the flag is dropped and the cell keeps its real terrain.',
  wired_trap: 'A CC2 wire opens or closes this trap; Epoxy traps follow only the brown button, so the wire is dropped.',
  wired_flame_jet: 'A CC2 wire switches this flame jet; Epoxy flame jets follow only the orange button, so the wire is dropped.',
  arrow_block_locked: 'A directional block with no arrow cannot be pushed in CC2; Epoxy has no immovable block entity, so it is placed as a pushable dirt block.',
  bribe: PLACEHOLDER_REASON,
  no_sign: PLACEHOLDER_REASON,
  [KEY_UNKNOWN]: 'The importer met a code its table does not know; the cell is kept as the cc2_unknown placeholder.'
};

/** Reserved ids whose key is classified by a mapping above instead of being lost. */
const MAPPED_RESERVED_NAMES: readonly string[] = ['helmet', 'steel_wall', 'extra_chip'];

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
