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
import { GameEngine } from '../GameEngine';
import type { Cc2LevelData, CompiledLevel, Direction } from '../types';

beforeEach(() => {
  loadTestConfigs();
});

const CC2_RECORD = { v: 1, sha256: 'ab'.repeat(32), file: 'one.c2m', order: 1, gridHash: 'x' } as Cc2LevelData;
const ROW = '#.>.....#';
const FORCED_X = 2;
const LEAVER_X = 3;

type Mode = 'cc2' | 'cc' | 'native';

interface Placed {
  type: string;
  x: number;
  y: number;
  dir: Direction;
}

interface TestWorld {
  entities: { uid: number; type: string; kind: string; x: number; y: number }[];
}

function level(mode: Mode, forced: string, leaver: string, row = ROW): CompiledLevel {
  // The leaver is listed last: the classic game moves its creatures from the end of the list, so it clears the cell first.
  const entities: Placed[] = [
    { type: forced, x: FORCED_X, y: 1, dir: 'E' },
    { type: leaver, x: LEAVER_X, y: 1, dir: 'E' }
  ];
  const built = buildTestLevel(['#########', row, '#########'], { entities });
  const cells = built.terrain.map((r) => [...r]);
  cells[1][1] = 'floor';
  const base: CompiledLevel = { ...built, terrain: cells, playerStart: { x: 7, y: 1, dir: 'N' } };
  if (mode === 'cc2') return { ...base, cc2: CC2_RECORD };
  if (mode === 'cc') return { ...base, rulesFlavor: 'cc' };
  return base;
}

/** The column of the monster of `type` after the first tick. */
function afterFirstTick(lvl: CompiledLevel, type: string): number {
  const engine = new GameEngine();
  engine.loadLevel(lvl);
  const w = (engine as unknown as { w: TestWorld }).w;
  engine.tick();
  return w.entities.find((e) => e.type === type)?.x ?? -1;
}

describe('CC2 monster on a force floor with the way ahead held by a monster that leaves', () => {
  it('plans the forced move and makes it once the cell is free, in the same pass', () => {
    expect(afterFirstTick(level('cc2', 'glider', 'bug'), 'glider')).toBe(LEAVER_X);
  });

  it('does not on a cc-flavour level: the blocked plan is dropped for this pass', () => {
    expect(afterFirstTick(level('cc', 'glider', 'bug'), 'glider')).toBe(FORCED_X);
  });

  it('does not on a native level', () => {
    expect(afterFirstTick(level('native', 'glider', 'bug'), 'glider')).toBe(FORCED_X);
  });

  it('leaves a monster that force floors do not carry on its own plan', () => {
    // A blinky ignores sliding floors: it is not planned along the floor.
    const blinky = 'blinky';
    const free = afterFirstTick(level('cc2', blinky, 'bug'), blinky);
    const plain = afterFirstTick(level('cc2', blinky, 'bug', '#.......#'), blinky);
    expect(free).not.toBe(-1);
    expect(free).toBe(plain);
  });
});

describe('CC2 monster on a force floor with a wall ahead', () => {
  // Lexy make_actor_decision: a monster on a force floor decides the forced way without looking at the cell ahead,
  // so it faces the wall and bonks; it does not turn away.
  it('stays on the floor, facing the forced way', () => {
    const built = buildTestLevel(['#########', '#.>#....#', '#########'], { entities: [{ type: 'glider', x: FORCED_X, y: 1, dir: 'N' }] });
    const cells = built.terrain.map((r) => [...r]);
    cells[1][1] = 'floor';
    const engine = new GameEngine();
    engine.loadLevel({ ...built, terrain: cells, playerStart: { x: 7, y: 1, dir: 'N' }, cc2: CC2_RECORD });
    const w = (engine as unknown as { w: { entities: { type: string; x: number; dir: string }[] } }).w;
    engine.tick();
    const glider = w.entities.find((e) => e.type === 'glider');
    expect({ x: glider?.x, dir: glider?.dir }).toEqual({ x: FORCED_X, dir: 'E' });
  });
});
