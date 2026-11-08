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
import { Cc2Engine } from '../Cc2Engine';
import { itemRules } from './items';

beforeAll(() => {
  loadTestConfigs();
});

const GLYPHS = {
  T: 'steel_wall',
  a: { item: 'score_100' },
  b: { item: 'stopwatch_bonus' },
  c: { item: 'hiking_boots' }
};

describe('CC2 items module', () => {
  it('plays the ids it covers', () => {
    const rig = new LynxRig(lynxLevel(['#####', '#@Tab', '#####'], { glyphs: GLYPHS }), { modules: [itemRules] });
    expect(rig.engine.getUnsupportedTiles()).toEqual([]);
  });

  it('stops Chip at a steel wall', () => {
    const rig = new LynxRig(lynxLevel(['####', '#@T#', '####'], { glyphs: GLYPHS }), { modules: [itemRules] });
    rig.press('E');
    rig.tick(8);
    expect(rig.player.x).toBe(1);
  });

  it('picks up a score item and a hiking boots item on contact', () => {
    const rig = new LynxRig(lynxLevel(['#####', '#@ac#', '#####'], { glyphs: GLYPHS }), { modules: [itemRules] });
    rig.hold('E');
    rig.tick(10);
    expect(rig.player.x).toBe(3);
    expect(rig.soundCount('item')).toBe(2);
    expect(rig.engine.getUnsupportedTiles()).toEqual([]);
  });

  it('adds ten seconds to a timed level and leaves the caller level alone', () => {
    const level = lynxLevel(['####', '#@b#', '####'], { glyphs: GLYPHS, timeLimitSeconds: 30 });
    const engine = new Cc2Engine({ effect: () => undefined, step: () => undefined });
    engine.loadLevel(level);
    engine.holdPlayerDirection('E');
    for (let i = 0; i < 8; i++) engine.tick();
    expect(engine.getPlayer().x).toBe(2);
    expect(engine.getTimeRemainingSeconds()).toBeGreaterThan(36);
    expect(level.timeLimitSeconds).toBe(30);
  });

  it('leaves a level with no time limit without one', () => {
    const engine = new Cc2Engine({ effect: () => undefined, step: () => undefined });
    engine.loadLevel(lynxLevel(['####', '#@b#', '####'], { glyphs: GLYPHS }));
    engine.holdPlayerDirection('E');
    for (let i = 0; i < 8; i++) engine.tick();
    expect(engine.getTimeRemainingSeconds()).toBe(0);
  });
});
