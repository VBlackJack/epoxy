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

import type { Cc3dCell, Cc3dColor, Cc3dLevel, Cc3dMob, Cc3dMobKind, Cc3dTerrainKind } from './model';
import { topTerrain } from './model';

/**
 * Every link a CC3D level derives from positions alone (a level file stores none). The engine resolves its
 * devices with the primitives below and cc3dLinks() reads the same primitives, so what an editor shows and
 * what the engine does cannot drift. Cells are row-major indices (y * width + x), mobs are indices into
 * level.mobs.
 */

/** A cell position. */
export interface LinkPoint {
  x: number;
  y: number;
}

/** Marks "no target" in the index arrays the engine keeps. */
export const NO_LINK = -1;

/** One source and the thing it works; `to` is null when nothing is there to work. */
export interface Cc3dLink {
  from: number;
  to: number | null;
}

/** The devices of one colour: the ones that act and the ones that are acted on. */
export interface Cc3dColorGroup {
  color: Cc3dColor;
  controls: number[];
  targets: number[];
}

export interface Cc3dLinks {
  /** Trap control -> the trap it opens (cell indices). */
  trapControls: Cc3dLink[];
  /**
   * Teleport -> the first candidate of an arrival there (cell indices). At run time a candidate that is
   * occupied or whose exits are blocked is skipped for the next one, so this is the usual target, not a promise.
   */
  teleports: Cc3dLink[];
  /** Clone switch -> the nearest clone machine (cell indices). */
  cloneSwitches: Cc3dLink[];
  /** Clone machine -> the template mob standing on it (mob index). */
  cloneMachines: Cc3dLink[];
  /** Laser controller -> the nearest laser shooter (mob index). */
  laserControllers: Cc3dLink[];
  /** Toggle controls and toggle doors, by colour (cell indices). */
  toggles: Cc3dColorGroup[];
  /** Hold plates (controls) and hold doors (targets), by colour (cell indices). */
  holds: Cc3dColorGroup[];
  /** Golem controls (cell indices) and golems (mob indices), keyed by golem colour. */
  golems: { blue: Cc3dColorGroup; yellow: Cc3dColorGroup };
}

// ---------------------------------------------------------------- primitives

/**
 * For each trap control (same order), the trap it works: the next trap after it in reading order, wrapping
 * from the last cell to the first; NO_LINK when the level has no trap. Both lists are in reading order.
 */
export function trapTargets(controls: readonly number[], traps: readonly number[]): number[] {
  return controls.map((control) => traps.find((trap) => trap > control) ?? traps[0] ?? NO_LINK);
}

/**
 * The other teleports of a kind, the previous one in reading order first, then the ones before it, wrapping
 * from the first to the last. `teleports` are the cell indices of the kind in reading order; `origin` is
 * the cell entered (a cell not in the list gets all of them, last first).
 */
export function teleportCandidatesBefore(teleports: readonly number[], origin: number): number[] {
  const here = teleports.indexOf(origin);
  if (here < 0) return [...teleports].reverse();
  return [...teleports.slice(0, here).reverse(), ...teleports.slice(here + 1).reverse()];
}

/**
 * The item nearest to a point by straight-line distance; a tie goes to the one first in reading order
 * (then to the first in the list). Null for an empty list.
 */
export function nearestPoint<T extends LinkPoint>(items: readonly T[], from: LinkPoint, width: number): T | null {
  return nearestBy(items, from, width, (item) => item.x, (item) => item.y);
}

/** nearestPoint for items that are not points themselves (cell indices): the accessors read their column and row. */
export function nearestBy<T>(
  items: readonly T[],
  from: LinkPoint,
  width: number,
  xOf: (item: T) => number,
  yOf: (item: T) => number
): T | null {
  let best: T | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestOrder = Number.POSITIVE_INFINITY;
  for (const item of items) {
    const x = xOf(item);
    const y = yOf(item);
    const distance = (x - from.x) ** 2 + (y - from.y) ** 2;
    const order = y * width + x;
    if (distance < bestDistance || (distance === bestDistance && order < bestOrder)) {
      best = item;
      bestDistance = distance;
      bestOrder = order;
    }
  }
  return best;
}

/** A hold door of a colour is open only while every plate of its colour is pressed; no plate keeps it closed. */
export function holdDoorWanted(plateCount: number, pressedCount: number): boolean {
  return plateCount > 0 && pressedCount === plateCount;
}

// ----------------------------------------------------------------- derivation

/**
 * Cell indices holding a layer of the kind anywhere in their stack, in reading order: the one index builder
 * the engine and cc3dLinks share. A cell with two layers of the kind is listed twice (the validator reports
 * such a stack as an error).
 */
export function indicesWithLayer(cells: readonly Cc3dCell[], kind: Cc3dTerrainKind): number[] {
  const found: number[] = [];
  cells.forEach((cell, index) => {
    for (const layer of cell.terrain) if (layer.kind === kind) found.push(index);
  });
  return found;
}

function colorOfLayer(cell: Cc3dCell, kind: Cc3dTerrainKind): Cc3dColor | undefined {
  return cell.terrain.find((layer) => layer.kind === kind)?.color;
}

function pointOf(index: number, width: number): LinkPoint {
  return { x: index % width, y: Math.floor(index / width) };
}

function mobIndicesOf(mobs: readonly Cc3dMob[], kind: Cc3dMobKind): number[] {
  const found: number[] = [];
  mobs.forEach((mob, index) => {
    if (mob.kind === kind) found.push(index);
  });
  return found;
}

/** Cells whose acting terrain (top of the stack) is a teleport of the kind, in reading order; that is the engine's rule. */
export function teleportCells(cells: readonly Cc3dCell[], kind: 'teleport_red' | 'teleport_blue'): number[] {
  const found: number[] = [];
  cells.forEach((cell, index) => {
    if (topTerrain(cell).kind === kind) found.push(index);
  });
  return found;
}

function colorGroups(
  cells: readonly Cc3dCell[],
  controlKind: Cc3dTerrainKind,
  targetKind: Cc3dTerrainKind,
  colors: readonly Cc3dColor[]
): Cc3dColorGroup[] {
  return colors.map((color) => ({
    color,
    controls: indicesWithLayer(cells, controlKind).filter((i) => colorOfLayer(cells[i], controlKind) === color),
    targets: indicesWithLayer(cells, targetKind).filter((i) => colorOfLayer(cells[i], targetKind) === color)
  }));
}

const ALL_COLORS: readonly Cc3dColor[] = ['red', 'green', 'blue', 'yellow'];

/** Every position-derived link of a level, exactly as the engine resolves them. */
export function cc3dLinks(level: Pick<Cc3dLevel, 'width' | 'cells' | 'mobs'>): Cc3dLinks {
  const { width, cells } = level;
  const traps = indicesWithLayer(cells, 'trap');
  const controls = indicesWithLayer(cells, 'trap_control');
  const targets = trapTargets(controls, traps);
  const trapControls = controls.map((from, i) => ({ from, to: targets[i] === NO_LINK ? null : targets[i] }));

  const teleports: Cc3dLink[] = [];
  for (const kind of ['teleport_red', 'teleport_blue'] as const) {
    const all = teleportCells(cells, kind);
    for (const from of all) teleports.push({ from, to: teleportCandidatesBefore(all, from)[0] ?? null });
  }
  teleports.sort((a, b) => a.from - b.from);

  const machines = indicesWithLayer(cells, 'clone_machine');
  const machinePoints = machines.map((index) => ({ ...pointOf(index, width), index }));
  const cloneSwitches = indicesWithLayer(cells, 'clone_switch').map((from) => ({
    from,
    to: nearestPoint(machinePoints, pointOf(from, width), width)?.index ?? null
  }));
  const cloneMachines = machines.map((from) => {
    const at = pointOf(from, width);
    const template = level.mobs.findIndex((mob) => mob.x === at.x && mob.y === at.y);
    return { from, to: template < 0 ? null : template };
  });

  const shooterIndices = mobIndicesOf(level.mobs, 'laser_shooter');
  const shooterPoints = shooterIndices.map((index) => ({ x: level.mobs[index].x, y: level.mobs[index].y, index }));
  const laserControllers = indicesWithLayer(cells, 'laser_controller').map((from) => ({
    from,
    to: nearestPoint(shooterPoints, pointOf(from, width), width)?.index ?? null
  }));

  const golemGroup = (color: Cc3dColor, controlKind: Cc3dTerrainKind, mobKind: Cc3dMobKind): Cc3dColorGroup => ({
    color,
    controls: indicesWithLayer(cells, controlKind),
    targets: mobIndicesOf(level.mobs, mobKind)
  });

  return {
    trapControls,
    teleports,
    cloneSwitches,
    cloneMachines,
    laserControllers,
    toggles: colorGroups(cells, 'toggle_control', 'toggle_door', ALL_COLORS),
    holds: colorGroups(cells, 'plate', 'hold_door', ALL_COLORS),
    golems: {
      blue: golemGroup('blue', 'golem_control_blue', 'golem_blue'),
      yellow: golemGroup('yellow', 'golem_control_yellow', 'golem_yellow')
    }
  };
}
