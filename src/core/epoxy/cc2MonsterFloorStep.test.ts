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
const FLOOR_STEP_TICKS = CC_MONSTER_STEP_TICKS / 2;
const TICKS = 16;
const FLOOR_CELL = 3;

interface TestWorld {
  entities: { type: string; kind: string; x: number; y: number }[];
}

function level(row: string, type: string, mode: 'cc2' | 'cc' | 'plain'): CompiledLevel {
  const cells = row.replace('M', '.');
  const built = buildTestLevel(['##########', `#${cells}#`, '##########'], {
    entities: [{ type, x: 1 + row.indexOf('M'), y: 1, dir: 'E' as Direction }]
  });
  if (mode === 'cc2') return { ...built, cc2: CC2_RECORD };
  return mode === 'cc' ? { ...built, rulesFlavor: 'cc' } : built;
}

/** The monster's column after each tick. */
function xs(lvl: CompiledLevel): number[] {
  const engine = new GameEngine();
  engine.loadLevel(lvl);
  const w = (engine as unknown as { w: TestWorld }).w;
  const out: number[] = [];
  for (let t = 0; t < TICKS; t++) {
    engine.tick();
    out.push(w.entities.find((e) => e.kind === 'monster')?.x ?? -1);
  }
  return out;
}

/** Ticks between the monster arriving on `cell` and on `next`. */
function ticksBetween(positions: number[], cell: number, next: number): number {
  return positions.indexOf(next) - positions.indexOf(cell);
}

describe('CC2 monster step onto ice or a force floor', () => {
  it.each([
    ['ice', 'M.II...'],
    ['a force floor', 'M.>>...']
  ])('lasts half a step after entering %s on a CC2 level', (_name, row) => {
    const at = xs(level(row, 'glider', 'cc2'));
    expect(ticksBetween(at, FLOOR_CELL, FLOOR_CELL + 1)).toBe(FLOOR_STEP_TICKS);
  });

  it('keeps the whole step onto ice on a native classic level', () => {
    const at = xs(level('M.II...', 'glider', 'cc'));
    expect(ticksBetween(at, FLOOR_CELL, FLOOR_CELL + 1)).toBe(CC_MONSTER_STEP_TICKS);
  });
});
