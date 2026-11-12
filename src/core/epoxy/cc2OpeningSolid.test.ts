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
import type { Cc2LevelData, CompiledLevel, RuntimeEntity } from '../types';
import { canMonsterEnter } from './epoxyMonsters';
import type { EpoxyWorld } from './epoxyWorld';

beforeEach(() => {
  loadTestConfigs();
});

const CC2_RECORD = { v: 1, sha256: 'ab'.repeat(32), file: 'one.c2m', order: 1, gridHash: 'x' } as Cc2LevelData;
const ROWS = ['#######', '#.....#', '#.....#', '#######'];
const OPENING = { x: 3, y: 1 };

type Mode = 'cc2' | 'cc' | 'native';

function fixture(mode: Mode, type: string): { w: EpoxyWorld; monster: RuntimeEntity } {
  const built = buildTestLevel(ROWS, { entities: [{ type, x: 2, y: 1, dir: 'E' }] });
  const level: CompiledLevel = {
    ...built,
    playerStart: { x: 5, y: 2, dir: 'N' },
    ...(mode === 'cc2' ? { cc2: CC2_RECORD } : mode === 'cc' ? { rulesFlavor: 'cc' as const } : {})
  };
  const engine = new GameEngine();
  engine.loadLevel(level);
  const w = (engine as unknown as { w: EpoxyWorld }).w;
  const monster = w.entities.find((e) => e.kind === 'monster');
  if (monster === undefined) throw new Error('the monster is missing');
  return { w, monster };
}

describe('the cell a player is stepping into stays solid for monsters (CC2 engine)', () => {
  it('bars a monster on a CC2 level while the opening is set, and frees it once the step ends', () => {
    const { w, monster } = fixture('cc2', 'glider');
    expect(canMonsterEnter(w, monster, 'E')).toBe(true);
    w.player.cc3dArrival = { opening: OPENING };
    expect(canMonsterEnter(w, monster, 'E')).toBe(false);
    expect(canMonsterEnter(w, monster, 'S')).toBe(true);
    delete w.player.cc3dArrival;
    expect(canMonsterEnter(w, monster, 'E')).toBe(true);
  });

  it('bars a monster for the opening of a parked player too', () => {
    const { w, monster } = fixture('cc2', 'glider');
    const parked = { ...w.player, cc3dArrival: { opening: OPENING } };
    w.parked = [parked];
    expect(canMonsterEnter(w, monster, 'E')).toBe(false);
  });

  it('does not hold a ghost', () => {
    const { w, monster } = fixture('cc2', 'ghost');
    w.player.cc3dArrival = { opening: OPENING };
    expect(canMonsterEnter(w, monster, 'E')).toBe(true);
  });

  it.each(['cc', 'native'] as const)('is not applied on a %s level', (mode) => {
    const { w, monster } = fixture(mode, 'glider');
    w.player.cc3dArrival = { opening: OPENING };
    expect(canMonsterEnter(w, monster, 'E')).toBe(true);
  });
});
