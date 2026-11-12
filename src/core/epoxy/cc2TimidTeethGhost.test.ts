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
import { CC_MONSTER_STEP_TICKS, CC_TEETH_CYCLE_TICKS } from '../coreConstants';
import { GameEngine } from '../GameEngine';
import type { Cc2LevelData, CompiledLevel, Direction } from '../types';

beforeEach(() => {
  loadTestConfigs();
});

const CC2_RECORD = { v: 1, sha256: 'ab'.repeat(32), file: 'one.c2m', order: 1, gridHash: 'x' } as Cc2LevelData;
const STEEL = 'steel_wall';
const BOXED_TICKS = 3;

interface TestWorld {
  entities: { type: string; kind: string; x: number; y: number; dir: Direction }[];
}

type Mode = 'cc2' | 'cc' | 'plain';

function corridor(type: string, mode: Mode, dir: Direction = 'E'): CompiledLevel {
  const built = buildTestLevel(['####################', '#@..............#', '####################'], {
    entities: [{ type, x: 3, y: 1, dir }]
  });
  if (mode === 'cc2') return { ...built, cc2: CC2_RECORD };
  return mode === 'cc' ? { ...built, rulesFlavor: 'cc' } : built;
}

function monsterOf(engine: GameEngine): TestWorld['entities'][number] {
  const w = (engine as unknown as { w: TestWorld }).w;
  return w.entities.find((e) => e.kind === 'monster') as TestWorld['entities'][number];
}

/** The monster's column after each of `ticks` ticks. */
function columns(lvl: CompiledLevel, ticks: number): number[] {
  const engine = new GameEngine();
  engine.loadLevel(lvl);
  const out: number[] = [];
  for (let t = 0; t < ticks; t++) {
    engine.tick();
    out.push(monsterOf(engine).x);
  }
  return out;
}

describe('CC2 timid teeth and ghost use the classic cadence', () => {
  it('steps a ghost every classic step on a CC2 level', () => {
    const at = columns(corridor('ghost', 'cc2'), 2 * CC_MONSTER_STEP_TICKS + 1);
    expect(at.slice(0, CC_MONSTER_STEP_TICKS)).toEqual([4, 4, 4, 4]);
    expect(at[CC_MONSTER_STEP_TICKS]).toBe(5);
    expect(at[2 * CC_MONSTER_STEP_TICKS - 1]).toBe(5);
    expect(at[2 * CC_MONSTER_STEP_TICKS]).toBe(6);
  });

  it('keeps the ghost on its own interval on a native classic level', () => {
    const at = columns(corridor('ghost', 'cc'), CC_MONSTER_STEP_TICKS);
    expect(new Set(at).size).toBeGreaterThan(0);
    expect(at).not.toEqual([4, 4, 4, 4]);
  });

  it('moves timid teeth only in the first half of each teeth cycle on a CC2 level', () => {
    const at = columns(corridor('timid_teeth', 'cc2'), CC_TEETH_CYCLE_TICKS + 1);
    // The player stands at the west end, so the timid teeth flee east; they hold still through the idle half.
    const idle = at.slice(CC_MONSTER_STEP_TICKS, CC_TEETH_CYCLE_TICKS);
    expect(new Set(idle).size).toBe(1);
    expect(at[CC_TEETH_CYCLE_TICKS]).toBeGreaterThan(idle[0]);
  });

  it('does not give timid teeth the teeth cycle on a native classic level', () => {
    const cc = columns(corridor('timid_teeth', 'cc'), CC_TEETH_CYCLE_TICKS * 3);
    const cc2 = columns(corridor('timid_teeth', 'cc2'), CC_TEETH_CYCLE_TICKS * 3);
    expect(cc).not.toEqual(cc2);
  });

  it('turns a boxed-in ghost to face its last candidate, as other classic monsters do', () => {
    const lvl = corridor('ghost', 'cc2');
    for (const [x, y] of [[4, 1], [3, 0], [3, 2], [2, 1]]) lvl.terrain[y][x] = STEEL;
    const engine = new GameEngine();
    engine.loadLevel(lvl);
    for (let t = 0; t < BOXED_TICKS; t++) engine.tick();
    expect(monsterOf(engine).x).toBe(3);
    expect(monsterOf(engine).dir).toBe('W');
  });

  it('leaves a boxed-in ghost facing its way on a level that is not a CC2 import', () => {
    const lvl = corridor('ghost', 'cc');
    for (const [x, y] of [[4, 1], [3, 0], [3, 2], [2, 1]]) lvl.terrain[y][x] = STEEL;
    const engine = new GameEngine();
    engine.loadLevel(lvl);
    for (let t = 0; t < BOXED_TICKS; t++) engine.tick();
    expect(monsterOf(engine).dir).toBe('E');
  });
});
