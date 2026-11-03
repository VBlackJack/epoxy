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

/**
 * The CC3D level model: the contract between the importer and the engine.
 * Plain JSON-serializable data only (no Set, Map or class), because imported
 * packs are persisted as JSON.
 */

export type Cc3dColor = 'red' | 'green' | 'blue' | 'yellow';

export type Cc3dTerrainKind =
  | 'floor'
  | 'wall'
  | 'water'
  | 'fire'
  | 'ice'
  | 'ice_corner'
  | 'force'
  | 'force_random'
  | 'exit'
  | 'socket'
  | 'socket_red'
  | 'slime'
  | 'turtle'
  | 'dirt'
  | 'gravel'
  | 'sand'
  | 'teleport_blue'
  | 'teleport_red'
  | 'push_up_wall'
  | 'appearing_wall'
  | 'false_wall'
  | 'door'
  | 'toggle_door'
  | 'toggle_control'
  | 'hold_door'
  | 'plate'
  | 'trap'
  | 'trap_control'
  | 'clone_machine'
  | 'clone_switch'
  | 'golem_control_blue'
  | 'golem_control_yellow'
  | 'laser_controller'
  | 'bomb'
  | 'gate_tools'
  | 'gate_keys';

export interface Cc3dTerrain {
  kind: Cc3dTerrainKind;
  /** On door, toggle_door, toggle_control, hold_door and plate. */
  color?: Cc3dColor;
  /** On force (push direction) and clone_machine (output direction). */
  dir?: Direction;
  /** On toggle_door: the initial state. */
  open?: boolean;
  /** On ice_corner: its two closed sides. */
  corner?: [Direction, Direction];
}

export type Cc3dItemKind = 'fish' | 'fish_extra' | 'key' | 'orb_ice' | 'orb_force' | 'orb_fire' | 'orb_water' | 'orb_speed';

export interface Cc3dItem {
  kind: Cc3dItemKind;
  /** On key. */
  color?: Cc3dColor;
}

/** The player is not a mob. */
export type Cc3dMobKind =
  | 'block_dirt'
  | 'block_ice'
  | 'block_color'
  | 'reflector'
  | 'walker'
  | 'legs_green'
  | 'legs_red'
  | 'blinky'
  | 'baby_blinky'
  | 'limpa'
  | 'limpy'
  | 'bouncer'
  | 'omni'
  | 'screamer'
  | 'baby_screamer'
  | 'snappy'
  | 'nibble'
  | 'golem_blue'
  | 'golem_yellow'
  | 'laser_shooter'
  | 'bot_static'
  | 'bot_cw'
  | 'bot_ccw'
  | 'bot_multi'
  /** Runtime only: a laser shot. Level files never hold one. */
  | 'shot';

export interface Cc3dMob {
  kind: Cc3dMobKind;
  x: number;
  y: number;
  dir: Direction;
  /** On block_color. */
  color?: Cc3dColor;
  /** On reflector: the two letters of its stored name, for example "LU". */
  mirror?: string;
}

export interface Cc3dCell {
  /** Stack, bottom first, top last, never empty. Index 0 is a floor-like kind. */
  terrain: Cc3dTerrain[];
  /** Blocked sides (thin walls), no duplicates, in the order N, E, S, W. */
  panels: Direction[];
  item: Cc3dItem | null;
}

export interface Cc3dLevel {
  width: number;
  height: number;
  /** Row-major: index = y * width + x. */
  cells: Cc3dCell[];
  /** Document order. A mob standing on a clone machine is that machine's template. */
  mobs: Cc3dMob[];
  /** Start cell and facing; the facing defaults to west when absent (stored levels). */
  player: { x: number; y: number; dir?: Direction };
  mapId?: string;
}

/** Class 1: kinds that can sit at the bottom of a cell's stack. */
export const CC3D_FLOOR_LIKE_KINDS: readonly Cc3dTerrainKind[] = [
  'floor',
  'water',
  'fire',
  'ice',
  'ice_corner',
  'force',
  'force_random',
  'exit',
  'slime',
  'turtle',
  'dirt',
  'gravel',
  'sand',
  'teleport_blue',
  'teleport_red'
];

/** Class 2: devices that sit above the floor-like kind and act on whoever enters. */
export const CC3D_DEVICE_KINDS: readonly Cc3dTerrainKind[] = [
  'bomb',
  'plate',
  'toggle_control',
  'trap',
  'trap_control',
  'clone_machine',
  'clone_switch',
  'golem_control_blue',
  'golem_control_yellow',
  'laser_controller',
  'gate_tools',
  'gate_keys'
];

/** Class 3: blockers, on top of the stack; they must be opened or removed first. */
export const CC3D_BLOCKER_KINDS: readonly Cc3dTerrainKind[] = [
  'wall',
  'door',
  'toggle_door',
  'hold_door',
  'socket',
  'socket_red',
  'push_up_wall',
  'appearing_wall',
  'false_wall'
];

/** Row-major index of a cell. */
export function cellIndex(level: Pick<Cc3dLevel, 'width'>, x: number, y: number): number {
  return y * level.width + x;
}

/** The cell at (x, y), or undefined when outside the grid. */
export function cellAt(level: Pick<Cc3dLevel, 'width' | 'height' | 'cells'>, x: number, y: number): Cc3dCell | undefined {
  if (!Number.isInteger(x) || !Number.isInteger(y)) return undefined;
  if (x < 0 || y < 0 || x >= level.width || y >= level.height) return undefined;
  return level.cells[cellIndex(level, x, y)];
}

/** The terrain that acts first: the top of the stack. */
export function topTerrain(cell: Cc3dCell): Cc3dTerrain {
  return cell.terrain[cell.terrain.length - 1];
}

/** Stacking class of a terrain kind. */
export const CC3D_CLASS_FLOOR = 1;
export const CC3D_CLASS_DEVICE = 2;
export const CC3D_CLASS_BLOCKER = 3;
export type Cc3dTerrainClass = typeof CC3D_CLASS_FLOOR | typeof CC3D_CLASS_DEVICE | typeof CC3D_CLASS_BLOCKER;

/** Stacking class of a terrain kind (1 floor-like, 2 device, 3 blocker), or undefined for a kind the model does not know. */
export function terrainClass(kind: string): Cc3dTerrainClass | undefined {
  if ((CC3D_FLOOR_LIKE_KINDS as readonly string[]).includes(kind)) return CC3D_CLASS_FLOOR;
  if ((CC3D_DEVICE_KINDS as readonly string[]).includes(kind)) return CC3D_CLASS_DEVICE;
  if ((CC3D_BLOCKER_KINDS as readonly string[]).includes(kind)) return CC3D_CLASS_BLOCKER;
  return undefined;
}

const PLAIN_FLOOR: Cc3dTerrainKind = 'floor';

function classOf(terrain: Cc3dTerrain): Cc3dTerrainClass {
  const cls = terrainClass(terrain.kind);
  if (cls === undefined) throw new Error(`CC3D: no stacking class for ${terrain.kind}`);
  return cls;
}

/**
 * Input positions of the first two floor-like layers that are not plain floor: a cell can only have one real
 * base, so the importer refuses such a cell. Null when there is no conflict.
 */
export function baseConflict(layers: readonly Cc3dTerrain[]): [number, number] | null {
  const found: number[] = [];
  layers.forEach((layer, index) => {
    if (classOf(layer) === CC3D_CLASS_FLOOR && layer.kind !== PLAIN_FLOOR) found.push(index);
  });
  return found.length > 1 ? [found[0], found[1]] : null;
}

/**
 * Builds the terrain stack of a cell from loose layers, in any order: the base is the floor-like layer that is
 * not plain floor (the last one when several, see baseConflict), else plain floor; devices follow, then
 * blockers, each class in input order. Never empty. Throws on a kind the model does not know.
 */
export function normalizeCell(layers: readonly Cc3dTerrain[]): Cc3dTerrain[] {
  const bases = layers.filter((layer) => classOf(layer) === CC3D_CLASS_FLOOR && layer.kind !== PLAIN_FLOOR);
  const base: Cc3dTerrain = bases.length > 0 ? bases[bases.length - 1] : { kind: PLAIN_FLOOR };
  const above = layers.filter((layer) => classOf(layer) !== CC3D_CLASS_FLOOR);
  // Array.prototype.sort is stable, so input order holds inside a class.
  above.sort((a, b) => classOf(a) - classOf(b));
  return [base, ...above];
}

/**
 * The stack after placing one layer: a floor-like layer replaces the base, a device or blocker replaces the
 * layer of the same kind when there is one, else it is inserted in class order.
 */
export function placeTerrain(stack: readonly Cc3dTerrain[], terrain: Cc3dTerrain): Cc3dTerrain[] {
  if (classOf(terrain) === CC3D_CLASS_FLOOR) return normalizeCell([...stack.filter((l) => classOf(l) !== CC3D_CLASS_FLOOR), terrain]);
  const sameKind = stack.findIndex((layer) => layer.kind === terrain.kind);
  if (sameKind >= 0) return stack.map((layer, index) => (index === sameKind ? terrain : layer));
  return normalizeCell([...stack, terrain]);
}
