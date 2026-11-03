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
import type { CompiledLevel, Direction } from '../types';
import { STEP_TICKS } from './cc3dConstants';
import { Cc3dRig } from './cc3dTestRig';

/**
 * Test helper: a hash of a fixed play-through of a level, to prove that a refactor leaves the simulation
 * unchanged. It only uses what the engine exposed before the refactors, so the same file can be run against
 * an older checkout to produce the reference hashes.
 */

const SIMULATION_SEED = 1;
const IDLE_TICKS = 12;
const SCRIPT_STEPS = 72;
const SCRIPT_DIRECTIONS: readonly Direction[] = ['N', 'E', 'S', 'W'];

/** SHA-256 of the state after the idle ticks and after each scripted step: player, mobs, terrain, tick, wins. */
export function simulationHash(level: CompiledLevel): string {
  const hash = createHash('sha256');
  try {
    const rig = new Cc3dRig(level, SIMULATION_SEED);
    const record = (): void => {
      hash.update(
        JSON.stringify({
          tick: rig.engine.getTick(),
          player: rig.player,
          entities: rig.entities,
          terrain: rig.engine.getTerrain(),
          wins: rig.wins.length
        })
      );
    };
    rig.tick(IDLE_TICKS);
    record();
    for (let step = 0; step < SCRIPT_STEPS; step++) {
      rig.press(SCRIPT_DIRECTIONS[step % SCRIPT_DIRECTIONS.length]);
      rig.tick(STEP_TICKS.normal);
      record();
    }
  } catch (error) {
    hash.update(`throw:${error instanceof Error ? error.message : String(error)}`);
  }
  return hash.digest('hex');
}
