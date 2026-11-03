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

vi.mock('../audio/AudioManager', () => ({
  AudioManager: { playSfx: vi.fn() }
}));

import { loadTestConfigs } from '../test/loadTestConfigs';
import { lynxLevel, monster } from './lynx/lynxTestMaps';
import { LynxRig } from './lynx/lynxTestRig';

beforeAll(() => {
  loadTestConfigs();
});

/**
 * Lives beside the frozen Lynx suite, not in it: the Lynx engine refuses every tile and entity it has
 * no rule for, and the colour channel ids are Epoxy only.
 */
describe('Lynx refuses colour channel content', () => {
  it('plays a plate as a wall and reports it', () => {
    const rig = new LynxRig(lynxLevel(['####', '#@P#', '####'], { glyphs: { P: 'pressure_plate_red' } }));
    rig.press('E');
    rig.afterTick(0);
    expect(rig.player.x).toBe(1);
    expect(rig.engine.getUnsupportedTiles()).toEqual(['pressure_plate_red']);
  });

  it('leaves out a colour block and reports it', () => {
    const level = lynxLevel(['####', '#@.#', '####'], { entities: [monster('color_block_red', 2, 1, 'N')] });
    const rig = new LynxRig(level);
    expect(rig.entities).toEqual([]);
    expect(rig.engine.getUnsupportedTiles()).toEqual(['color_block_red']);
  });
});
