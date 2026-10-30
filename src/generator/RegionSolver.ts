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

import { ConfigRegistry } from '../config/ConfigRegistry';
import { DIRECTION_VECTORS, ORDERED_DIRECTIONS } from '../config/constants';
import { GameEngine } from '../core/GameEngine';
import { CompiledLevel, Direction, GridPoint, RuntimeEntity, UndoSnapshot } from '../core/types';
import { PieceSolver, SolverAction, WAIT_ACTION } from './PieceSolver';

const WALL_TILE_ID = 'wall';
const REGION_LEVEL_PASSWORD = 'REGN';
/** Wall cells kept around the region's bounding box in the cropped engine. */
const CROP_MARGIN = 1;
/** Default bound on states explored by one region search (one target). */
export const DEFAULT_MAX_REGION_STATES = 20000;

/**
 * The open set of a best-first search: state indices in order of their bound,
 * the deepest first among equal bounds (nearer the target), then the earliest
 * generated, so the order is deterministic.
 */
class SearchQueue {
  private readonly heap: Array<{ index: number; bound: number; depth: number }> = [];

  public push(index: number, bound: number, depth: number): void {
    const heap = this.heap;
    heap.push({ index, bound, depth });
    let at = heap.length - 1;
    while (at > 0) {
      const parent = (at - 1) >> 1;
      if (!this.before(heap[at], heap[parent])) break;
      [heap[at], heap[parent]] = [heap[parent], heap[at]];
      at = parent;
    }
  }

  public pop(): number | null {
    const heap = this.heap;
    if (heap.length === 0) return null;
    const top = heap[0];
    const last = heap.pop() as { index: number; bound: number; depth: number };
    if (heap.length > 0) {
      heap[0] = last;
      let at = 0;
      for (;;) {
        const left = 2 * at + 1;
        const right = left + 1;
        let best = at;
        if (left < heap.length && this.before(heap[left], heap[best])) best = left;
        if (right < heap.length && this.before(heap[right], heap[best])) best = right;
        if (best === at) break;
        [heap[at], heap[best]] = [heap[best], heap[at]];
        at = best;
      }
    }
    return top.index;
  }

  private before(a: { index: number; bound: number; depth: number }, b: { index: number; bound: number; depth: number }): boolean {
    if (a.bound !== b.bound) return a.bound < b.bound;
    if (a.depth !== b.depth) return a.depth > b.depth;
    return a.index < b.index;
  }
}

/**
 * What the search needs to know about the player. Mirrors the engine's
 * snapshot: keys by tile id, boots as a list of tile ids.
 */
export type RegionPlayer = UndoSnapshot['player'];

/** Everything a region search starts from: the world as it is now. */
export interface RegionStart {
  /** Open-area cells; the search never leaves them (anything else is a wall). */
  cells: GridPoint[];
  player: RegionPlayer;
  /** Current states of the monsters (and blocks) standing inside the region. */
  entities: RuntimeEntity[];
  /** Terrain and items of the level; only the region's cells are read. */
  terrain: string[][];
  items: (string | null)[][];
  chipsRemaining: number;
  nextEntityUid: number;
  rngState: number;
  ticksElapsed: number;
}

export interface RegionSolveResult {
  moves: SolverAction[] | null;
  /** Total over every search run, whatever the outcome. */
  statesExplored: number;
  truncated: boolean;
}

/**
 * Timed search for the open area of a hub level, where monsters wander.
 *
 * ASSUMPTION: the region's borders are walls or gravel that monsters cannot
 * cross, so monsters outside the region never affect it. The search therefore
 * runs in an isolated engine holding only the region's terrain and items and
 * the region's own monsters, and the answer is replayed in the real level.
 * Trap and clone links are not carried: the open area holds none.
 *
 * Collect several targets with `collectInOrder`: one search per target keeps
 * each short, where a single search for all of them explodes combinatorially.
 */
export class RegionSolver {
  /** Reads the start state from a running engine, for the monsters inside `cells`. */
  public static startFrom(engine: GameEngine, cells: GridPoint[]): RegionStart {
    const snap = engine.captureState();
    const inside = new Set(cells.map((c) => this.cellKey(c.x, c.y)));
    return {
      cells,
      player: snap.player,
      entities: snap.entities.filter((e) => inside.has(this.cellKey(e.x, e.y))),
      terrain: snap.terrain,
      items: snap.items,
      chipsRemaining: snap.chipsRemaining,
      nextEntityUid: snap.nextEntityUid,
      rngState: snap.rngState,
      ticksElapsed: snap.ticksElapsed
    };
  }

  /** Moves (and waits) from the start state to `target`, or null. Confirmed by replay in `engine`. */
  public static solveRegion(
    engine: GameEngine,
    start: RegionStart,
    target: GridPoint,
    maxStates: number = DEFAULT_MAX_REGION_STATES
  ): RegionSolveResult {
    return this.collectInOrder(engine, start, [target], maxStates);
  }

  /**
   * Visits the targets in the given order, each as its own search, carrying
   * the isolated engine's state from one to the next. `maxStates` bounds each
   * search. `statesExplored` is the total over all of them. The concatenated
   * moves are replayed in `engine` (which is restored afterwards); a result
   * that does not hold there is null, never a full-level search.
   */
  public static collectInOrder(
    engine: GameEngine,
    start: RegionStart,
    targets: GridPoint[],
    maxStates: number = DEFAULT_MAX_REGION_STATES
  ): RegionSolveResult {
    const crop = this.cropToRegion(start);
    const local = this.buildIsolated(crop.start);
    const moves: SolverAction[] = [];
    let total = 0;
    for (const original of targets) {
      const target = { x: original.x + crop.dx, y: original.y + crop.dy };
      const legStart = local.captureState();
      const leg = this.search(local, crop.start.cells, target, maxStates);
      local.restoreState(legStart);
      total += leg.statesExplored;
      if (!leg.moves) return { moves: null, statesExplored: total, truncated: leg.truncated };
      for (const action of leg.moves) PieceSolver.play(local, action);
      moves.push(...leg.moves);
    }
    if (!this.confirmInLevel(engine, moves, targets)) {
      return { moves: null, statesExplored: total, truncated: false };
    }
    return { moves, statesExplored: total, truncated: false };
  }

  /**
   * Shrinks the start state to the region's bounding box plus a wall margin, so
   * a state copy touches a few hundred cells instead of the whole level.
   * Coordinates are shifted by (dx, dy); the margin cells are walls, exactly
   * what surrounds the region in the isolated engine.
   */
  private static cropToRegion(start: RegionStart): { start: RegionStart; dx: number; dy: number } {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const { x, y } of start.cells) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    if (start.cells.length === 0) return { start, dx: 0, dy: 0 };
    const dx = CROP_MARGIN - minX;
    const dy = CROP_MARGIN - minY;
    const width = maxX - minX + 1 + 2 * CROP_MARGIN;
    const height = maxY - minY + 1 + 2 * CROP_MARGIN;
    const terrain = Array.from({ length: height }, () => new Array<string>(width).fill(WALL_TILE_ID));
    const items = Array.from({ length: height }, () => new Array<string | null>(width).fill(null));
    for (const { x, y } of start.cells) {
      terrain[y + dy][x + dx] = start.terrain[y][x];
      items[y + dy][x + dx] = start.items[y][x];
    }
    return {
      dx,
      dy,
      start: {
        ...start,
        cells: start.cells.map((c) => ({ x: c.x + dx, y: c.y + dy })),
        player: { ...start.player, x: start.player.x + dx, y: start.player.y + dy },
        entities: start.entities.map((e) => ({ ...e, x: e.x + dx, y: e.y + dy })),
        terrain,
        items
      }
    };
  }

  /** Engine of the start state's size where everything but the region is wall. */
  private static buildIsolated(start: RegionStart): GameEngine {
    const height = start.terrain.length;
    const width = start.terrain[0].length;
    const terrain = Array.from({ length: height }, () => new Array<string>(width).fill(WALL_TILE_ID));
    const items = Array.from({ length: height }, () => new Array<string | null>(width).fill(null));
    for (const { x, y } of start.cells) {
      terrain[y][x] = start.terrain[y][x];
      items[y][x] = start.items[y][x];
    }
    const level: CompiledLevel = {
      id: `region_${width}x${height}`,
      number: 1,
      password: REGION_LEVEL_PASSWORD,
      timeLimitSeconds: 0,
      chipsRequired: 0,
      playerStart: { x: start.player.x, y: start.player.y, dir: start.player.dir },
      terrain,
      items,
      entities: [],
      trapLinks: [],
      cloneLinks: []
    };
    const local = new GameEngine();
    local.loadLevel(level);
    const state = local.captureState();
    state.entities = start.entities.map((e) => ({ ...e }));
    state.player = { ...start.player, keys: { ...start.player.keys }, boots: [...start.player.boots] };
    state.chipsRemaining = start.chipsRemaining;
    state.nextEntityUid = Math.max(state.nextEntityUid, start.nextEntityUid);
    state.rngState = start.rngState;
    state.ticksElapsed = start.ticksElapsed;
    local.restoreState(state);
    return local;
  }

  /**
   * Best-first search to `target` from the engine's current state; the engine
   * is left in any state. States are expanded by their moves so far plus the
   * grid distance left to the target, so the search heads for the target and
   * spreads over the region only where a monster stands in the way: the
   * states explored grow with the way, not with the region.
   */
  private static search(
    engine: GameEngine,
    cells: GridPoint[],
    target: GridPoint,
    maxStates: number
  ): RegionSolveResult {
    const at = (): boolean => {
      const p = engine.getPlayer();
      return p.x === target.x && p.y === target.y;
    };
    if (at()) return { moves: [], statesExplored: 1, truncated: false };

    const base = engine.captureState();
    const actions: SolverAction[] = [...ORDERED_DIRECTIONS, WAIT_ACTION];
    const states: UndoSnapshot[] = [base];
    const parents: number[] = [-1];
    const via: (SolverAction | null)[] = [null];
    const depth: number[] = [0];
    const seen = new Set<string>([this.stateKey(engine, cells, base)]);
    const open = new SearchQueue();
    open.push(0, this.distanceLeft(base, target), 0);

    for (let head = open.pop(); head !== null; head = open.pop()) {
      for (const action of actions) {
        const from = states[head];
        if (action !== WAIT_ACTION && this.isPlainlyBlocked(from, action)) continue;
        engine.restoreState(from);
        if (action === WAIT_ACTION) {
          if (!PieceSolver.play(engine, WAIT_ACTION)) continue;
        } else {
          if (!engine.attemptPlayerMove(action) && !this.terrainChanged(engine, from)) continue;
          if (!PieceSolver.settle(engine)) continue;
        }
        if (engine.isLevelCompleted()) continue;
        if (at()) {
          const moves: SolverAction[] = [action];
          for (let i = head; i > 0; i = parents[i]) moves.push(via[i] as SolverAction);
          return { moves: moves.reverse(), statesExplored: states.length, truncated: false };
        }
        const key = this.stateKey(engine, cells, base);
        if (seen.has(key)) continue;
        seen.add(key);
        const state = engine.captureState();
        states.push(state);
        parents.push(head);
        via.push(action);
        depth.push(depth[head] + 1);
        open.push(states.length - 1, depth[head] + 1 + this.distanceLeft(state, target), depth[head] + 1);
        if (states.length >= maxStates) {
          return { moves: null, statesExplored: states.length, truncated: true };
        }
      }
    }
    return { moves: null, statesExplored: states.length, truncated: false };
  }

  /** Fewest moves from the state's player to `target` on an open grid: a bound the search orders by. */
  private static distanceLeft(state: UndoSnapshot, target: GridPoint): number {
    return Math.abs(state.player.x - target.x) + Math.abs(state.player.y - target.y);
  }

  /**
   * Whether a move from `from` is refused without any side effect: the target
   * tile cannot be entered and neither reveals, unlocks nor opens anything.
   * Such a move would be discarded by the search, so it is not even played.
   */
  private static isPlainlyBlocked(from: UndoSnapshot, dir: Direction): boolean {
    const vec = DIRECTION_VECTORS[dir];
    const tile = ConfigRegistry.getTile(from.terrain[from.player.y + vec.dy][from.player.x + vec.dx]);
    return !tile.passableByPlayer && !tile.revealsToOnTouch && !tile.requiresAllChips && !tile.requiredKey;
  }

  /** A refused move can still reveal a hidden wall. */
  private static terrainChanged(engine: GameEngine, before: UndoSnapshot): boolean {
    const after = engine.getTerrain();
    return after.some((row, y) => row.some((id, x) => id !== before.terrain[y][x]));
  }

  /**
   * Player cell, inventory, chips left, monsters with facing and move timer,
   * and only the region cells that differ from the search's base state.
   */
  private static stateKey(engine: GameEngine, cells: GridPoint[], base: UndoSnapshot): string {
    const player = engine.getPlayer();
    const terrain = engine.getTerrain();
    const items = engine.getItems();
    const baseTerrain = base.terrain;
    const baseItems = base.items;
    let changed = '';
    for (let i = 0; i < cells.length; i++) {
      const x = cells[i].x;
      const y = cells[i].y;
      if (terrain[y][x] !== baseTerrain[y][x]) changed += `t${x},${y}=${terrain[y][x]};`;
      if (items[y][x] !== baseItems[y][x]) changed += `i${x},${y}=${items[y][x] ?? ''};`;
    }
    const held: string[] = [];
    for (const id in player.keys) {
      if (player.keys[id] > 0) held.push(`${id},${player.keys[id]}`);
    }
    const keys = held.length > 1 ? held.sort().join() : held.join();
    const entities: string[] = [];
    for (const e of engine.getEntities()) {
      entities.push(e.kind === 'monster' ? `${e.type}@${e.x},${e.y},${e.dir},${e.cooldownTicks}` : `${e.type}@${e.x},${e.y}`);
    }
    entities.sort();
    return `${player.x},${player.y}|${keys}|${[...player.boots].sort().join()}|${engine.getChipsRemaining()}|${entities.join(';')}|${changed}`;
  }

  /** Plays the moves in the real level: the player must end on the last target with every target collected. */
  private static confirmInLevel(engine: GameEngine, moves: SolverAction[], targets: GridPoint[]): boolean {
    const start = engine.captureState();
    try {
      for (const action of moves) {
        if (!PieceSolver.play(engine, action)) return false;
      }
      const last = targets[targets.length - 1];
      const player = engine.getPlayer();
      if (last && (player.x !== last.x || player.y !== last.y)) return false;
      const items = engine.getItems();
      return targets.every(({ x, y }) => {
        const item = items[y][x];
        return !item || ConfigRegistry.getTile(item).collectible !== 'chip';
      });
    } finally {
      engine.restoreState(start);
    }
  }

  private static cellKey(x: number, y: number): string {
    return `${x},${y}`;
  }
}
