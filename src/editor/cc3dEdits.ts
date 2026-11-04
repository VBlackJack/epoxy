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

import { PLAYER_START_FACING } from '../core/cc3d/cc3dConstants';
import { REFLECTING_FACES } from '../core/cc3d/cc3dLasers';
import {
  CC3D_COLORS,
  CC3D_ITEM_KINDS,
  CC3D_MOB_KINDS,
  type Cc3dCell,
  type Cc3dItem,
  type Cc3dLevel,
  type Cc3dMob,
  type Cc3dTerrain,
  cellAt,
  cellIndex,
  placeTerrain,
  terrainClass
} from '../core/cc3d/model';
import { ORDERED_DIRECTIONS } from '../config/constants';
import type { Direction } from '../core/types';
import { canonicalJson } from './canonicalJson';

/**
 * Pure edits of a CC3D level, the single source of truth of a CC3D document. Cells and mobs are immutable:
 * an edit builds a new level that shares every cell it did not touch. An edit that changes nothing, or that
 * the validator would reject (outside the grid, a missing colour, a second mob on a cell), returns the very
 * same level, so the caller can tell by reference that there is no history step to record.
 */

/** The cell of a plain floor with nothing on it. */
export function emptyCell(): Cc3dCell {
  return { terrain: [{ kind: 'floor' }], panels: [], item: null };
}

const COLORED_TERRAIN: readonly string[] = ['door', 'toggle_door', 'toggle_control', 'hold_door', 'plate'];
const CORNER_SIDE_COUNT = 2;
const VERTICAL_SIDES: readonly Direction[] = ['N', 'S'];
const HORIZONTAL_SIDES: readonly Direction[] = ['E', 'W'];
const MIRROR_NAMES: readonly string[] = Object.keys(REFLECTING_FACES);

export function isColor(value: unknown): boolean {
  return typeof value === 'string' && (CC3D_COLORS as readonly string[]).includes(value);
}

export function isDirection(value: unknown): value is Direction {
  return typeof value === 'string' && (ORDERED_DIRECTIONS as readonly string[]).includes(value);
}

/** One closed side on each axis, as the validator requires. */
function isCorner(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length === CORNER_SIDE_COUNT &&
    value.every(isDirection) &&
    value.some((side) => VERTICAL_SIDES.includes(side)) &&
    value.some((side) => HORIZONTAL_SIDES.includes(side))
  );
}

/**
 * The two closed sides of each ice corner, in the order the XML decoder writes them (SW, NW, NE, then ES:
 * the decoder lists E before S). A decoded layer and a brushed one must be equal, so every corner is
 * rewritten to this form.
 */
const CANONICAL_CORNERS: ReadonlyArray<readonly [Direction, Direction]> = [
  ['S', 'W'],
  ['N', 'W'],
  ['N', 'E'],
  ['E', 'S']
];

function canonicalCorner(corner: readonly [Direction, Direction]): [Direction, Direction] {
  const found = CANONICAL_CORNERS.find((pair) => corner.includes(pair[0]) && corner.includes(pair[1]));
  const pair = found ?? corner;
  return [pair[0], pair[1]];
}

/**
 * The layer cleaned to the attributes its kind uses, in the canonical form the decoder produces (a toggle
 * door always carries its `open` state, an ice corner its sides in decoder order), or null when the kind is
 * unknown or an attribute the validator requires is missing or invalid.
 */
export function normalizeLayer(layer: Cc3dTerrain): Cc3dTerrain | null {
  if (terrainClass(layer.kind) === undefined) return null;
  const out: Cc3dTerrain = { kind: layer.kind };
  if (COLORED_TERRAIN.includes(layer.kind)) {
    if (!isColor(layer.color)) return null;
    out.color = layer.color;
  }
  if (layer.kind === 'force') {
    if (!isDirection(layer.dir)) return null;
    out.dir = layer.dir;
  }
  if (layer.kind === 'clone_machine' && layer.dir !== undefined) {
    if (!isDirection(layer.dir)) return null;
    out.dir = layer.dir;
  }
  if (layer.kind === 'toggle_door') out.open = layer.open ?? false;
  else if (layer.kind === 'hold_door' && layer.open !== undefined) out.open = layer.open;
  if (layer.kind === 'ice_corner') {
    if (!isCorner(layer.corner)) return null;
    out.corner = canonicalCorner(layer.corner as [Direction, Direction]);
  }
  return out;
}

export function inside(level: Cc3dLevel, x: number, y: number): boolean {
  return cellAt(level, x, y) !== undefined;
}

/** A level with one cell replaced; the same level when the new cell equals the old one. */
export function withCell(level: Cc3dLevel, x: number, y: number, cell: Cc3dCell): Cc3dLevel {
  const index = cellIndex(level, x, y);
  if (canonicalJson(level.cells[index]) === canonicalJson(cell)) return level;
  const cells = level.cells.slice();
  cells[index] = cell;
  return { ...level, cells };
}

/**
 * Places one terrain layer on a cell. A floor-like kind replaces the base, a device or blocker replaces the
 * layer of the same kind or is inserted in class order. Refused (same level) when a required attribute such
 * as the colour of a door is missing.
 */
export function placeLayer(level: Cc3dLevel, x: number, y: number, terrain: Cc3dTerrain): Cc3dLevel {
  const cell = cellAt(level, x, y);
  const layer = normalizeLayer(terrain);
  if (!cell || !layer) return level;
  return withCell(level, x, y, { ...cell, terrain: placeTerrain(cell.terrain, layer) });
}

/**
 * Removes the top layer of a cell. A cell with only its base falls back to plain floor; a plain floor is left
 * alone (the item and the thin walls stay: they have their own erasers).
 */
export function eraseTop(level: Cc3dLevel, x: number, y: number): Cc3dLevel {
  const cell = cellAt(level, x, y);
  if (!cell) return level;
  const terrain = cell.terrain.length > 1 ? cell.terrain.slice(0, -1) : [{ kind: 'floor' as const }];
  return withCell(level, x, y, { ...cell, terrain });
}

/**
 * Removes one layer of a cell's stack by its position. Removing the base leaves plain floor in its place
 * (a stack is never empty); the layers above stay.
 */
export function removeLayerAt(level: Cc3dLevel, x: number, y: number, index: number): Cc3dLevel {
  const cell = cellAt(level, x, y);
  if (!cell || !Number.isInteger(index) || index < 0 || index >= cell.terrain.length) return level;
  const terrain = index === 0 ? [{ kind: 'floor' as const }, ...cell.terrain.slice(1)] : cell.terrain.filter((_, i) => i !== index);
  return withCell(level, x, y, { ...cell, terrain });
}

/** Resets a cell to bare floor: no layer, no thin wall, no item. A mob standing on it is removed too. */
export function eraseCell(level: Cc3dLevel, x: number, y: number): Cc3dLevel {
  if (!inside(level, x, y)) return level;
  const cleared = withCell(level, x, y, emptyCell());
  const stripped = removeMob(cleared, x, y);
  return stripped;
}

/** The item reduced to the attributes its kind uses, or null when the kind is unknown or a key lacks a valid colour. */
export function normalizeItem(item: Cc3dItem): Cc3dItem | null {
  if (!(CC3D_ITEM_KINDS as readonly string[]).includes(item.kind)) return null;
  if (item.kind === 'key') return isColor(item.color) ? { kind: 'key', color: item.color } : null;
  return { kind: item.kind };
}

/** Puts an item on a cell, or removes it with null. A key without a valid colour is refused. */
export function setItem(level: Cc3dLevel, x: number, y: number, item: Cc3dItem | null): Cc3dLevel {
  const cell = cellAt(level, x, y);
  if (!cell) return level;
  const next = item === null ? null : normalizeItem(item);
  if (item !== null && next === null) return level;
  return withCell(level, x, y, { ...cell, item: next });
}

/** Closes (on) or opens (off) one side of a cell with a thin wall. Panels keep the order N, E, S, W. */
export function setPanelSide(level: Cc3dLevel, x: number, y: number, side: Direction, on: boolean): Cc3dLevel {
  const cell = cellAt(level, x, y);
  if (!cell || !isDirection(side)) return level;
  const wanted = new Set<Direction>(cell.panels);
  if (on) wanted.add(side);
  else wanted.delete(side);
  const panels = ORDERED_DIRECTIONS.filter((d) => wanted.has(d));
  return withCell(level, x, y, { ...cell, panels });
}

/** Opens every side of a cell: no thin wall is left on it. */
export function clearPanels(level: Cc3dLevel, x: number, y: number): Cc3dLevel {
  const cell = cellAt(level, x, y);
  if (!cell) return level;
  return withCell(level, x, y, { ...cell, panels: [] });
}

/** Moves the player start, facing `dir` (the current facing, else west, when omitted). Outside the grid or onto a mob is refused. */
export function setPlayer(level: Cc3dLevel, x: number, y: number, dir?: Direction): Cc3dLevel {
  if (!inside(level, x, y) || mobIndexAt(level, x, y) >= 0) return level;
  const facing = dir ?? level.player.dir ?? PLAYER_START_FACING;
  if (!isDirection(facing)) return level;
  const { player } = level;
  if (player.x === x && player.y === y && (player.dir ?? PLAYER_START_FACING) === facing) return level;
  return { ...level, player: { x, y, dir: facing } };
}

/** The mob reduced to the attributes its kind uses, or null when it cannot be placed. */
export function normalizeMob(level: Cc3dLevel, mob: Cc3dMob): Cc3dMob | null {
  if (!(CC3D_MOB_KINDS as readonly string[]).includes(mob.kind)) return null;
  if (!inside(level, mob.x, mob.y) || !isDirection(mob.dir)) return null;
  const out: Cc3dMob = { kind: mob.kind, x: mob.x, y: mob.y, dir: mob.dir };
  if (mob.kind === 'block_color') {
    if (!isColor(mob.color)) return null;
    out.color = mob.color;
  }
  if (mob.kind === 'reflector') {
    const mirror = typeof mob.mirror === 'string' ? mob.mirror.toUpperCase() : '';
    if (!MIRROR_NAMES.includes(mirror)) return null;
    out.mirror = mirror;
  }
  return out;
}

export function mobIndexAt(level: Cc3dLevel, x: number, y: number): number {
  return level.mobs.findIndex((mob) => mob.x === x && mob.y === y);
}

/**
 * Places a mob. A mob already on that cell is replaced in place (it keeps its index: the order of the mobs
 * decides which clone machine, trap or shooter a device links to); a new one is appended. Refused when the
 * mob is off the grid, on the player start, or lacks the colour or mirror its kind needs.
 */
export function placeMob(level: Cc3dLevel, mob: Cc3dMob): Cc3dLevel {
  const next = normalizeMob(level, mob);
  if (!next) return level;
  if (level.player.x === next.x && level.player.y === next.y) return level;
  const index = mobIndexAt(level, next.x, next.y);
  if (index < 0) return { ...level, mobs: [...level.mobs, next] };
  if (canonicalJson(level.mobs[index]) === canonicalJson(next)) return level;
  return { ...level, mobs: level.mobs.map((existing, i) => (i === index ? next : existing)) };
}

/** Removes the mob on a cell; the other mobs keep their order. */
export function removeMob(level: Cc3dLevel, x: number, y: number): Cc3dLevel {
  const index = mobIndexAt(level, x, y);
  if (index < 0) return level;
  return { ...level, mobs: level.mobs.filter((_, i) => i !== index) };
}

/** Turns the mob on a cell to `dir`, or a quarter turn clockwise when omitted. The mob keeps its index. */
export function rotateMob(level: Cc3dLevel, x: number, y: number, dir?: Direction): Cc3dLevel {
  const index = mobIndexAt(level, x, y);
  if (index < 0) return level;
  const mob = level.mobs[index];
  const target = dir ?? ORDERED_DIRECTIONS[(ORDERED_DIRECTIONS.indexOf(mob.dir) + 1) % ORDERED_DIRECTIONS.length];
  if (!isDirection(target) || target === mob.dir) return level;
  return { ...level, mobs: level.mobs.map((existing, i) => (i === index ? { ...existing, dir: target } : existing)) };
}
