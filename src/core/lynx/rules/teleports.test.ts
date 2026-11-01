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

beforeAll(() => {
  loadTestConfigs();
});

const GLYPHS = { T: 'teleport' };

describe('H. teleports', () => {
  it('H1 lands on the previous teleport in reading order', () => {
    const rig = new LynxRig(lynxLevel(['########', '#T.T.T@#', '########'], { glyphs: GLYPHS }));
    rig.press('W');
    rig.afterTick(3);
    expect(rig.player).toMatchObject({ x: 3, y: 1, dir: 'W' });
    expect(rig.visuals).toContainEqual({ kind: 'teleport', x: 3, y: 1, colorKey: undefined });
    expect(rig.soundCount('teleport')).toBe(1);
    rig.afterTick(4);
    expect(rig.player.x).toBe(2);
  });

  it('H2 lands on its own teleport when every other exit is blocked', () => {
    const rig = new LynxRig(lynxLevel(['########', '#T#T.T@#', '########'], { glyphs: GLYPHS }));
    rig.press('W');
    rig.afterTick(3);
    expect(rig.player.x).toBe(5);
    rig.afterTick(4);
    expect(rig.player.x).toBe(4);
  });

  it('H3 leaves Chip stuck for good when no landing exists', () => {
    const rig = new LynxRig(lynxLevel(['#####', '#@###', '#T#T#', '#####'], { glyphs: GLYPHS }));
    rig.press('S');
    rig.afterTick(3);
    expect(rig.player).toMatchObject({ x: 1, y: 2 });
    rig.hold('N');
    rig.tick(40);
    expect(rig.player).toMatchObject({ x: 1, y: 2 });
    expect(rig.engine.getStepsCount()).toBe(1);
    expect(rig.engine.getTimedMoveHistory()).toEqual([{ tick: 0, dir: 'S' }]);
  });

  it('H4 sends a monster through without a sound', () => {
    const level = lynxLevel(['#######', '#.T.T.#', '#######', '#@#'], {
      glyphs: GLYPHS,
      entities: [monster('pink_ball', 5, 1, 'W')]
    });
    const rig = new LynxRig(level);
    rig.afterTick(3);
    expect(rig.visuals).toContainEqual({ kind: 'teleport', x: 2, y: 1, colorKey: undefined });
    expect(rig.sounds).not.toContain('teleport');
    expect(rig.entityAt(2, 1)).toBeDefined();
    rig.afterTick(4);
    expect(rig.entityAt(1, 1)).toBeDefined();
  });

  it('H5 sends a block through', () => {
    const rig = new LynxRig(lynxLevel(['########', '#.T#TB@#', '########'], { glyphs: GLYPHS }));
    rig.press('W');
    rig.afterTick(3);
    expect(rig.entityAt(4, 1)).toBeUndefined();
    rig.afterTick(4);
    expect(rig.entityAt(1, 1)).toMatchObject({ type: 'dirt_block' });
  });

  it('H6 forces the exit and lets the pending direction wait', () => {
    const rig = new LynxRig(lynxLevel(['########', '##.#####', '#T.T.T@#', '########'], { glyphs: GLYPHS }));
    rig.press('W');
    rig.afterTick(3);
    rig.press('N');
    rig.afterTick(4);
    expect(rig.player).toMatchObject({ x: 2, y: 2 });
    rig.afterTick(8);
    expect(rig.player).toMatchObject({ x: 2, y: 1 });
    expect(rig.engine.getTimedMoveHistory()).toEqual([
      { tick: 0, dir: 'W' },
      { tick: 8, dir: 'N' }
    ]);
  });

  it('lands a monster on the teleport it just left when its exit points back at the monster', () => {
    const level = lynxLevel(['#####', '#.TT#', '#####', '#@#'], {
      glyphs: GLYPHS,
      entities: [monster('pink_ball', 1, 1, 'E')]
    });
    const rig = new LynxRig(level);
    rig.afterTick(3);
    expect(rig.entityAt(2, 1)).toBeDefined();
    rig.afterTick(7);
    expect(rig.entityAt(2, 1)).toMatchObject({ type: 'pink_ball', dir: 'E' });
    expect(rig.visualsOf('teleport')).toHaveLength(2);
  });

  it('keeps a monster on its teleport when no landing exists', () => {
    const level = lynxLevel(['####', '#T##', '####', '#@#'], {
      glyphs: GLYPHS,
      entities: [monster('pink_ball', 1, 1, 'N')]
    });
    const rig = new LynxRig(level);
    rig.tick(10);
    expect(rig.entityAt(1, 1)).toBeDefined();
  });
});
