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
import { CC2_TEETH_PHASE_OFFSET, CC_TEETH_CYCLE_TICKS, teethCycleOf, teethMayDecide } from '../coreConstants';
import { GameEngine } from '../GameEngine';
import type { Cc2LevelData, CompiledLevel } from '../types';

beforeEach(() => {
  loadTestConfigs();
});

const CC2_RECORD = { v: 1, sha256: 'ab'.repeat(32), file: 'one.c2m', order: 1, gridHash: 'x' } as Cc2LevelData;
const CORRIDOR = ['######################', '#...................@#', '######################'];
const MIMIC_CYCLE = 16;
const MIMIC_FIRST_DECISION_CLOCK = MIMIC_CYCLE - CC2_TEETH_PHASE_OFFSET;
const TEETH_FIRST_DECISION_CLOCK = CC_TEETH_CYCLE_TICKS - CC2_TEETH_PHASE_OFFSET;
const TICKS = MIMIC_FIRST_DECISION_CLOCK + 3;

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

describe('floor mimic decision cycle on the CC2 engine', () => {
  it('reads the cycle of the monster own type, the teeth keeping 8', () => {
    // Lexy tiletypes.js:245-249, 2967-2971: pursue_player decides by me.type.movement_parity * 4.
    expect(teethCycleOf('floor_mimic', true)).toBe(MIMIC_CYCLE);
    expect(teethCycleOf('teeth', true)).toBe(CC_TEETH_CYCLE_TICKS);
    expect(teethCycleOf('floor_mimic', false)).toBe(CC_TEETH_CYCLE_TICKS);
  });

  it('decides only when (clock + 5) mod 16 < 4', () => {
    const decides = Array.from({ length: MIMIC_CYCLE }, (_, c) => c).filter((c) => teethMayDecide(c, true, MIMIC_CYCLE));
    expect(decides).toEqual([11, 12, 13, 14]);
  });

  it('a floor mimic of a CC2 level first moves at the clock its cycle opens', () => {
    const cells = xs(level('floor_mimic', 'cc2'));
    expect(cells.slice(0, MIMIC_FIRST_DECISION_CLOCK)).toEqual(new Array(MIMIC_FIRST_DECISION_CLOCK).fill(1));
    expect(cells[MIMIC_FIRST_DECISION_CLOCK]).toBe(2);
  });

  it('leaves the teeth on their cycle of 8 on a CC2 level', () => {
    expect(xs(level('teeth', 'cc2'))[TEETH_FIRST_DECISION_CLOCK]).toBe(2);
  });

  it('leaves a cc-flavour and a native level off the CC2 cycle', () => {
    expect(xs(level('floor_mimic', 'cc'))).not.toEqual(xs(level('floor_mimic', 'cc2')));
    expect(xs(level('floor_mimic', 'native'))).not.toEqual(xs(level('floor_mimic', 'cc2')));
  });
});
