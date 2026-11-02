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
  | 'bot_multi';

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
