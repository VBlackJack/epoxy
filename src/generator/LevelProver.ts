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
import { CompiledLevel, GridPoint } from '../core/types';
import { RouteSegment } from './LevelAssembler';
import { PieceSolver, SolverAction } from './PieceSolver';
import { CompiledPiece } from './PieceTypes';

export interface LevelProof {
  solved: boolean;
  /** The full winning action list, start to exit. */
  moves: SolverAction[];
  /** Engine ticks the winning run takes, used to set the time limit. */
  ticks: number;
  /** Distinct cells the player stood on during the run. */
  visitedCells: number;
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
 * have moved by the time the player arrives. The level counts as proven
 * only if the run ends on the exit with every chip collected.
 */
export class LevelProver {
  public static prove(level: CompiledLevel, route: RouteSegment[]): LevelProof {
    return AudioManager.runSilently(() => this.play(level, route));
  }

  private static play(level: CompiledLevel, route: RouteSegment[]): LevelProof {
    const engine = new GameEngine();
    engine.loadLevel(level);
    const moves: SolverAction[] = [];
    const visited = new Set<number>();
    const width = level.terrain[0].length;
    const track = (): void => {
      const p = engine.getPlayer();
      visited.add(p.y * width + p.x);
    };
    track();
    const failed = (): LevelProof => ({
      solved: false,
      moves,
      ticks: engine.getTick(),
      visitedCells: visited.size
    });

    for (const segment of route) {
      if (segment.kind === 'walk') {
        for (const dir of segment.moves) {
          if (!engine.attemptPlayerMove(dir) || !PieceSolver.settle(engine)) return failed();
          moves.push(dir);
          track();
        }
        continue;
      }

      const solution = this.solutionFor(segment.piece, segment.origin, engine);
      if (!solution) return failed();
      for (const action of solution) {
        // Some winning moves are refused yet change the board (a hidden wall shows up).
        if (!PieceSolver.play(engine, action)) return failed();
        moves.push(action);
        track();
      }
      if (segment.isFinale) break;
      const player = engine.getPlayer();
      const exit = { x: segment.origin.x + segment.piece.exit.x, y: segment.origin.y + segment.piece.exit.y };
      if (player.x !== exit.x || player.y !== exit.y) return failed();
    }

    const solved = engine.isLevelCompleted() && engine.getChipsRemaining() === 0;
    return { solved, moves, ticks: engine.getTick(), visitedCells: visited.size };
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
    const { quarterTurns, mirrored } = piece.orientation;
    const cacheKey = `${piece.id}|${quarterTurns}|${mirrored}|${carried.join()}`;
    if (!solutionCache.has(cacheKey)) {
      solutionCache.set(cacheKey, PieceSolver.solve(piece, { carried }).moves);
    }
    return solutionCache.get(cacheKey) ?? null;
  }
}
