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

import { DIRECTION_VECTORS, ORDERED_DIRECTIONS } from '../../config/constants';
import type { VisualEventKind } from '../PlayEngine';
import type { Direction } from '../types';
import { DeathCause, PLAYER_START_FACING, SPEED_ORB_SLOWDOWN } from './cc3dConstants';
import type { Cc3dCell, Cc3dColor, Cc3dItemKind, Cc3dLevel, Cc3dMobKind, Cc3dTerrain } from './model';
import { cellIndex, topTerrain } from './model';

/**
 * The play state of one CC3D level. Plain JSON data (no Set, Map or class), so
 * an undo snapshot is one structuredClone.
 */

export interface Cell {
  x: number;
  y: number;
}

/** What every moving thing has: the player, blocks and (lot C2) monsters. */
export interface Mover {
  /** Logical cell: the destination while a step is in progress (the cell is claimed). */
  x: number;
  y: number;
  dir: Direction;
  /** Ticks left in the step in progress; 0 at rest. */
  remaining: number;
  /** Length in ticks of the step in progress. */
  duration: number;
  /** The step in progress was forced (ice, force floor, teleport exit), not chosen. */
  carried: boolean;
  /** The step in progress was chosen by the mover itself (not forced, pushed or released from a clone machine). */
  chose: boolean;
  /** World tick at which the step in progress started (a pushed block starts in the player's turn). */
  startedTick: number;
  /** Direction the floor keeps pushing the mover in (ice slide, corner turn, random force floor). */
  drift: Direction | null;
  /** Direction a teleport sent the mover out in; consumed by its next step. */
  exitDir: Direction | null;
}

export interface MobState extends Mover {
  uid: number;
  kind: Cc3dMobKind;
  color?: Cc3dColor;
  mirror?: string;
  /** A colour block that floats on water as a bridge: it no longer moves. */
  floating: boolean;
  /** The mob decides no new chosen step before this world tick (Snappy, Nibble rests; Omni blocked draws). */
  restUntilTick: number;
  /** Omni only: it has stood on slime and now leaves slime behind. Clones do not inherit it. */
  slimed?: boolean;
}

export interface PlayerData extends Mover {
  kind: 'player';
  alive: boolean;
  deathKey: string | null;
  keys: Record<Cc3dColor, number>;
  /** Oldest first, at most MAX_TOOLS. */
  tools: Cc3dItemKind[];
}

export type Actor = PlayerData | MobState;

/** Cell indices of every device, in reading order; the kinds present never change during play. */
export interface DeviceIndex {
  plates: number[];
  holdDoors: number[];
  toggleDoors: number[];
  traps: number[];
  trapControls: number[];
  machines: number[];
}

export interface World {
  width: number;
  height: number;
  cells: Cc3dCell[];
  /** Fixed processing order: document order of the level. */
  mobs: MobState[];
  player: PlayerData;
  tick: number;
  steps: number;
  /** FISH still to collect; extra FISH can push it below zero, the display clamps it. */
  fishRemaining: number;
  complete: boolean;
  nextUid: number;
  /** State of the seeded generator (random force floors). */
  rngState: number;
  /** Toggle doors that stay open until the cell they close on is free (cell indices). */
  closing: number[];
  /** Cell indices whose display changed since the engine last looked; transient. */
  changed: number[];
  /** Device cells, built once. */
  devices: DeviceIndex;
  /** The mob whose logical cell is a cell index, kept in step with every move. Transient: rebuilt by reindexMobs. */
  occupancy: Map<number, MobState>;
  /** Copy-on-write journal of the cells first touched since the last undo snapshot; null when none is kept. Transient. */
  journal: Map<number, Cc3dCell> | null;
  /** Counts removed mobs, so a loop over the mob list can tell when one was removed. */
  removals: number;
}

/** What the rules need from the simulation. */
export interface RuleContext {
  readonly world: World;
  emitVisual(kind: VisualEventKind, x: number, y: number, colorKey?: string): void;
  playSfx(id: string): void;
  /** Starts a step of a mob out of a clone machine (normal speed). */
  releaseMob(mob: MobState, dir: Direction): void;
  /** A mob tries one chosen step (a yellow golem moved by its control); returns whether it started. */
  stepMob(mob: MobState, dir: Direction): boolean;
  killPlayer(cause: DeathCause): void;
  randomDirection(): Direction;
}

export const BLOCK_KINDS: readonly Cc3dMobKind[] = ['block_dirt', 'block_ice', 'block_color', 'reflector'];

export function isBlockKind(kind: Cc3dMobKind): boolean {
  return BLOCK_KINDS.includes(kind);
}

/** 2 while the player holds the speed orb, else 1: how much longer monster-started steps and rests take [U, 07 section 7.7]. */
export function speedOrbFactor(world: World): number {
  return world.player.tools.includes('orb_speed') ? SPEED_ORB_SLOWDOWN : 1;
}

export function neighbour(cell: Cell, dir: Direction): Cell {
  const v = DIRECTION_VECTORS[dir];
  return { x: cell.x + v.dx, y: cell.y + v.dy };
}

export function turnClockwise(dir: Direction, quarterTurns = 1): Direction {
  const count = ORDERED_DIRECTIONS.length;
  const index = ORDERED_DIRECTIONS.indexOf(dir);
  return ORDERED_DIRECTIONS[(((index + quarterTurns) % count) + count) % count];
}

const HALF_TURN = 2;

export function opposite(dir: Direction): Direction {
  return turnClockwise(dir, HALF_TURN);
}

export function cellAt(world: World, x: number, y: number): Cc3dCell | undefined {
  if (x < 0 || y < 0 || x >= world.width || y >= world.height) return undefined;
  return world.cells[cellIndex(world, x, y)];
}

/** The cell a mover stands on (always inside the grid). */
export function cellOf(world: World, at: Cell): Cc3dCell {
  const cell = cellAt(world, at.x, at.y);
  if (!cell) throw new Error(`CC3D: cell (${at.x}, ${at.y}) is outside the grid`);
  return cell;
}

/**
 * Announces that a cell is about to change: marks it for the display and keeps
 * its first state since the last undo snapshot (copy-on-write). Always call it
 * BEFORE changing the cell, its terrain layers or its item.
 */
export function touch(world: World, at: Cell): void {
  const index = cellIndex(world, at.x, at.y);
  world.changed.push(index);
  if (world.journal && !world.journal.has(index)) world.journal.set(index, structuredClone(world.cells[index]));
}

/** The terrain that acts on whoever is on the cell: the top of the stack. */
export function actingTerrain(cell: Cc3dCell): Cc3dTerrain {
  return topTerrain(cell);
}

/** Removes the top of the stack; plain floor shows when nothing else is left. */
export function removeTop(world: World, at: Cell): void {
  const cell = cellOf(world, at);
  touch(world, at);
  cell.terrain.pop();
  if (cell.terrain.length === 0) cell.terrain.push({ kind: 'floor' });
}

/** Replaces the top of the stack. */
export function replaceTop(world: World, at: Cell, terrain: Cc3dTerrain): void {
  const cell = cellOf(world, at);
  touch(world, at);
  cell.terrain[cell.terrain.length - 1] = terrain;
}

/** The mob whose logical cell is the cell, other than `except`. */
export function mobAt(world: World, at: Cell, except?: Actor): MobState | undefined {
  const found = world.occupancy.get(cellIndex(world, at.x, at.y));
  return found !== undefined && found !== except ? found : undefined;
}

/** True when a floating colour block lies on the cell (water there is a bridge). */
export function hasFloatingBlock(world: World, at: Cell): boolean {
  return world.occupancy.get(cellIndex(world, at.x, at.y))?.floating === true;
}

/** Adds a copy of a mob at the end of the processing order. */
export function spawnCopy(world: World, template: MobState, dir: Direction): MobState {
  const copy: MobState = {
    ...newMover(template.x, template.y, dir),
    uid: world.nextUid++,
    kind: template.kind,
    color: template.color,
    mirror: template.mirror,
    floating: false,
    restUntilTick: 0
  };
  world.mobs.push(copy);
  world.occupancy.set(cellIndex(world, copy.x, copy.y), copy);
  return copy;
}

/** True when the player or any mob has the cell as its logical cell. */
export function isOccupied(world: World, at: Cell): boolean {
  return (world.player.alive && world.player.x === at.x && world.player.y === at.y) || mobAt(world, at) !== undefined;
}

export function removeMob(world: World, mob: MobState): void {
  const index = world.mobs.indexOf(mob);
  if (index >= 0) world.mobs.splice(index, 1);
  const key = cellIndex(world, mob.x, mob.y);
  if (world.occupancy.get(key) === mob) world.occupancy.delete(key);
  world.removals += 1;
}

/** Moves an actor to a cell; every change of a mob's logical cell goes through here. */
export function moveActor(world: World, actor: Actor, x: number, y: number): void {
  if (actor.kind !== 'player') {
    const from = cellIndex(world, actor.x, actor.y);
    if (world.occupancy.get(from) === actor) world.occupancy.delete(from);
    world.occupancy.set(cellIndex(world, x, y), actor);
  }
  actor.x = x;
  actor.y = y;
}

/** Rebuilds the cell index of the mobs, after a restore. */
export function reindexMobs(world: World): void {
  world.occupancy = new Map();
  for (const mob of world.mobs) {
    const key = cellIndex(world, mob.x, mob.y);
    if (!world.occupancy.has(key)) world.occupancy.set(key, mob);
  }
}

function buildDeviceIndex(cells: Cc3dCell[]): DeviceIndex {
  const index: DeviceIndex = { plates: [], holdDoors: [], toggleDoors: [], traps: [], trapControls: [], machines: [] };
  cells.forEach((cell, i) => {
    for (const t of cell.terrain) {
      if (t.kind === 'plate') index.plates.push(i);
      else if (t.kind === 'hold_door') index.holdDoors.push(i);
      else if (t.kind === 'toggle_door') index.toggleDoors.push(i);
      else if (t.kind === 'trap') index.traps.push(i);
      else if (t.kind === 'trap_control') index.trapControls.push(i);
      else if (t.kind === 'clone_machine') index.machines.push(i);
    }
  });
  return index;
}

export function isPlayerAt(world: World, at: Cell): boolean {
  const p = world.player;
  return p.alive && !world.complete && p.x === at.x && p.y === at.y;
}

function newMover(x: number, y: number, dir: Direction): Mover {
  return { x, y, dir, remaining: 0, duration: 0, startedTick: -1, carried: false, chose: false, drift: null, exitDir: null };
}

/** Builds the starting world of a level. The level itself is never modified. */
export function buildWorld(level: Cc3dLevel, seed: number): World {
  const cells = structuredClone(level.cells);
  const fish = cells.filter((c) => c.item?.kind === 'fish').length;
  const mobs: MobState[] = level.mobs.map((m, i) => ({
    ...newMover(m.x, m.y, m.dir),
    uid: i + 1,
    kind: m.kind,
    color: m.color,
    mirror: m.mirror,
    floating: false,
    restUntilTick: 0,
    // An Omni that starts on slime has stood on it already [U, 07 section 7.9 item 3].
    ...(m.kind === 'omni' && topTerrain(level.cells[cellIndex(level, m.x, m.y)]).kind === 'slime' ? { slimed: true } : {})
  }));
  const world: World = {
    width: level.width,
    height: level.height,
    cells,
    mobs,
    player: {
      ...newMover(level.player.x, level.player.y, level.player.dir ?? PLAYER_START_FACING),
      kind: 'player',
      alive: true,
      deathKey: null,
      keys: { red: 0, green: 0, blue: 0, yellow: 0 },
      tools: []
    },
    tick: 0,
    steps: 0,
    fishRemaining: fish,
    complete: false,
    nextUid: mobs.length + 1,
    rngState: seed >>> 0,
    closing: [],
    changed: [],
    devices: buildDeviceIndex(cells),
    occupancy: new Map(),
    journal: null,
    removals: 0
  };
  reindexMobs(world);
  return world;
}
