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

import type { Direction } from '../types';
import type { Cc3dCell, Cc3dColor, Cc3dItem, Cc3dMob, Cc3dTerrain } from './model';

/**
 * Display ids: how a CC3D cell, item or mob is shown with an Epoxy id (the
 * usual CompiledLevel layers and the renderer use them). Ids that Epoxy
 * already has are reused; the others carry the CC3D_ID_PREFIX and live in
 * their own config file, never in tiles.json.
 */

const CC3D_ID_PREFIX = 'cc3d_';
const COLORS: readonly Cc3dColor[] = ['red', 'green', 'blue', 'yellow'];
const NON_GREEN_COLORS: readonly Cc3dColor[] = ['red', 'blue', 'yellow'];
const SIDE_ORDER: readonly Direction[] = ['N', 'E', 'S', 'W'];
/** Thin wall ids are spelled in N,E,S,W order, except the pair E+S which tiles.json spells "se". */
const THIN_WALL_SPELLING: Readonly<Record<string, string>> = { es: 'se' };

const FLOOR_ID = 'floor';
const THIN_WALL_PREFIX = 'thin_wall_';
const GREEN: Cc3dColor = 'green';

const SIMPLE_TERRAIN_IDS: Readonly<Record<string, string>> = {
  floor: FLOOR_ID,
  wall: 'wall',
  water: 'water',
  fire: 'fire',
  ice: 'ice',
  force_random: 'force_random',
  exit: 'exit',
  socket: 'socket',
  socket_red: `${CC3D_ID_PREFIX}socket_red`,
  slime: 'slime',
  turtle: 'turtle',
  dirt: 'dirt',
  gravel: 'gravel',
  sand: `${CC3D_ID_PREFIX}sand`,
  teleport_blue: 'teleport_blue',
  teleport_red: 'teleport_red',
  push_up_wall: 'recessed_wall',
  appearing_wall: 'appearing_wall',
  false_wall: 'blue_wall_fake',
  trap: 'trap',
  trap_control: 'button_brown',
  clone_machine: 'clone_machine',
  clone_switch: 'button_red',
  golem_control_blue: 'button_blue',
  golem_control_yellow: `${CC3D_ID_PREFIX}golem_control_yellow`,
  laser_controller: `${CC3D_ID_PREFIX}laser_controller`,
  bomb: 'bomb',
  gate_tools: 'thief',
  gate_keys: 'thief_keys'
};

const ITEM_IDS: Readonly<Record<string, string>> = {
  fish: 'chip',
  fish_extra: `${CC3D_ID_PREFIX}fish_extra`,
  orb_ice: 'boots_ice',
  orb_force: 'boots_force',
  orb_fire: 'boots_fire',
  orb_water: 'boots_water',
  orb_speed: 'stopwatch_bonus'
};

const MOB_IDS: Readonly<Record<string, string>> = {
  block_dirt: 'dirt_block',
  block_ice: 'ice_block',
  walker: 'walker',
  legs_green: `${CC3D_ID_PREFIX}legs_green`,
  legs_red: `${CC3D_ID_PREFIX}legs_red`,
  blinky: 'glider',
  baby_blinky: `${CC3D_ID_PREFIX}baby_blinky`,
  limpa: 'bug',
  limpy: 'paramecium',
  bouncer: 'pink_ball',
  omni: 'blob',
  screamer: 'fireball',
  baby_screamer: `${CC3D_ID_PREFIX}baby_screamer`,
  snappy: 'teeth',
  nibble: 'teeth',
  golem_blue: 'tank',
  golem_yellow: `${CC3D_ID_PREFIX}golem_yellow`,
  laser_shooter: `${CC3D_ID_PREFIX}laser_shooter`,
  bot_static: `${CC3D_ID_PREFIX}bot_static`,
  bot_cw: `${CC3D_ID_PREFIX}bot_cw`,
  bot_ccw: `${CC3D_ID_PREFIX}bot_ccw`,
  bot_multi: `${CC3D_ID_PREFIX}bot_multi`,
  shot: `${CC3D_ID_PREFIX}shot`
};

/** Mirror names a reflector can store, lowercased in the id. */
const REFLECTOR_MIRRORS: readonly string[] = ['lu', 'dl', 'ur', 'rd'];

/** Every new cc3d_ id the mapping can return. */
export const CC3D_DISPLAY_IDS: readonly string[] = [
  ...COLORS.map((c) => `${CC3D_ID_PREFIX}plate_${c}`),
  ...COLORS.flatMap((c) => [`${CC3D_ID_PREFIX}hold_door_${c}_open`, `${CC3D_ID_PREFIX}hold_door_${c}_closed`]),
  ...NON_GREEN_COLORS.flatMap((c) => [
    `${CC3D_ID_PREFIX}toggle_door_${c}_open`,
    `${CC3D_ID_PREFIX}toggle_door_${c}_closed`,
    `${CC3D_ID_PREFIX}toggle_control_${c}`
  ]),
  ...COLORS.map((c) => `${CC3D_ID_PREFIX}block_${c}`),
  ...REFLECTOR_MIRRORS.map((m) => `${CC3D_ID_PREFIX}reflector_${m}`),
  ...[...Object.values(SIMPLE_TERRAIN_IDS), ...Object.values(ITEM_IDS), ...Object.values(MOB_IDS)].filter((id) =>
    id.startsWith(CC3D_ID_PREFIX)
  )
];

function need<T>(value: T | undefined, what: string, kind: string): T {
  if (value === undefined) throw new Error(`CC3D display: ${kind} needs ${what}`);
  return value;
}

function openClosed(open: boolean | undefined): string {
  return open ? 'open' : 'closed';
}

function cornerId(terrain: Cc3dTerrain): string {
  const sides = need(terrain.corner, 'corner', terrain.kind);
  const ns = sides.includes('N') ? 'n' : 's';
  const ew = sides.includes('E') ? 'e' : 'w';
  return `ice_${ns}${ew}`;
}

function toggleDoorId(terrain: Cc3dTerrain): string {
  const color = need(terrain.color, 'color', terrain.kind);
  const state = openClosed(terrain.open);
  if (color === GREEN) return `toggle_wall_${state}`;
  return `${CC3D_ID_PREFIX}toggle_door_${color}_${state}`;
}

function toggleControlId(terrain: Cc3dTerrain): string {
  const color = need(terrain.color, 'color', terrain.kind);
  return color === GREEN ? 'button_green' : `${CC3D_ID_PREFIX}toggle_control_${color}`;
}

/** The id of one terrain entry, ignoring panels. */
function terrainId(terrain: Cc3dTerrain): string {
  switch (terrain.kind) {
    case 'ice_corner':
      return cornerId(terrain);
    case 'force':
      return `force_${need(terrain.dir, 'dir', terrain.kind).toLowerCase()}`;
    case 'door':
      return `door_${need(terrain.color, 'color', terrain.kind)}`;
    case 'toggle_door':
      return toggleDoorId(terrain);
    case 'toggle_control':
      return toggleControlId(terrain);
    case 'hold_door':
      return `${CC3D_ID_PREFIX}hold_door_${need(terrain.color, 'color', terrain.kind)}_${openClosed(terrain.open)}`;
    case 'plate':
      return `${CC3D_ID_PREFIX}plate_${need(terrain.color, 'color', terrain.kind)}`;
    default:
      return need(SIMPLE_TERRAIN_IDS[terrain.kind], 'a known kind', terrain.kind);
  }
}

function thinWallId(panels: readonly Direction[]): string {
  const sides = SIDE_ORDER.filter((d) => panels.includes(d))
    .map((d) => d.toLowerCase())
    .join('');
  return `${THIN_WALL_PREFIX}${THIN_WALL_SPELLING[sides] ?? sides}`;
}

/**
 * The id that shows a cell: its top terrain, or the thin wall of its panels
 * when that terrain is plain floor. Panels on any other terrain are not part of
 * this id: they still block, so the engine exposes them separately (getPanels)
 * and the renderer draws their bars over that terrain.
 */
export function displayTerrainId(cell: Cc3dCell): string {
  const top = cell.terrain[cell.terrain.length - 1];
  const id = terrainId(top);
  if (id === FLOOR_ID && cell.panels.length > 0) return thinWallId(cell.panels);
  return id;
}

/** True when the display id of the cell already shows its panels (plain floor: the thin wall id). */
export function displayShowsPanels(cell: Cc3dCell): boolean {
  return cell.panels.length > 0 && terrainId(cell.terrain[cell.terrain.length - 1]) === FLOOR_ID;
}

/** The id that shows the item of a cell, or null for none. */
export function displayItemId(item: Cc3dItem | null): string | null {
  if (!item) return null;
  if (item.kind === 'key') return `key_${need(item.color, 'color', item.kind)}`;
  return need(ITEM_IDS[item.kind], 'a known kind', item.kind);
}

/** The id that shows a mob. */
export function displayMobId(mob: Cc3dMob): string {
  if (mob.kind === 'block_color') return `${CC3D_ID_PREFIX}block_${need(mob.color, 'color', mob.kind)}`;
  if (mob.kind === 'reflector') return `${CC3D_ID_PREFIX}reflector_${need(mob.mirror, 'mirror', mob.kind).toLowerCase()}`;
  return need(MOB_IDS[mob.kind], 'a known kind', mob.kind);
}
