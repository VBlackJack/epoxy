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

import { AudioManager } from '../audio/AudioManager';
import { GameEngine } from '../core/GameEngine';
import { DIRECTION_VECTORS, ORDERED_DIRECTIONS } from '../config/constants';
import { ConfigRegistry } from '../config/ConfigRegistry';
import { CompiledLevel, Direction, GridPoint } from '../core/types';
import { RouteSegment } from './LevelAssembler';
import { PieceSolver, SolverAction } from './PieceSolver';
import { DEFAULT_MAX_REGION_STATES, RegionSolver } from './RegionSolver';
import { helpfulItems } from './PieceCompiler';
import { CompiledPiece } from './PieceTypes';

export interface LevelProof {
  solved: boolean;
  /** The full winning action list, start to exit. */
  moves: SolverAction[];
  /** Engine ticks the winning run takes, used to set the time limit. */
  ticks: number;
  /** Distinct cells the player stood on during the run. */
  visitedCells: number;
  /** Actions spent walking between pieces: corridors, hub floor, detours for items. */
  walkMoves: number;
  /** Actions spent solving the pieces themselves. */
  pieceMoves: number;
  /** States explored by timed region searches in the open monster area (0 without one). */
  regionStates: number;
}

/** Solutions per oriented piece and starting inventory; pieces repeat across levels. */
const solutionCache = new Map<string, SolverAction[] | null>();

export function resetProverCache(): void {
  solutionCache.clear();
}

/**
 * Proves a generated level by playing it. The route alternates corridor walks
 * and pieces; each piece is solved on the spot for the inventory the player
 * actually holds when reaching it (boots change how ice and force floors
 * behave, so a solution found without them may not apply). A piece with
 * monsters is solved inside the running level, from wherever its monsters
 * have moved by the time the player arrives. A block one piece pushes out is
 * pushed along its lane and must rest on the next piece's entry port before
 * that piece is solved; a key one piece collects is simply carried. The level
 * counts as proven only if the run ends on the exit with every chip collected.
 *
 * With an open region (cells where monsters wander), a goto step whose path
 * crosses that region while it holds a monster is not walked from a frozen
 * snapshot: the stretch inside the region is a timed search from the engine's
 * current state, whatever the tick the player arrives at. A failed search
 * fails the proof.
 */
export class LevelProver {
  public static prove(level: CompiledLevel, route: RouteSegment[], openRegion: GridPoint[] = []): LevelProof {
    return AudioManager.runSilently(() => this.play(level, route, openRegion));
  }

  private static play(level: CompiledLevel, route: RouteSegment[], openRegion: GridPoint[]): LevelProof {
    const engine = new GameEngine();
    engine.loadLevel(level);
    const moves: SolverAction[] = [];
    let pieceMoves = 0;
    let regionStates = 0;
    const visited = new Set<number>();
    const width = level.terrain[0].length;
    const regionKeys = new Set(openRegion.map((c) => c.y * width + c.x));
    const track = (): void => {
      const p = engine.getPlayer();
      visited.add(p.y * width + p.x);
    };
    track();
    const failed = (): LevelProof => ({
      solved: false,
      moves,
      ticks: engine.getTick(),
      visitedCells: visited.size,
      walkMoves: moves.length - pieceMoves,
      pieceMoves,
      regionStates
    });

    for (const segment of route) {
      if (segment.kind === 'goto') {
        if (this.regionHasMonster(engine, regionKeys, width)) {
          const outcome = this.gotoThroughRegion(engine, segment.target, regionKeys, openRegion, moves, track);
          regionStates += outcome.states;
          if (!outcome.ok) return failed();
          continue;
        }
        const path = this.safePath(engine, segment.target);
        if (!path) return failed();
        for (const dir of path) {
          if (!engine.attemptPlayerMove(dir) || !PieceSolver.settle(engine)) return failed();
          moves.push(dir);
          track();
        }
        continue;
      }
      if (segment.kind === 'piece' && segment.towards === 'entry') {
        const back = this.calmWayBack(engine, segment.piece, segment.origin);
        const backMoves = back ?? PieceSolver.solveInLevel(engine, segment.piece, segment.origin, undefined, 'entry').moves;
        if (!backMoves) return failed();
        for (const action of backMoves) {
          if (!PieceSolver.play(engine, action)) return failed();
          moves.push(action);
          pieceMoves++;
          track();
        }
        continue;
      }
      if (segment.kind === 'walk') {
        for (const dir of segment.moves) {
          if (!engine.attemptPlayerMove(dir) || !PieceSolver.settle(engine)) return failed();
          moves.push(dir);
          track();
        }
        continue;
      }
      if (segment.kind === 'push') {
        for (const dir of segment.moves) {
          if (!engine.attemptPlayerMove(dir) || !PieceSolver.settle(engine)) return failed();
          moves.push(dir);
          pieceMoves++;
          track();
        }
        const rests = engine
          .getEntities()
          .some((e) => e.kind === 'block' && e.x === segment.block.x && e.y === segment.block.y);
        if (!rests) return failed();
        continue;
      }

      const solution = this.solutionFor(segment.piece, segment.origin, engine);
      if (!solution) return failed();
      for (const action of solution) {
        // Some winning moves are refused yet change the board (a hidden wall shows up).
        if (!PieceSolver.play(engine, action)) return failed();
        moves.push(action);
        pieceMoves++;
        track();
      }
      if (segment.isFinale) break;
      const player = engine.getPlayer();
      const exit = { x: segment.origin.x + segment.piece.exit.x, y: segment.origin.y + segment.piece.exit.y };
      if (player.x !== exit.x || player.y !== exit.y) return failed();
    }

    const solved = engine.isLevelCompleted() && engine.getChipsRemaining() === 0;
    return {
      solved,
      moves,
      ticks: engine.getTick(),
      visitedCells: visited.size,
      walkMoves: moves.length - pieceMoves,
      pieceMoves,
      regionStates
    };
  }

  /** True when a monster stands in the open region right now. */
  private static regionHasMonster(engine: GameEngine, regionKeys: Set<number>, width: number): boolean {
    if (regionKeys.size === 0) return false;
    return engine.getEntities().some((e) => e.kind === 'monster' && regionKeys.has(e.y * width + e.x));
  }

  /**
   * Walks to `target` when the way crosses the monster region. The route is
   * planned on terrain alone (region monsters ignored); stretches outside the
   * region are walked, and each stretch inside it is a timed search from the
   * live engine state to the stretch's last cell. Every region search is
   * bounded by DEFAULT_MAX_REGION_STATES; a null or truncated one fails.
   */
  private static gotoThroughRegion(
    engine: GameEngine,
    target: GridPoint,
    regionKeys: Set<number>,
    openRegion: GridPoint[],
    moves: SolverAction[],
    track: () => void
  ): { ok: boolean; states: number } {
    const width = engine.getTerrain()[0].length;
    const inRegion = (x: number, y: number): boolean => regionKeys.has(y * width + x);
    const path = this.safePath(engine, target, (e) => e.kind === 'monster' && inRegion(e.x, e.y));
    if (!path) return { ok: false, states: 0 };
    let states = 0;
    let i = 0;
    const cursor = { ...engine.getPlayer() };
    const advance = (dir: Direction): void => {
      cursor.x += DIRECTION_VECTORS[dir].dx;
      cursor.y += DIRECTION_VECTORS[dir].dy;
    };
    while (i < path.length) {
      const inside = inRegion(cursor.x, cursor.y);
      const next = { x: cursor.x + DIRECTION_VECTORS[path[i]].dx, y: cursor.y + DIRECTION_VECTORS[path[i]].dy };
      if (inside && inRegion(next.x, next.y)) {
        // Last cell of the stretch that stays inside the region.
        let end = i;
        const probe = { x: cursor.x, y: cursor.y };
        while (end < path.length) {
          probe.x += DIRECTION_VECTORS[path[end]].dx;
          probe.y += DIRECTION_VECTORS[path[end]].dy;
          if (!inRegion(probe.x, probe.y)) break;
          end++;
        }
        const goal = { x: cursor.x, y: cursor.y };
        for (let k = i; k < end; k++) {
          goal.x += DIRECTION_VECTORS[path[k]].dx;
          goal.y += DIRECTION_VECTORS[path[k]].dy;
        }
        const result = RegionSolver.solveRegion(
          engine,
          RegionSolver.startFrom(engine, openRegion),
          goal,
          DEFAULT_MAX_REGION_STATES
        );
        states += result.statesExplored;
        if (!result.moves) return { ok: false, states };
        for (const action of result.moves) {
          if (!PieceSolver.play(engine, action)) return { ok: false, states };
          moves.push(action);
          track();
        }
        const player = engine.getPlayer();
        cursor.x = player.x;
        cursor.y = player.y;
        i = end;
        continue;
      }
      const dir = path[i];
      if (!engine.attemptPlayerMove(dir) || !PieceSolver.settle(engine)) return { ok: false, states };
      moves.push(dir);
      track();
      advance(dir);
      i++;
    }
    return { ok: true, states };
  }

  /**
   * The way out of a solved piece, when plain walking does it: the shortest
   * calm path to the entry port, trial-played on a saved state so the engine
   * is left as found. Null when monsters move in the piece or the walk
   * disturbs anything; the caller then searches the whole state space.
   */
  private static calmWayBack(engine: GameEngine, piece: CompiledPiece, origin: GridPoint): Direction[] | null {
    if (PieceSolver.hasMonsters(piece)) return null;
    const target = { x: origin.x + piece.entry.x, y: origin.y + piece.entry.y };
    const path = this.safePath(engine, target);
    if (!path) return null;
    const saved = engine.captureState();
    let arrived = true;
    for (const dir of path) {
      if (!engine.attemptPlayerMove(dir) || !PieceSolver.settle(engine)) {
        arrived = false;
        break;
      }
    }
    const player = engine.getPlayer();
    arrived = arrived && player.x === target.x && player.y === target.y;
    engine.restoreState(saved);
    return arrived ? path : null;
  }

  /**
   * Shortest path to a cell over ground the player can cross calmly: floor
   * and the like, doors the player holds a key for, hazards the player has
   * boots for. Cells holding an item, buttons, tiles that change when stepped
   * on, teleporters, traps and occupied cells are avoided on the way, so the
   * walk cannot surprise; the target itself is exempt from the first three.
   * Null when no such path exists.
   */
  private static safePath(
    engine: GameEngine,
    target: GridPoint,
    ignoreEntity: (entity: ReturnType<GameEngine['getEntities']>[number]) => boolean = () => false
  ): Direction[] | null {
    const terrain = engine.getTerrain();
    const items = engine.getItems();
    const player = engine.getPlayer();
    const height = terrain.length;
    const width = terrain[0].length;
    const occupied = new Set(engine.getEntities().filter((e) => !ignoreEntity(e)).map((e) => e.y * width + e.x));
    const crossable = (x: number, y: number): boolean => {
      if (x < 0 || y < 0 || x >= width || y >= height || occupied.has(y * width + x)) return false;
      const tile = ConfigRegistry.getTile(terrain[y][x]);
      const item = items[y][x];
      // Anything lying on a cell would be picked up, and a cell with a side effect
      // (buttons, tiles that change when stepped on) would change the level. Only
      // the target itself may do either: the caller walks there on purpose.
      const isTarget = x === target.x && y === target.y;
      if (!isTarget && (item || tile.buttonAction || tile.transformsToOnStep)) return false;
      if (item && ConfigRegistry.getTile(item).hazard) return false;
      if (tile.isTeleporter || tile.isTrap || tile.stealsBoots) return false;
      const protectedBy = tile.protectedByItem;
      if (tile.slideType || tile.hazard) return Boolean(protectedBy && player.boots.has(protectedBy));
      if (tile.requiredKey) return (player.keys[tile.requiredKey] ?? 0) > 0;
      if (tile.requiresAllChips) return engine.getChipsRemaining() === 0;
      return tile.passableByPlayer === true;
    };
    const start = player.y * width + player.x;
    const goal = target.y * width + target.x;
    const parent = new Map<number, { from: number; dir: Direction }>();
    const queue = [start];
    const seen = new Set([start]);
    for (let i = 0; i < queue.length; i++) {
      const cell = queue[i];
      if (cell === goal) {
        const path: Direction[] = [];
        for (let k = goal; k !== start; k = (parent.get(k) as { from: number }).from) {
          path.push((parent.get(k) as { dir: Direction }).dir);
        }
        return path.reverse();
      }
      const x = cell % width;
      const y = Math.floor(cell / width);
      for (const dir of ORDERED_DIRECTIONS) {
        const nx = x + DIRECTION_VECTORS[dir].dx;
        const ny = y + DIRECTION_VECTORS[dir].dy;
        const next = ny * width + nx;
        if (seen.has(next) || !crossable(nx, ny)) continue;
        seen.add(next);
        parent.set(next, { from: cell, dir });
        queue.push(next);
      }
    }
    return null;
  }

  private static solutionFor(
    piece: CompiledPiece,
    origin: GridPoint,
    engine: GameEngine
  ): SolverAction[] | null {
    if (PieceSolver.hasMonsters(piece)) {
      return PieceSolver.solveInLevel(engine, piece, origin).moves;
    }
    const player = engine.getPlayer();
    const carried = [
      ...[...player.boots].sort(),
      ...Object.entries(player.keys)
        .filter(([, count]) => count > 0)
        .sort()
        .flatMap(([id, count]) => new Array<string>(count).fill(id))
    ];
    // A precomputed solution holds while what is carried acts on the piece exactly as
    // what it was solved with: its required boots and imported key, nothing more.
    const helpful = helpfulItems(piece);
    const acting = (ids: string[]): string => ids.filter((id) => helpful.has(id)).sort().join();
    if (piece.solution && acting(carried) === acting(PieceSolver.defaultCarried(piece))) return piece.solution;
    const { quarterTurns, mirrored } = piece.orientation;
    const cacheKey = `${piece.id}|${quarterTurns}|${mirrored}|${carried.join()}`;
    if (!solutionCache.has(cacheKey)) {
      solutionCache.set(cacheKey, PieceSolver.solve(piece, { carried }).moves);
    }
    return solutionCache.get(cacheKey) ?? null;
  }
}
