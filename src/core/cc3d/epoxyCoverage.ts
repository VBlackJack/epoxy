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

import { CC3D_CLASS_FLOOR, CC3D_COLORS, terrainClass, topTerrain } from './model';
import type { Cc3dCell, Cc3dColor, Cc3dLevel, Cc3dTerrain } from './model';

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
export const KEY_PANELS_ON_NONFLOOR = 'panels_on_nonfloor';

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

const EXACT_KEYS: readonly string[] = [
  'floor', 'wall', 'fire', 'ice', 'ice_corner', 'force', 'exit', 'gravel', 'push_up_wall', 'false_wall', 'door',
  'fish', 'key', 'toggle_door_green', 'toggle_control_green'
];

const APPROX_ENTRIES: Record<string, string> = {
  water: 'The ice block and the colour block behave differently on water.',
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
  reflector: 'Reflector bounce rules differ from CC3D.',
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
  golem_blue: 'Golem movement is close to CC3D, not identical.'
};

const LOST_ENTRIES: Record<string, string> = {
  socket_red: 'Epoxy has no red socket.',
  sand: 'Epoxy has no sand.',
  golem_control_yellow: 'Epoxy has no yellow golem control.',
  laser_controller: 'Epoxy has no laser controller.',
  fish_extra: 'Epoxy has no extra fish.',
  orb_speed: 'Epoxy has no speed orb.',
  nibble: 'Epoxy has no nibble monster.',
  golem_yellow: 'Epoxy has no yellow golem.',
  laser_shooter: 'Epoxy has no laser shooter.',
  bot_static: 'Epoxy has no static bot.',
  bot_cw: 'Epoxy has no clockwise bot.',
  bot_ccw: 'Epoxy has no counter-clockwise bot.',
  bot_multi: 'Epoxy has no multi bot.',
  [KEY_STACKED_TERRAIN]: 'Epoxy holds one terrain per cell, so a stack of devices or blockers is flattened.',
  [KEY_PANELS_ON_NONFLOOR]: 'Epoxy only keeps panels on plain floor cells.'
};

const LOST_COLORED_GROUPS: ReadonlyArray<{ prefix: string; colors: readonly Cc3dColor[]; reason: string }> = [
  { prefix: 'hold_door', colors: CC3D_COLORS, reason: 'Epoxy has no door held open by a pressure plate.' },
  { prefix: 'plate', colors: CC3D_COLORS, reason: 'Epoxy has no pressure plate.' },
  { prefix: 'toggle_door', colors: ['red', 'blue', 'yellow'], reason: 'Epoxy only has the green toggle door.' },
  { prefix: 'toggle_control', colors: ['red', 'blue', 'yellow'], reason: 'Epoxy only has the green toggle control.' },
  { prefix: COLOR_MOB_KIND, colors: CC3D_COLORS, reason: 'Epoxy has no colour block.' }
];

function buildTable(): Record<string, CoverageEntry> {
  const table: Record<string, CoverageEntry> = {};
  for (const key of EXACT_KEYS) table[key] = entry('exact', EXACT_REASON);
  for (const [key, reason] of Object.entries(APPROX_ENTRIES)) table[key] = entry('approx', reason);
  for (const [key, reason] of Object.entries(LOST_ENTRIES)) table[key] = entry('lost', reason);
  for (const group of LOST_COLORED_GROUPS) {
    for (const color of group.colors) table[`${group.prefix}${KEY_SEPARATOR}${color}`] = entry('lost', group.reason);
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

/** The devices and blockers of a cell, bottom first: everything but the floor-like base. */
function aboveBase(cell: Cc3dCell): Cc3dTerrain[] {
  return cell.terrain.filter((layer) => terrainClass(layer.kind) !== CC3D_CLASS_FLOOR);
}

/** The element keys of a level, structural ones included. */
export function elementKeys(level: Cc3dLevel): Set<string> {
  const keys = new Set<string>();
  for (const cell of level.cells) {
    for (const layer of cell.terrain) keys.add(terrainKey(layer));
    if (cell.item) keys.add(cell.item.kind);
    if (aboveBase(cell).length >= MIN_STACKED_ENTRIES) keys.add(KEY_STACKED_TERRAIN);
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

/** Counts, over cells with two or more devices or blockers, the stack "kindA+kindB" bottom to top, with colours. */
export function stackedPairs(level: Cc3dLevel): Map<string, number> {
  const counts = new Map<string, number>();
  for (const cell of level.cells) {
    const above = aboveBase(cell);
    if (above.length < MIN_STACKED_ENTRIES) continue;
    const key = above.map(terrainKey).join(STACK_SEPARATOR);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}
