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

import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../../audio/AudioManager', () => ({
  AudioManager: { playSfx: vi.fn() }
}));

import { Direction } from '../../types';
import { loadTestConfigs } from '../../../test/loadTestConfigs';
import { lynxLevel, monster } from '../lynxTestMaps';
import { LynxRig, RigOptions } from '../lynxTestRig';
import { teethRules } from './teeth';

beforeAll(() => {
  loadTestConfigs();
});

const MODULES = [teethRules];

function teethRig(rows: string[], x: number, y: number, dir: Direction, options: RigOptions = {}): LynxRig {
  return new LynxRig(lynxLevel(rows, { entities: [monster('teeth', x, y, dir)] }), { modules: MODULES, ...options });
}

const CORRIDOR = ['########', '#.....@#', '########'];
const ROOM = ['######', '#....#', '#....#', '#..@.#', '######'];

describe('teeth', () => {
  it('A6 steps in ticks 0, 8, 16, 24 and kills a waiting Chip in tick 32', () => {
    const rig = teethRig(CORRIDOR, 1, 1, 'E');
    rig.afterTick(0);
    expect(rig.entities[0].x).toBe(2);
    rig.afterTick(7);
    expect(rig.entities[0].x).toBe(2);
    rig.afterTick(8);
    expect(rig.entities[0].x).toBe(3);
    rig.afterTick(16);
    expect(rig.entities[0].x).toBe(4);
    rig.afterTick(24);
    expect(rig.entities[0].x).toBe(5);
    rig.afterTick(32);
    expect(rig.player.alive).toBe(false);
    expect(rig.player.deathReasonKey).toBe('hud.messages.death_monster');
    expect(rig.entities).toEqual([]);
    expect(rig.visualsOf('explosion')).toContainEqual({ kind: 'explosion', x: 5, y: 1, colorKey: undefined });
    expect(rig.player).toMatchObject({ x: 6, y: 1 });
  });

  it('A6 the phase offset shifts the cadence', () => {
    const rig = teethRig(CORRIDOR, 1, 1, 'E', { replay: { phaseOffset: 4 } });
    rig.afterTick(3);
    expect(rig.entities[0].x).toBe(1);
    rig.afterTick(4);
    expect(rig.entities[0].x).toBe(2);
    rig.afterTick(12);
    expect(rig.entities[0].x).toBe(3);
  });

  it('F12 ties go vertical first', () => {
    const rig = teethRig(ROOM, 1, 1, 'N');
    rig.afterTick(0);
    expect(rig.entities[0]).toMatchObject({ x: 1, y: 2, dir: 'S' });
  });

  it('prefers the horizontal axis when it is the longer distance', () => {
    const rig = teethRig(['#######', '#.....#', '#....@#', '#######'], 1, 1, 'N');
    rig.afterTick(0);
    expect(rig.entities[0]).toMatchObject({ x: 2, y: 1, dir: 'E' });
  });

  it('takes the second choice when the first is blocked', () => {
    const rig = teethRig(['######', '#....#', '##...#', '#..@.#', '######'], 1, 1, 'N');
    rig.afterTick(0);
    expect(rig.entities[0]).toMatchObject({ x: 2, y: 1, dir: 'E' });
  });

  it('F13 faces its first choice and stays when both are blocked', () => {
    const rig = teethRig(['######', '#.#..#', '##...#', '#..@.#', '######'], 1, 1, 'N');
    rig.afterTick(0);
    expect(rig.entities[0]).toMatchObject({ x: 1, y: 1, dir: 'S' });
  });

  it('F14 chases the logical cell Chip is moving into', () => {
    const rig = teethRig(['######', '#....#', '#....#', '#.@..#', '#....#', '######'], 1, 1, 'S');
    rig.afterTick(0);
    expect(rig.entities[0]).toMatchObject({ x: 1, y: 2 });
    rig.afterTick(5);
    rig.press('E');
    rig.afterTick(8);
    expect(rig.player).toMatchObject({ x: 3, y: 3 });
    expect(rig.entities[0]).toMatchObject({ x: 2, y: 2, dir: 'E' });
  });
});
