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

import { loadTestConfigs } from '../../../test/loadTestConfigs';
import { lynxLevel, LynxLevelOptions, monster } from '../lynxTestMaps';
import { LynxRig } from '../lynxTestRig';
import { buttonsRules } from './buttons';
import { tankRules } from './tanks';

beforeAll(() => {
  loadTestConfigs();
});

const BLUE_BUTTON = 'button_blue';
const TRAP = 'trap';

function rigOf(rows: string[], options: LynxLevelOptions): LynxRig {
  return new LynxRig(lynxLevel(rows, options), { modules: [tankRules, buttonsRules] });
}

const BLUE_ROOM = ['########', '#@K#####', '########', '#......#', '########'];
const BLUE_OPTIONS: LynxLevelOptions = {
  glyphs: { K: BLUE_BUTTON },
  entities: [monster('tank', 1, 3, 'E')]
};

describe('tanks', () => {
  it('F6 a blocked tank keeps its facing and waits', () => {
    const rig = rigOf(['####', '#..#', '####', '#@#'], { entities: [monster('tank', 1, 1, 'N')] });
    rig.tick(20);
    expect(rig.entities[0]).toMatchObject({ x: 1, y: 1, dir: 'N' });
  });

  it('D5 a block cannot be pushed onto a tank', () => {
    const rig = rigOf(['#####', '#@B.#', '#####'], { entities: [monster('tank', 3, 1, 'N')] });
    rig.press('E');
    rig.afterTick(0);
    expect(rig.player.x).toBe(1);
    expect(rig.entities.find((e) => e.type === 'dirt_block')).toMatchObject({ x: 2, dir: 'E' });
    expect(rig.entities.find((e) => e.type === 'tank')).toMatchObject({ x: 3, y: 1, dir: 'N' });
  });

  it('G2 a tank at rest turns around at the start of the tick after a blue button press', () => {
    const rig = rigOf(BLUE_ROOM, BLUE_OPTIONS);
    rig.press('E');
    rig.afterTick(3);
    expect(rig.player.x).toBe(2);
    expect(rig.entities[0]).toMatchObject({ x: 2, y: 3, dir: 'E' });
    rig.afterTick(4);
    expect(rig.entities[0]).toMatchObject({ x: 1, y: 3, dir: 'W' });
  });

  it('G3 a tank that is mid-step when the next tick begins ignores the press', () => {
    const rig = rigOf(BLUE_ROOM, BLUE_OPTIONS);
    rig.afterTick(1);
    rig.press('E');
    rig.afterTick(8);
    expect(rig.entities[0]).toMatchObject({ x: 4, y: 3, dir: 'E' });
  });

  it('G4 a tank held in a trap turns too', () => {
    const rig = rigOf(['#####', '#@K##', '#####', '#t#', '###'], {
      glyphs: { K: BLUE_BUTTON, t: { terrain: TRAP, entity: { type: 'tank', dir: 'E' } } }
    });
    rig.press('E');
    rig.afterTick(3);
    expect(rig.entities[0].dir).toBe('E');
    rig.afterTick(4);
    expect(rig.entities[0]).toMatchObject({ x: 1, y: 3, dir: 'W' });
  });

  it('a press that found the tank mid-step leaves no mark behind', () => {
    const rig = rigOf(BLUE_ROOM, BLUE_OPTIONS);
    rig.afterTick(1);
    rig.press('E');
    rig.afterTick(8);
    rig.afterTick(12);
    expect(rig.entities[0]).toMatchObject({ x: 5, y: 3, dir: 'E' });
  });
});
