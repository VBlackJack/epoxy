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

import { CC3D_COLORS, topTerrain } from './model';
import type { Cc3dCell, Cc3dColor, Cc3dLevel, Cc3dTerrain, Cc3dTerrainKind } from './model';

/**
 * Coverage of the CC3D elements by the native Epoxy engine: for one level, which elements Epoxy plays
 * exactly, approximately, or loses. The measuring stick that ranks engine work by the number of maps won.
 */

export type CoverageLevel = 'exact' | 'approx' | 'lost';

export interface CoverageEntry {
  level: CoverageLevel;
  reason: string;
}

export interface LevelCoverage {
  /** The worst level present in the level. */
  verdict: CoverageLevel;
  lost: string[];
  approx: string[];
}

/** Structural keys: properties of a cell rather than of one element. */
export const KEY_STACKED_TERRAIN = 'stacked_terrain';
export const KEY_STACKED_RUNTIME = 'stacked_runtime';
export const KEY_PANELS_ON_NONFLOOR = 'panels_on_nonfloor';
/** The red socket, as the key of one whose layer below is not plain floor (the plain one keeps its kind as key). */
export const KEY_SOCKET_RED = 'socket_red';
export const KEY_SOCKET_RED_STACKED = 'socket_red_stacked';

const KEY_SEPARATOR = '_';
const STACK_SEPARATOR = '+';
const MIN_STACKED_ENTRIES = 2;
const PLAIN_FLOOR = 'floor';
/** Terrain kinds whose colour is part of the key. */
const COLOR_KEY_KINDS: readonly string[] = ['plate', 'hold_door', 'toggle_door', 'toggle_control'];
const COLOR_MOB_KIND = 'block_color';

function entry(level: CoverageLevel, reason: string): CoverageEntry {
  return { level, reason };
}

const EXACT_REASON = 'Epoxy plays this element as CC3D does.';
const MONSTER_REASON = 'Monster movement is close to CC3D, not identical.';
const ORB_REASON = 'The orb effect is close to the Epoxy equivalent, not identical.';
const PLATE_REASON = 'Hold doors settle at the end of each move or tick, where CC3D reacts at once.';
const COLOR_BLOCK_REASON = 'Colour block pushing rules differ slightly from CC3D, and a floating block cannot be pushed again.';
const SAND_REASON = 'Epoxy plays CC3D sand as its gravel: the player and every block may enter, monsters may not.';
const SOCKET_RED_REASON = 'Epoxy plays the CC3D red socket as its socket: the player only, open at no chips left, floor once entered.';
const SOCKET_RED_STACKED_REASON = 'CC3D re-plans a red socket against the layer below it, which Epoxy does not model [unverified].';
const FISH_EXTRA_REASON = 'Epoxy plays the extra fish as a chip, and the chips needed count the plain fish only, as CC3D does [unverified].';
const GRAVEL_REASON = 'Epoxy gravel admits mirrors, where CC3D gravel refuses reflectors.';
const BOT_REASON =
  'Epoxy plays a bot as a turret: the beam and its turn period are close to CC3D, with a beam length and a period that are guesses, and Epoxy makes no turn at the first step.';
const GOLEM_YELLOW_REASON =
  'Epoxy plays the yellow golem as a puppet that steps at once when the player ends a move on the control, where CC3D walks it a step; it enters Epoxy gravel, which stands for both CC3D sand (the golem enters it) and CC3D gravel (the golem is stopped by it); entry order along a line of puppets differs [unverified].';
const GOLEM_CONTROL_YELLOW_REASON =
  'Epoxy plays the yellow golem control as the puppet control: only the player works it, and a puppet or block entering it does nothing, as in CC3D; the order of the steps differs [unverified].';
const LASER_CONTROLLER_REASON =
  'Epoxy plays the laser controller as its shot trigger, linked to the shooters it fires (the nearest shooter in CC3D); any mob works it in CC3D, where Epoxy lets whatever steps on it work it, and a covered controller keeps working in both [unverified].';
const LASER_SHOOTER_REASON =
  'Epoxy plays the shooter as a shot launcher: a wall-like terrain tile that fires the way it faces, so the terrain under the shooter is flattened; a shot crosses cells at the CC3D pace but its opacity follows Epoxy laser transparency, and the exit differs; the order of the first cell hit differs [unverified].';
const NIBBLE_REASON =
  'Epoxy plays a nibble as a skitter: it steps away from the player on the axis of the greater distance, with its rest folded into a fixed step interval [unverified].';
const HOLD_DOOR_REASON = 'Epoxy plays the hold door as CC3D does: all plates of its colour, occupant may leave, nobody may enter.';

const EXACT_KEYS: readonly string[] = [
  'floor', 'wall', 'fire', 'ice', 'ice_corner', 'force', 'exit', 'sand', 'fish_extra', KEY_SOCKET_RED, 'push_up_wall', 'false_wall', 'door',
  'fish', 'key', 'toggle_door_green', 'toggle_control_green', 'toggle_door_red', 'toggle_door_blue',
  'toggle_door_yellow', 'toggle_control_red', 'toggle_control_blue', 'toggle_control_yellow',
  // Cell edges carry the panels of any terrain, read from both sides as CC3D does.
  KEY_PANELS_ON_NONFLOOR,
  // A stack Epoxy holds exactly: see classifyStack.
  KEY_STACKED_TERRAIN
];

/** Exact keys that carry their own reason instead of the generic one. */
const EXACT_REASONS: Readonly<Record<string, string>> = {
  sand: SAND_REASON,
  fish_extra: FISH_EXTRA_REASON,
  [KEY_SOCKET_RED]: SOCKET_RED_REASON
};

const APPROX_ENTRIES: Record<string, string> = {
  gravel: GRAVEL_REASON,
  [KEY_SOCKET_RED_STACKED]: SOCKET_RED_STACKED_REASON,
  orb_speed: 'Epoxy slow-time boots slow the monsters only, where the CC3D speed orb also slows the blocks monsters push.',
  water: 'The ice block behaves differently on water, and a colour block floats as a walkable tile that cannot be pushed again.',
  force_random: 'Epoxy draws the direction at random instead of a fixed cycle.',
  socket: 'Epoxy sockets only react to the player.',
  slime: 'Slime is close to the Epoxy equivalent, not identical.',
  turtle: 'Turtle behaviour is close to the Epoxy equivalent, not identical.',
  dirt: 'Dirt is close to the Epoxy equivalent, not identical.',
  teleport_blue: 'Teleport target choice differs from CC3D.',
  teleport_red: 'Teleport target choice differs from CC3D.',
  appearing_wall: 'Appearing wall timing differs from CC3D.',
  trap: 'Trap release rules differ from CC3D.',
  trap_control: 'Trap control linking differs from CC3D.',
  clone_machine: 'Clone machine output rules differ from CC3D.',
  clone_switch: 'Clone switch linking differs from CC3D.',
  golem_control_blue: 'Golem control is close to the Epoxy equivalent, not identical.',
  bomb: 'Bomb blast rules differ from CC3D.',
  gate_tools: 'Tool gate rules differ from CC3D.',
  gate_keys: 'Key gate rules differ from CC3D.',
  orb_ice: ORB_REASON,
  orb_force: ORB_REASON,
  orb_fire: ORB_REASON,
  orb_water: ORB_REASON,
  block_dirt: 'Dirt block pushing rules differ slightly from CC3D.',
  block_ice: 'Ice block pushing and sliding rules differ slightly from CC3D.',
  plate_red: PLATE_REASON,
  plate_green: PLATE_REASON,
  plate_blue: PLATE_REASON,
  plate_yellow: PLATE_REASON,
  block_color_red: COLOR_BLOCK_REASON,
  block_color_green: COLOR_BLOCK_REASON,
  block_color_blue: COLOR_BLOCK_REASON,
  block_color_yellow: COLOR_BLOCK_REASON,
  reflector:
    'Epoxy plays a reflector as a one-sided mirror that turns shots and beams from its two reflecting faces and destroys the shot from behind (the converter maps it by its stored name); the existing Epoxy mirrors are two-faced; bounce timing differs from CC3D.',
  walker: MONSTER_REASON,
  legs_green: MONSTER_REASON,
  legs_red: MONSTER_REASON,
  blinky: MONSTER_REASON,
  baby_blinky: MONSTER_REASON,
  limpa: MONSTER_REASON,
  limpy: MONSTER_REASON,
  bouncer: MONSTER_REASON,
  omni: MONSTER_REASON,
  screamer: MONSTER_REASON,
  baby_screamer: MONSTER_REASON,
  snappy: MONSTER_REASON,
  bot_static: BOT_REASON,
  bot_cw: BOT_REASON,
  bot_ccw: BOT_REASON,
  bot_multi: BOT_REASON,
  golem_yellow: GOLEM_YELLOW_REASON,
  golem_control_yellow: GOLEM_CONTROL_YELLOW_REASON,
  nibble: NIBBLE_REASON,
  golem_blue: 'Golem movement is close to CC3D, not identical.',
  laser_controller: LASER_CONTROLLER_REASON,
  laser_shooter: LASER_SHOOTER_REASON
};

const LOST_ENTRIES: Record<string, string> = {
  [KEY_STACKED_RUNTIME]:
    'The stack has a layer that acts while covered, or more layers than a removable top and the one it hides, which Epoxy flattens.'
};

/** Coloured elements Epoxy plays as CC3D does, one entry per colour. */
const EXACT_COLORED_GROUPS: ReadonlyArray<{ prefix: string; colors: readonly Cc3dColor[]; reason: string }> = [
  { prefix: 'hold_door', colors: CC3D_COLORS, reason: HOLD_DOOR_REASON }
];

function buildTable(): Record<string, CoverageEntry> {
  const table: Record<string, CoverageEntry> = {};
  for (const key of EXACT_KEYS) table[key] = entry('exact', EXACT_REASONS[key] ?? EXACT_REASON);
  for (const [key, reason] of Object.entries(APPROX_ENTRIES)) table[key] = entry('approx', reason);
  for (const [key, reason] of Object.entries(LOST_ENTRIES)) table[key] = entry('lost', reason);
  for (const group of EXACT_COLORED_GROUPS) {
    for (const color of group.colors) table[`${group.prefix}${KEY_SEPARATOR}${color}`] = entry('exact', group.reason);
  }
  return table;
}

/** Coverage of every element key. */
export const EPOXY_COVERAGE: Readonly<Record<string, CoverageEntry>> = Object.freeze(buildTable());

function withColor(kind: string, color: Cc3dColor | undefined): string {
  if (color === undefined) throw new Error(`CC3D coverage: ${kind} has no colour`);
  return `${kind}${KEY_SEPARATOR}${color}`;
}

function terrainKey(terrain: Cc3dTerrain): string {
  return COLOR_KEY_KINDS.includes(terrain.kind) ? withColor(terrain.kind, terrain.color) : terrain.kind;
}

/**
 * The entries of a cell that are not plain floor, bottom first. A cell stack is [base, devices..., blockers...]
 * (see normalizeCell in model.ts), and the base is plain floor unless the cell is water, fire, ice and so on.
 * Epoxy holds one terrain per cell, so a cell is "stacked" exactly when this list has two or more entries:
 * water+trap, ice+bomb and fire+wall count, [floor, trap] does not (one entry), and [floor, bomb, door] does.
 */
function nonFloorLayers(cell: Cc3dCell): Cc3dTerrain[] {
  return cell.terrain.filter((layer) => layer.kind !== PLAIN_FLOOR);
}

/** Key of one layer of a cell: its kind and colour, except that a red socket stacked on anything but plain floor is its own key. */
function coverageKeyOf(cell: Cc3dCell, layer: Cc3dTerrain, index: number): string {
  if (layer.kind === KEY_SOCKET_RED && cell.terrain[index - 1]?.kind !== PLAIN_FLOOR) return KEY_SOCKET_RED_STACKED;
  return terrainKey(layer);
}

/** Tops the player removes by walking into them: what they hide shows once they are gone (Epoxy underlays). */
const REMOVABLE_TOP_KINDS: readonly Cc3dTerrainKind[] = ['door', 'socket', 'false_wall'];
/** Tops that stay as they are or turn into another blocker: whatever is under them is never seen. */
const PERMANENT_TOP_KINDS: readonly Cc3dTerrainKind[] = ['wall', 'push_up_wall', 'appearing_wall', 'toggle_door', 'hold_door'];
/**
 * What Epoxy can hide under a removable top and play exactly: ground that only acts when someone stands
 * on it, a wall, or a toggle control (inert until revealed). Dirt is left out (it is a removable top
 * itself), and so are the devices that act while covered (plates, hold doors, toggle doors, traps...).
 */
const UNDER_KINDS: readonly Cc3dTerrainKind[] = [
  'water', 'fire', 'ice', 'ice_corner', 'force', 'force_random', 'exit', 'slime', 'turtle', 'gravel', 'sand',
  'teleport_blue', 'teleport_red', 'wall', 'toggle_control'
];
/** Layers that act on the cell, or on a trap, a clone machine or a door, even while another layer covers them. */
const LIVE_WHILE_COVERED_KINDS: readonly Cc3dTerrainKind[] = [
  'plate', 'trap', 'trap_control', 'clone_machine', 'clone_switch', 'golem_control_blue', 'golem_control_yellow',
  'laser_controller', 'gate_tools', 'gate_keys'
];
const BOMB_KIND: Cc3dTerrainKind = 'bomb';

/** How Epoxy holds the terrain stack of one cell. */
export type StackKind = 'plain' | 'flattened' | 'underlay' | 'runtime';

/**
 * Classifies the terrain stack of a cell. A stack is stacked when two or more entries are not plain floor
 * (see nonFloorLayers). A bomb layer becomes the cell's item when the item slot is free. What is left is
 * played exactly when it is
 *  - under a top that is never removed, with nothing live under it: the covered layers are inert, so they
 *    are dropped ('flattened');
 *  - a removable top over exactly one layer Epoxy can hide ('underlay').
 * Anything else ('runtime') needs a layer that acts while covered, or a deeper stack, and is lost.
 */
export function classifyStack(cell: Cc3dCell): StackKind {
  let layers = nonFloorLayers(cell);
  if (layers.length < MIN_STACKED_ENTRIES) return 'plain';
  if (cell.item === null && layers.filter((layer) => layer.kind === BOMB_KIND).length === 1) {
    layers = layers.filter((layer) => layer.kind !== BOMB_KIND);
    if (layers.length < MIN_STACKED_ENTRIES) return 'flattened';
  }
  const top = layers[layers.length - 1];
  const below = layers.slice(0, -1);
  if (PERMANENT_TOP_KINDS.includes(top.kind)) {
    return below.some((layer) => LIVE_WHILE_COVERED_KINDS.includes(layer.kind)) ? 'runtime' : 'flattened';
  }
  if (REMOVABLE_TOP_KINDS.includes(top.kind) && below.length === 1 && UNDER_KINDS.includes(below[0].kind)) return 'underlay';
  return 'runtime';
}

/** The element keys of a level, structural ones included. */
export function elementKeys(level: Cc3dLevel): Set<string> {
  const keys = new Set<string>();
  for (const cell of level.cells) {
    cell.terrain.forEach((layer, index) => keys.add(coverageKeyOf(cell, layer, index)));
    if (cell.item) keys.add(cell.item.kind);
    const stack = classifyStack(cell);
    if (stack === 'flattened' || stack === 'underlay') keys.add(KEY_STACKED_TERRAIN);
    if (stack === 'runtime') keys.add(KEY_STACKED_RUNTIME);
    if (cell.panels.length > 0 && topTerrain(cell).kind !== PLAIN_FLOOR) keys.add(KEY_PANELS_ON_NONFLOOR);
  }
  for (const mob of level.mobs) keys.add(mob.kind === COLOR_MOB_KIND ? withColor(mob.kind, mob.color) : mob.kind);
  return keys;
}

/** Classifies a level; throws on a key the table does not know. */
export function classifyLevel(level: Cc3dLevel): LevelCoverage {
  const lostKeys: string[] = [];
  const approxKeys: string[] = [];
  for (const key of [...elementKeys(level)].sort()) {
    const found = EPOXY_COVERAGE[key];
    if (!found) throw new Error(`CC3D coverage: no entry for ${key}`);
    if (found.level === 'lost') lostKeys.push(key);
    else if (found.level === 'approx') approxKeys.push(key);
  }
  const verdict: CoverageLevel = lostKeys.length > 0 ? 'lost' : approxKeys.length > 0 ? 'approx' : 'exact';
  return { verdict, lost: lostKeys, approx: approxKeys };
}

/** Counts, over stacked cells (see nonFloorLayers), the stack "base+device+blocker" bottom to top, base kind included, with colours. */
export function stackedPairs(level: Cc3dLevel): Map<string, number> {
  const counts = new Map<string, number>();
  for (const cell of level.cells) {
    const above = nonFloorLayers(cell);
    if (above.length < MIN_STACKED_ENTRIES) continue;
    const key = above.map(terrainKey).join(STACK_SEPARATOR);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}
