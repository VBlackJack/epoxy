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

import { GameEngine } from '../GameEngine';
import type { CompiledLevel, Direction } from '../types';
import { Cc3dRig } from './cc3dTestRig';

/**
 * Test support: plays a CC3D level on the CC3D engine and its conversion on the Epoxy engine, move by move, and
 * compares the two at the points where both are at rest. Tick timing is ignored on purpose: each engine is ticked
 * until its player stands still, so only the state reached is compared.
 */

/** Upper bound of ticks one engine may take to settle after a move. */
export const MAX_SETTLE_TICKS = 400;
/** Quiet ticks in a row that count as standing still. */
const STABLE_TICKS = 3;
/** Moves of the seeded random walk. */
export const WALK_MOVES = 500;
const WALK_DIRECTIONS: readonly Direction[] = ['N', 'E', 'S', 'W'];
/** Mulberry32 constants. */
const MULBERRY_INCREMENT = 0x6d2b79f5;
const UINT32_RANGE = 4294967296;

/** A field on which the two engines disagree. */
export interface DiffMismatch {
  /** Moves played when the mismatch was found (0 = at load). */
  move: number;
  field: 'player' | 'alive' | 'complete' | 'chips' | 'keys' | 'cells' | 'settle' | 'entities' | 'items';
  detail: string;
}

/** CC3D display ids that name another Epoxy id; every other CC3D display id is also the Epoxy id. */
export function epoxyIdOf(displayId: string): string {
  if (displayId === 'cc3d_socket_red') return 'socket';
  if (displayId === 'socket') return 'fish_gate';
  if (displayId === 'teleport_blue') return 'teleport_forward';
  if (displayId === 'teleport_red') return 'teleport_turning';
  if (displayId === 'cc3d_sand') return 'gravel';
  if (displayId === 'force_random') return 'force_cycle';
  // The converter moves a bomb layer to the item grid (see compare with `items`), so the terrain below is floor.
  if (displayId === 'bomb') return 'floor';
  const hold = /^cc3d_hold_door_(\w+)$/.exec(displayId);
  if (hold) return `hold_door_${hold[1]}`;
  const toggle = /^cc3d_toggle_door_(\w+)$/.exec(displayId);
  if (toggle) return `toggle_wall_${toggle[1]}`;
  const control = /^cc3d_toggle_control_(\w+)$/.exec(displayId);
  if (control) return `toggle_button_${control[1]}`;
  const plate = /^cc3d_plate_(\w+)$/.exec(displayId);
  if (plate) return `pressure_plate_${plate[1]}`;
  return displayId;
}

/** CC3D display ids of mobs that name another Epoxy entity type. */
export const ENTITY_ID_MAP: Readonly<Record<string, string>> = {
  cc3d_golem_yellow: 'puppet',
  cc3d_legs_green: 'fireball',
  cc3d_legs_red: 'glider',
  cc3d_baby_blinky: 'glider',
  cc3d_baby_screamer: 'fireball',
  cc3d_reflector_lu: 'one_sided_mirror_sw',
  cc3d_reflector_dl: 'one_sided_mirror_nw',
  cc3d_reflector_ur: 'one_sided_mirror_se',
  cc3d_reflector_rd: 'one_sided_mirror_ne',
  cc3d_bot_static: 'turret_fixed',
  cc3d_bot_cw: 'turret_cw',
  cc3d_bot_ccw: 'turret_ccw',
  cc3d_bot_multi: 'turret_multi',
  cc3d_block_red: 'color_block_red',
  cc3d_block_green: 'color_block_green',
  cc3d_block_blue: 'color_block_blue',
  cc3d_block_yellow: 'color_block_yellow'
};
/** CC3D display ids of items that name another Epoxy item id. */
const ITEM_ID_MAP: Readonly<Record<string, string>> = { stopwatch_bonus: 'slow_time', cc3d_fish_extra: 'chip' };
const BOMB_ID = 'bomb';

/** What stands where, as sorted `type@x,y` strings. */
function entityLines(entities: ReadonlyArray<{ type: string; x: number; y: number }>, map: (type: string) => string): string[] {
  return entities.map((e) => `${map(e.type)}@${e.x},${e.y}`).sort();
}

/** Epoxy shows a floating colour block as a terrain tile of this prefix, where CC3D keeps the block as a mob on water. */
const FLOATING_BLOCK_PREFIX = 'floating_block_';

interface FloatingProbe {
  x: number;
  y: number;
  color?: string;
  floating: boolean;
}

function nonZero(keys: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(keys).filter(([, count]) => count > 0));
}

/** Both engines on the same level, advanced one move at a time. */
export class DifferentialPair {
  public readonly rig: Cc3dRig;
  public readonly epoxy: GameEngine;
  public moves = 0;
  /** Both engines were still moving when the settle cap ran out: a perpetual slide, whose phase is not comparable. */
  public looping = false;
  private cc3dSettled = true;
  private epoxySettled = true;
  /** The converted level holds a socket, so chips matter; without one it asks for none. */
  private readonly hasSocket: boolean;

  constructor(source: CompiledLevel, converted: CompiledLevel, seed: number) {
    this.rig = new Cc3dRig(source, seed);
    this.epoxy = new GameEngine();
    this.epoxy.loadLevel(converted, seed);
    this.hasSocket = converted.terrain.some((row) => row.includes('socket') || row.includes('fish_gate'));
  }

  /**
   * Ticks an engine until its player has stood still, with nothing under way, for STABLE_TICKS ticks in a row: a
   * slide or a teleport exit may start one tick after the player arrived, so a single quiet tick proves nothing.
   */
  private settle(tick: () => void, read: () => { x: number; y: number; busy: boolean; over: boolean }): boolean {
    let quiet = 0;
    let last = read();
    for (let i = 0; i < MAX_SETTLE_TICKS && !last.over; i++) {
      tick();
      const now = read();
      quiet = !now.busy && !last.busy && now.x === last.x && now.y === last.y ? quiet + 1 : 0;
      last = now;
      if (quiet >= STABLE_TICKS) return true;
    }
    return last.over;
  }

  /** True once either engine has ended the level. */
  public get ended(): boolean {
    return !this.rig.player.alive || !this.epoxy.getPlayer().alive || this.rig.engine.isLevelCompleted() || this.epoxy.isLevelCompleted();
  }

  /** Presses a direction on both engines, then lets each settle. */
  public step(dir: Direction): void {
    this.moves += 1;
    this.rig.press(dir);
    this.cc3dSettled = this.settle(
      () => this.rig.tick(1),
      () => {
        const p = this.rig.player;
        return { x: p.x, y: p.y, busy: p.moveCooldown > 0 || p.isSliding, over: !p.alive || this.rig.engine.isLevelCompleted() };
      }
    );
    this.epoxy.attemptPlayerMove(dir);
    this.epoxySettled = this.settle(
      () => this.epoxy.tick(),
      () => {
        const p = this.epoxy.getPlayer();
        return { x: p.x, y: p.y, busy: p.moveCooldown > 0 || p.isSliding, over: !p.alive || this.epoxy.isLevelCompleted() };
      }
    );
  }

  /** The CC3D colour blocks that float on water now, by cell (read from the simulation, which the engine keeps private). */
  private floatingBlocks(): ReadonlyMap<string, string> {
    const sim = (this.rig.engine as unknown as { sim: { world: { mobs: FloatingProbe[] } } | null }).sim;
    const found = new Map<string, string>();
    for (const mob of sim?.world.mobs ?? []) if (mob.floating && mob.color !== undefined) found.set(`${mob.x},${mob.y}`, mob.color);
    return found;
  }

  /**
   * The first field on which the engines differ, or null. `entities` also compares the blocks and monsters (type
   * and cell), `items` the item grids (a CC3D bomb layer counts as the item `bomb`, as the converter plays it).
   */
  public compare(options: { entities?: boolean; items?: boolean } = {}): DiffMismatch | null {
    const at = (field: DiffMismatch['field'], detail: string): DiffMismatch => ({ move: this.moves, field, detail });
    if (!this.cc3dSettled && !this.epoxySettled) {
      this.looping = true;
      return null;
    }
    if (this.cc3dSettled !== this.epoxySettled) return at('settle', `cc3d settles ${this.cc3dSettled} epoxy settles ${this.epoxySettled}`);
    const a = this.rig.player;
    const b = this.epoxy.getPlayer();
    if (a.x !== b.x || a.y !== b.y) return at('player', `cc3d ${a.x},${a.y} epoxy ${b.x},${b.y}`);
    if (a.alive !== b.alive) return at('alive', `cc3d ${a.alive} epoxy ${b.alive}`);
    const doneA = this.rig.engine.isLevelCompleted();
    const doneB = this.epoxy.isLevelCompleted();
    if (doneA !== doneB) return at('complete', `cc3d ${doneA} epoxy ${doneB}`);
    const chipsA = this.rig.engine.getChipsRemaining();
    const chipsB = this.epoxy.getChipsRemaining();
    // Without a socket the converted level needs no chips (chipsRequired 0), while CC3D still counts its fish.
    if (this.hasSocket && chipsA !== chipsB) return at('chips', `cc3d ${chipsA} epoxy ${chipsB}`);
    const keysA = JSON.stringify(Object.entries(nonZero(a.keys)).sort());
    const keysB = JSON.stringify(Object.entries(nonZero(b.keys)).sort());
    if (keysA !== keysB) return at('keys', `cc3d ${keysA} epoxy ${keysB}`);
    const terrainA = this.rig.engine.getTerrain();
    const terrainB = this.epoxy.getTerrain();
    const floating = this.floatingBlocks();
    for (let y = 0; y < terrainA.length; y++) {
      for (let x = 0; x < terrainA[y].length; x++) {
        const floatingColor = floating.get(`${x},${y}`);
        const mapped = floatingColor === undefined ? epoxyIdOf(terrainA[y][x]) : `${FLOATING_BLOCK_PREFIX}${floatingColor}`;
        if (mapped !== terrainB[y][x]) return at('cells', `${x},${y} cc3d ${terrainA[y][x]} epoxy ${terrainB[y][x]}`);
      }
    }
    if (options.items) {
      const itemsA = this.rig.engine.getItems();
      const itemsB = this.epoxy.getItems();
      for (let y = 0; y < itemsA.length; y++) {
        for (let x = 0; x < itemsA[y].length; x++) {
          const raw = itemsA[y][x];
          const mapped = raw === null ? (terrainA[y][x] === BOMB_ID ? BOMB_ID : null) : (ITEM_ID_MAP[raw] ?? raw);
          if (mapped !== itemsB[y][x]) return at('items', `${x},${y} cc3d ${String(mapped)} epoxy ${String(itemsB[y][x])}`);
        }
      }
    }
    if (options.entities) {
      const resting = this.rig.entities.filter((e) => !(e.type in ENTITY_ID_MAP && floating.has(`${e.x},${e.y}`)));
      const linesA = entityLines(resting, (type) => ENTITY_ID_MAP[type] ?? type);
      const linesB = entityLines(this.epoxy.getEntities(), (type) => type);
      if (linesA.join(';') !== linesB.join(';')) return at('entities', `cc3d ${linesA.join(' ')} epoxy ${linesB.join(' ')}`);
    }
    return null;
  }
}

/** A seeded generator of numbers in [0, 1), so a walk is the same on every run. */
export function seededUnit(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + MULBERRY_INCREMENT) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / UINT32_RANGE;
  };
}

export interface WalkResult {
  /** The walk changed something: a chip or a key was taken, or a cell changed. */
  touched: boolean;
  moves: number;
  /** The walk stopped because both engines slide for ever. */
  looping: boolean;
  mismatch: DiffMismatch | null;
}

/** Plays a seeded random walk on both engines, stopping at the first mismatch or when the level ends. */
export function differentialWalk(source: CompiledLevel, converted: CompiledLevel, seed: number, moves = WALK_MOVES): WalkResult {
  const pair = new DifferentialPair(source, converted, seed);
  const next = seededUnit(seed);
  const snapshot = (): string => pair.epoxy.getTerrain().map((row) => row.join(',')).join(';');
  const startTerrain = snapshot();
  const startChips = pair.epoxy.getChipsRemaining();
  let touched = false;
  const initial = pair.compare();
  if (initial) return { touched, moves: 0, looping: false, mismatch: initial };
  for (let i = 0; i < moves && !pair.ended && !pair.looping; i++) {
    pair.step(WALK_DIRECTIONS[Math.floor(next() * WALK_DIRECTIONS.length)]);
    const mismatch = pair.compare();
    if (mismatch) return { touched, moves: pair.moves, looping: false, mismatch };
    if (!touched) {
      touched =
        pair.epoxy.getChipsRemaining() !== startChips ||
        Object.values(pair.epoxy.getPlayer().keys).some((count) => count > 0) ||
        snapshot() !== startTerrain;
    }
  }
  return { touched, moves: pair.moves, looping: pair.looping, mismatch: null };
}
