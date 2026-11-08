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
import { lynxLevel, monster } from '../../lynx/lynxTestMaps';
import { LynxRig } from '../../lynx/lynxTestRig';
import { LYNX_RULE_MODULES } from '../../lynx/rules';
import { greenItemRules } from './greenItems';

beforeAll(() => {
  loadTestConfigs();
});

const MODULES = [...LYNX_RULE_MODULES, greenItemRules];
const GLYPHS = {
  c: { item: 'green_chip' },
  b: { item: 'green_bomb' },
  G: 'button_green'
};

describe('CC2 green chips and bombs', () => {
  it('counts a green chip as a chip for the socket', () => {
    const level = lynxLevel(['######', '#@cSX#', '######'], { glyphs: GLYPHS, chipsRequired: 1 });
    const rig = new LynxRig(level, { modules: MODULES });
    expect(rig.engine.getUnsupportedTiles()).toEqual([]);
    rig.hold('E');
    rig.tick(24);
    expect(rig.wins).toHaveLength(1);
  });

  it('kills Chip on a green bomb', () => {
    const rig = new LynxRig(lynxLevel(['####', '#@b#', '####'], { glyphs: GLYPHS }), { modules: MODULES });
    rig.hold('E');
    rig.tick(8);
    expect(rig.player.alive).toBe(false);
  });

  it('turns chips into bombs once when Chip steps on the green button, and back on the next press', () => {
    const level = lynxLevel(['#######', '#@Gc.b#', '#######'], { glyphs: GLYPHS });
    const rig = new LynxRig(level, { modules: MODULES });
    const items = (): Array<string | null> => rig.engine.getItems()[1].slice(3, 6);
    expect(items()).toEqual(['green_chip', null, 'green_bomb']);
    rig.hold('E');
    rig.tick(4);
    rig.release();
    expect(rig.player.x).toBe(2);
    expect(items()).toEqual(['green_bomb', null, 'green_chip']);
    rig.tick(12);
    expect(items()).toEqual(['green_bomb', null, 'green_chip']);
    rig.hold('W');
    rig.tick(4);
    rig.release();
    rig.hold('E');
    rig.tick(4);
    rig.release();
    expect(rig.player.x).toBe(2);
    expect(items()).toEqual(['green_chip', null, 'green_bomb']);
  });

  it('keeps monsters off a green chip', () => {
    const level = lynxLevel(['#####', '#@#.#', '#c..#', '#####'], {
      glyphs: GLYPHS,
      entities: [monster('walker', 3, 1, 'W')]
    });
    const rig = new LynxRig(level, { modules: MODULES });
    expect(rig.engine.getUnsupportedTiles()).toEqual([]);
    expect(rig.engine.getItems()[2][1]).toBe('green_chip');
    rig.tick(40);
    expect(rig.engine.getItems()[2][1]).toBe('green_chip');
  });

  it('presses a second green button reached straight from the first', () => {
    const level = lynxLevel(['#######', '#@GGc.#', '#######'], { glyphs: GLYPHS });
    const rig = new LynxRig(level, { modules: MODULES });
    const chip = (): string | null => rig.engine.getItems()[1][4];
    rig.hold('E');
    rig.tick(4);
    expect(rig.player.x).toBe(2);
    expect(chip()).toBe('green_bomb');
    rig.tick(4);
    rig.release();
    expect(rig.player.x).toBe(3);
    expect(chip()).toBe('green_chip');
  });
});
