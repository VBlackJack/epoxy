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
import { CC2_TEETH_PHASE_OFFSET, CC_TEETH_ACTIVE_TICKS, CC_TEETH_CYCLE_TICKS, teethMayDecide } from '../coreConstants';
import { GameEngine } from '../GameEngine';
import type { Cc2LevelData, CompiledLevel } from '../types';

beforeEach(() => {
  loadTestConfigs();
});

const CC2_RECORD = { v: 1, sha256: 'ab'.repeat(32), file: 'one.c2m', order: 1, gridHash: 'x' } as Cc2LevelData;
const CORRIDOR = ['####################', '#.................@#', '####################'];
const TICKS = 17;

type Mode = 'cc2' | 'cc' | 'native';

function level(type: string, mode: Mode): CompiledLevel {
  const built = buildTestLevel(CORRIDOR, { entities: [{ type, x: 1, y: 1, dir: 'E' }] });
  if (mode === 'cc2') return { ...built, cc2: CC2_RECORD };
  if (mode === 'cc') return { ...built, rulesFlavor: 'cc' };
  return built;
}

/** The monster's column after each tick, the player standing still. */
function xs(lvl: CompiledLevel): number[] {
  const engine = new GameEngine();
  engine.loadLevel(lvl);
  const w = (engine as unknown as { w: { entities: { kind: string; x: number }[] } }).w;
  const out: number[] = [];
  for (let t = 0; t < TICKS; t++) {
    engine.tick();
    out.push(w.entities.find((e) => e.kind === 'monster')?.x ?? -1);
  }
  return out;
}

describe('teethMayDecide', () => {
  it('keeps the plain cycle off a CC2 level', () => {
    for (let clock = 0; clock < 2 * CC_TEETH_CYCLE_TICKS; clock++) {
      expect(teethMayDecide(clock, false)).toBe(clock % CC_TEETH_CYCLE_TICKS < CC_TEETH_ACTIVE_TICKS);
    }
  });

  it('shifts the cycle by the CC2 offset on a CC2 level', () => {
    for (let clock = 0; clock < 2 * CC_TEETH_CYCLE_TICKS; clock++) {
      expect(teethMayDecide(clock, true)).toBe((clock + CC2_TEETH_PHASE_OFFSET) % CC_TEETH_CYCLE_TICKS < CC_TEETH_ACTIVE_TICKS);
    }
    expect([0, 1, 2, 3, 4, 5, 6, 7].filter((c) => teethMayDecide(c, true))).toEqual([3, 4, 5, 6]);
  });
});

describe('CC2 teeth phase', () => {
  it('teeth first decide on the fourth tick of a CC2 level', () => {
    const cells = xs(level('teeth', 'cc2'));
    expect(cells.slice(0, 3)).toEqual([1, 1, 1]);
    expect(cells[3]).toBe(2);
  });

  it('leaves teeth deciding at the first tick on a cc-flavour level', () => {
    expect(xs(level('teeth', 'cc')).slice(0, 2)).toEqual([2, 2]);
  });

  it('leaves a native level on its own cadence', () => {
    expect(xs(level('teeth', 'native'))).not.toEqual(xs(level('teeth', 'cc2')));
  });
});
