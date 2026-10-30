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
import { ORDERED_DIRECTIONS } from '../config/constants';
import { GameEngine } from '../core/GameEngine';
import { CompiledLevel, GridPoint, RuntimeEntity, UndoSnapshot } from '../core/types';
import { PieceSolver, SolverAction, WAIT_ACTION } from './PieceSolver';

const WALL_TILE_ID = 'wall';
const REGION_LEVEL_PASSWORD = 'REGN';
/** Default bound on states explored by one region search (one target). */
export const DEFAULT_MAX_REGION_STATES = 20000;

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
    const local = this.buildIsolated(start);
    const moves: SolverAction[] = [];
    let total = 0;
    for (const target of targets) {
      const legStart = local.captureState();
      const leg = this.search(local, start.cells, target, maxStates);
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

  /** Engine of the same size as the level where everything but the region is wall. */
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

  /** Breadth-first search to `target` from the engine's current state; the engine is left in any state. */
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
    const seen = new Set<string>([this.stateKey(engine, cells, base)]);

    for (let head = 0; head < states.length; head++) {
      for (const action of actions) {
        const from = states[head];
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
        states.push(engine.captureState());
        parents.push(head);
        via.push(action);
        if (states.length >= maxStates) {
          return { moves: null, statesExplored: states.length, truncated: true };
        }
      }
    }
    return { moves: null, statesExplored: states.length, truncated: false };
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
    const changed: string[] = [];
    for (const { x, y } of cells) {
      if (terrain[y][x] !== base.terrain[y][x]) changed.push(`t${x},${y}=${terrain[y][x]}`);
      if (items[y][x] !== base.items[y][x]) changed.push(`i${x},${y}=${items[y][x] ?? ''}`);
    }
    const entities = engine
      .getEntities()
      .map((e) =>
        e.kind === 'monster' ? `${e.type}@${e.x},${e.y},${e.dir},${e.cooldownTicks}` : `${e.type}@${e.x},${e.y}`
      )
      .sort();
    return [
      `${player.x},${player.y}`,
      Object.entries(player.keys)
        .filter(([, count]) => count > 0)
        .sort()
        .join(),
      [...player.boots].sort().join(),
      String(engine.getChipsRemaining()),
      entities.join(';'),
      changed.join(';')
    ].join('|');
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
