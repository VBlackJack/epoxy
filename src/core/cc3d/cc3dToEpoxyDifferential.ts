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
  field: 'player' | 'alive' | 'complete' | 'chips' | 'keys' | 'cells' | 'settle';
  detail: string;
}

/** CC3D display ids that name another Epoxy id; every other CC3D display id is also the Epoxy id. */
function epoxyIdOf(displayId: string): string {
  if (displayId === 'cc3d_socket_red') return 'socket';
  if (displayId === 'cc3d_sand') return 'gravel';
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

  constructor(source: CompiledLevel, converted: CompiledLevel, seed: number) {
    this.rig = new Cc3dRig(source, seed);
    this.epoxy = new GameEngine();
    this.epoxy.loadLevel(converted, seed);
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

  /** The first field on which the engines differ, or null. */
  public compare(): DiffMismatch | null {
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
    if (chipsA !== chipsB) return at('chips', `cc3d ${chipsA} epoxy ${chipsB}`);
    const keysA = JSON.stringify(Object.entries(nonZero(a.keys)).sort());
    const keysB = JSON.stringify(Object.entries(nonZero(b.keys)).sort());
    if (keysA !== keysB) return at('keys', `cc3d ${keysA} epoxy ${keysB}`);
    const terrainA = this.rig.engine.getTerrain();
    const terrainB = this.epoxy.getTerrain();
    for (let y = 0; y < terrainA.length; y++) {
      for (let x = 0; x < terrainA[y].length; x++) {
        const mapped = epoxyIdOf(terrainA[y][x]);
        if (mapped !== terrainB[y][x]) return at('cells', `${x},${y} cc3d ${terrainA[y][x]} epoxy ${terrainB[y][x]}`);
      }
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
        Object.keys(pair.epoxy.getPlayer().keys).length > 0 ||
        snapshot() !== startTerrain;
    }
  }
  return { touched, moves: pair.moves, looping: pair.looping, mismatch: null };
}
