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

import { createHash } from 'node:crypto';
import { collectDueMoves } from '../ui/replaySchedule';
import { timedSolution } from '../generator/SolutionReplay';
import { GameEngine } from './GameEngine';
import type { CompiledLevel, Direction } from './types';

/**
 * Test helper: a hash of fixed play-throughs of a level on the native Epoxy engine, to prove that a refactor
 * of GameEngine leaves the simulation unchanged. It only uses public methods that exist before the refactor,
 * so the same file can be run against an older checkout to produce the reference hashes. The stored-solution replay\n * mirrors src/generator/SolutionReplay.test.ts (seed derived from the level id, same tick cap).
 */

export type EngineScript = 'solution' | 'scripted';

export const ENGINE_SCRIPTS: readonly EngineScript[] = ['solution', 'scripted'];

/** Seed of the scripted play. The stored-solution replay passes no seed, as the game does. */
const SCRIPTED_SEED = 1;
/** Upper bound on ticks a stored-solution replay may take, same as SolutionReplay.test.ts. */
const MAX_REPLAY_TICKS = 200000;
const IDLE_TICKS = 20;
const TICKS_PER_STEP = 4;
const SCRIPT_STEPS = 95;
/** Every this many steps (counting from one), the scripted play undoes once. */
const UNDO_EVERY_STEPS = 17;
const SCRIPT_DIRECTIONS: readonly Direction[] = ['N', 'E', 'S', 'W', 'N', 'N', 'E', 'E', 'S', 'S', 'W', 'W'];

export interface EngineRun {
  hash: string;
  /** Solution script only: the level has a stored solution. */
  hasSolution: boolean;
  /** Solution script only: the replay completed the level with no chip left. */
  won: boolean;
}

/** JSON with object keys sorted recursively, so key creation order cannot change a hash. Undefined fields are dropped. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => (item === undefined ? 'null' : stableStringify(item))).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const parts = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`);
    return `{${parts.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** Plays a fixed script on the engine and hashes the full public state after load, every tick and every undo. */
export function engineSimulationRun(level: CompiledLevel, script: EngineScript): EngineRun {
  const hash = createHash('sha256');
  let hasSolution = false;
  let won = false;
  try {
    const engine = new GameEngine();
    if (script === 'solution') engine.loadLevel(level);
    else engine.loadLevel(level, SCRIPTED_SEED);
    const record = (): void => {
      hash.update(
        stableStringify({
          tick: engine.getTick(),
          player: engine.getPlayer(),
          entities: engine.getEntities(),
          terrain: engine.getTerrain(),
          items: engine.getItems(),
          chips: engine.getChipsRemaining(),
          completed: engine.isLevelCompleted(),
          beams: engine.getBeamCells(),
          lit: engine.getLitReceivers(),
          held: engine.getHeldItems(),
          time: engine.getTimeRemainingSeconds(),
          trapLinks: engine.getTrapLinks(),
          cloneLinks: engine.getCloneLinks(),
          // Undefined (and so left out of the hash) on a level without launchers.
          shots: engine.getShots(),
          // Undefined (and so left out of the hash) on a level without a toggle wall under a removable top.
          toggleParity: engine.getToggleParity(),
          steps: engine.getStepsCount(),
          score: engine.getTotalScore(),
          extraTime: engine.getExtraTimeSeconds(),
          banner: engine.getStatusBannerKey(),
          timedMoves: engine.getTimedMoveHistory(),
          targets: engine.getTargetsProgress(),
          scoreMultiplier: engine.getLevelScoreMultiplier(),
          bonusPoints: engine.getLevelBonusPoints(),
          paused: engine.isPaused(),
          canUndo: engine.canUndo()
        })
      );
    };
    const tickAndRecord = (): void => {
      engine.tick();
      record();
    };
    record();
    if (script === 'solution') {
      const moves = timedSolution(level);
      hasSolution = moves !== null;
      hash.update(`solution:${moves === null ? 'none' : moves.length}`);
      if (moves !== null) {
        let index = 0;
        for (let i = 0; i < MAX_REPLAY_TICKS && !engine.isLevelCompleted(); i++) {
          const { due, nextIndex } = collectDueMoves(moves, index, engine.getTick());
          for (const move of due) engine.attemptPlayerMove(move.dir);
          index = nextIndex;
          tickAndRecord();
          if (!engine.getPlayer().alive) break;
        }
        won = engine.isLevelCompleted() && engine.getChipsRemaining() === 0;
        hash.update(`won:${won}`);
      }
    } else {
      for (let i = 0; i < IDLE_TICKS; i++) tickAndRecord();
      for (let step = 0; step < SCRIPT_STEPS; step++) {
        engine.attemptPlayerMove(SCRIPT_DIRECTIONS[step % SCRIPT_DIRECTIONS.length]);
        for (let i = 0; i < TICKS_PER_STEP; i++) tickAndRecord();
        if ((step + 1) % UNDO_EVERY_STEPS === 0) {
          hash.update(`undo:${engine.undo()}`);
          record();
        }
      }
    }
  } catch (error) {
    hash.update(`throw:${error instanceof Error ? error.message : String(error)}`);
  }
  return { hash: hash.digest('hex'), hasSolution, won };
}

/** SHA-256 of the engine state after load and after every tick of the chosen script. */
export function engineSimulationHash(level: CompiledLevel, script: EngineScript): string {
  return engineSimulationRun(level, script).hash;
}