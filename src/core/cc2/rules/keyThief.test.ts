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
import { lynxLevel } from '../../lynx/lynxTestMaps';
import { LynxRig } from '../../lynx/lynxTestRig';
import { keyThiefRules } from './keyThief';

beforeAll(() => {
  loadTestConfigs();
});

describe('CC2 key thief', () => {
  it('takes every key and leaves the boots', () => {
    const level = lynxLevel(['#######', '#@ruTp#', '#######'], { glyphs: { T: 'thief_keys' } });
    const rig = new LynxRig(level, { modules: [keyThiefRules] });
    expect(rig.engine.getUnsupportedTiles()).toEqual([]);
    rig.hold('E');
    rig.tick(8);
    expect(rig.player.keys).toMatchObject({ key_red: 1, key_blue: 1 });
    rig.tick(12);
    expect(rig.player.x).toBe(5);
    expect(rig.player.keys).toMatchObject({ key_red: 0, key_blue: 0 });
    expect(rig.player.boots.has('boots_fire')).toBe(true);
  });
});
