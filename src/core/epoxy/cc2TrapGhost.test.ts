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

import { beforeEach, describe, expect, it } from 'vitest';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { buildTestLevel } from '../../test/buildTestLevel';
import { CC_MONSTER_STEP_TICKS } from '../coreConstants';
import { GameEngine } from '../GameEngine';
import type { Cc2LevelData, CompiledLevel, Direction } from '../types';

beforeEach(() => {
  loadTestConfigs();
});

const CC2_RECORD = { v: 1, sha256: 'ab'.repeat(32), file: 'one.c2m', order: 1, gridHash: 'x' } as Cc2LevelData;
const STEEL = 'steel_wall';
const TRAP_X = 3;
const TRAP_ROW_Y = 1;
const RUN_STEPS = 4;
const RUN_TICKS = RUN_STEPS * CC_MONSTER_STEP_TICKS;

interface TestWorld {
  entities: { kind: string; x: number }[];
}

/** An unconnected (so closed) brown trap with a wall right behind it in the monster's facing (east). */
function trapLevel(type: string): CompiledLevel {
  const built = buildTestLevel(['##########', '#@.X.....#', '##########'], {
    entities: [{ type, x: TRAP_X, y: TRAP_ROW_Y, dir: 'E' as Direction }]
  });
  built.terrain[TRAP_ROW_Y][TRAP_X + 1] = STEEL;
  return { ...built, cc2: CC2_RECORD };
}

/** The monster's column after each of `ticks` ticks. */
function columns(lvl: CompiledLevel, ticks: number): number[] {
  const engine = new GameEngine();
  engine.loadLevel(lvl);
  const w = (engine as unknown as { w: TestWorld }).w;
  const out: number[] = [];
  for (let t = 0; t < ticks; t++) {
    engine.tick();
    out.push(w.entities.find((e) => e.kind === 'monster')?.x ?? -1);
  }
  return out;
}

describe('CC2 closed trap and the cadence decision pass', () => {
  it('lets a ghost with its facing blocked turn and leave a closed trap', () => {
    const at = columns(trapLevel('ghost'), RUN_TICKS);
    expect(at[at.length - 1]).toBeLessThan(TRAP_X);
  });

  it('still holds a normal monster on the closed trap', () => {
    const at = columns(trapLevel('glider'), RUN_TICKS);
    expect(new Set(at)).toEqual(new Set([TRAP_X]));
  });
});
