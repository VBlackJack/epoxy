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
 * so the same file can be run against an older checkout to produce the reference hashes.
 */

export type EngineScript = 'solution' | 'scripted';

export const ENGINE_SCRIPTS: readonly EngineScript[] = ['solution', 'scripted'];

const SIMULATION_SEED = 1;
/** Upper bound on ticks a stored-solution replay may take. */
const SOLUTION_TICK_CAP = 20000;
const IDLE_TICKS = 20;
const TICKS_PER_STEP = 4;
const SCRIPT_STEPS = 95;
/** Every this many steps (counting from one), the scripted play undoes once. */
const UNDO_EVERY_STEPS = 17;
const SCRIPT_DIRECTIONS: readonly Direction[] = ['N', 'E', 'S', 'W', 'N', 'N', 'E', 'E', 'S', 'S', 'W', 'W'];

/** SHA-256 of the engine state after every tick of the chosen script. */
export function engineSimulationHash(level: CompiledLevel, script: EngineScript): string {
  const hash = createHash('sha256');
  try {
    const engine = new GameEngine();
    engine.loadLevel(level, SIMULATION_SEED);
    const record = (): void => {
      hash.update(
        JSON.stringify({
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
          time: engine.getTimeRemainingSeconds()
        })
      );
    };
    const tickAndRecord = (): void => {
      engine.tick();
      record();
    };
    if (script === 'solution') {
      const moves = timedSolution(level);
      hash.update(`solution:${moves === null ? 'none' : moves.length}`);
      if (moves !== null) {
        let index = 0;
        for (let i = 0; i < SOLUTION_TICK_CAP && !engine.isLevelCompleted(); i++) {
          const { due, nextIndex } = collectDueMoves(moves, index, engine.getTick());
          for (const move of due) engine.attemptPlayerMove(move.dir);
          index = nextIndex;
          tickAndRecord();
          if (!engine.getPlayer().alive) break;
        }
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
  return hash.digest('hex');
}
