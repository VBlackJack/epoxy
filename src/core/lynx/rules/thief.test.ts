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
import { lynxLevel, monster } from '../lynxTestMaps';
import { LynxRig } from '../lynxTestRig';
import { thiefRules } from './thief';

beforeAll(() => {
  loadTestConfigs();
});

const THIEF_GLYPHS = { T: 'thief' };

describe('thief', () => {
  it('E7 takes every pair of boots, keeps the keys and stays on the map', () => {
    const rig = new LynxRig(lynxLevel(['#######', '#@qrT.#', '#######'], { glyphs: THIEF_GLYPHS }), {
      modules: [thiefRules]
    });
    rig.hold('E');
    rig.afterTick(7);
    expect(rig.engine.holdsItem('boots_water')).toBe(true);
    expect(rig.engine.holdsItem('key_red')).toBe(true);
    rig.afterTick(10);
    expect(rig.sounds).not.toContain('thief');
    rig.afterTick(11);
    expect(rig.player.x).toBe(4);
    expect(rig.engine.holdsItem('boots_water')).toBe(false);
    expect(rig.player.keys.key_red).toBe(1);
    expect(rig.engine.getTerrain()[1][4]).toBe('thief');
    expect(rig.soundCount('thief')).toBe(1);
  });

  it('takes the fire boots too', () => {
    const level = lynxLevel(['#######', '#@pT..#', '#######'], { glyphs: THIEF_GLYPHS });
    const rig = new LynxRig(level, { modules: [thiefRules] });
    rig.hold('E');
    rig.afterTick(3);
    expect(rig.engine.holdsItem('boots_fire')).toBe(true);
    rig.afterTick(7);
    expect(rig.engine.holdsItem('boots_fire')).toBe(false);
  });

  it('is Chip-only: a monster turns back from it', () => {
    const level = lynxLevel(['#####', '#.T.#', '#####', '#@#'], {
      glyphs: THIEF_GLYPHS,
      entities: [monster('pink_ball', 1, 1, 'E')]
    });
    const rig = new LynxRig(level, { modules: [thiefRules] });
    rig.afterTick(0);
    expect(rig.entities[0]).toMatchObject({ x: 1, y: 1, dir: 'W' });
  });
});
