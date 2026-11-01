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

vi.mock('../../audio/AudioManager', () => ({
  AudioManager: { playSfx: vi.fn() }
}));

import { Direction } from '../types';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { lynxLevel, monster } from './lynxTestMaps';
import { LynxRig } from './lynxTestRig';

beforeAll(() => {
  loadTestConfigs();
});

const OPEN_ROOM = ['#####', '#...#', '#...#', '#...#', '#####'];

/** A monster at (2, 2) in a room; Chip waits in a sealed pocket below. */
function roomWith(type: string, dir: Direction, rows: string[] = OPEN_ROOM): LynxRig {
  return new LynxRig(lynxLevel([...rows, '#@#'], { entities: [monster(type, 2, 2, dir)] }));
}

describe('F. monsters', () => {
  it('F1 bug takes its left first, then forward', () => {
    const rig = roomWith('bug', 'N');
    rig.afterTick(0);
    expect(rig.entities[0]).toMatchObject({ x: 1, y: 2, dir: 'W' });

    const walled = roomWith('bug', 'N', ['#####', '#...#', '##..#', '#...#', '#####']);
    walled.afterTick(0);
    expect(walled.entities[0]).toMatchObject({ x: 2, y: 1, dir: 'N' });
  });

  it('F2 paramecium takes its right first', () => {
    const rig = roomWith('paramecium', 'N');
    rig.afterTick(0);
    expect(rig.entities[0]).toMatchObject({ x: 3, y: 2, dir: 'E' });
  });

  it('F3 glider keeps forward first, turns left when blocked, and swims', () => {
    const rig = roomWith('glider', 'N', ['#####', '##..#', '#...#', '#...#', '#####']);
    rig.afterTick(0);
    expect(rig.entities[0]).toMatchObject({ x: 2, y: 1, dir: 'N' });

    const blocked = roomWith('glider', 'N', ['#####', '#.#.#', '#...#', '#...#', '#####']);
    blocked.afterTick(0);
    expect(blocked.entities[0]).toMatchObject({ x: 1, y: 2, dir: 'W' });

    const swim = new LynxRig(
      lynxLevel(['#####', '#.W.#', '#####', '#@#'], { entities: [monster('glider', 1, 1, 'E')] })
    );
    swim.tick(8);
    expect(swim.entities).toHaveLength(1);
    expect(swim.entities[0].x).toBe(3);
  });

  it('F4 fireball turns right when forward is blocked, and drowns', () => {
    const rig = roomWith('fireball', 'N', ['#####', '#.#.#', '#...#', '#...#', '#####']);
    rig.afterTick(0);
    expect(rig.entities[0]).toMatchObject({ x: 3, y: 2, dir: 'E' });

    const swim = new LynxRig(
      lynxLevel(['#####', '#.W.#', '#####', '#@#'], { entities: [monster('fireball', 1, 1, 'E')] })
    );
    swim.afterTick(3);
    expect(swim.entities).toEqual([]);
    expect(swim.visuals).toContainEqual({ kind: 'splash', x: 2, y: 1, colorKey: undefined });
  });

  it('F6 leaves a blocked tank facing forward', () => {
    const rig = new LynxRig(
      lynxLevel(['####', '#..#', '####', '#@#'], { entities: [monster('tank', 1, 1, 'N')] })
    );
    rig.tick(20);
    expect(rig.entities[0]).toMatchObject({ x: 1, y: 1, dir: 'N' });
  });

  it('F7 faces back, then forward again, when boxed in', () => {
    const rig = new LynxRig(lynxLevel(['###', '#.#', '###', '#@#'], { entities: [monster('bug', 1, 1, 'N')] }));
    rig.afterTick(0);
    expect(rig.entities[0].dir).toBe('S');
    rig.afterTick(1);
    expect(rig.entities[0].dir).toBe('N');
  });
});
