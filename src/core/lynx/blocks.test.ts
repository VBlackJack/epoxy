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

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { lynxLevel, monster } from './lynxTestMaps';
import { LynxRig } from './lynxTestRig';

beforeAll(() => {
  loadTestConfigs();
});

describe('D. blocks', () => {
  it('D1 starts Chip and the block in the same tick', () => {
    const rig = new LynxRig(lynxLevel(['######', '#@B..#', '######']));
    rig.press('E');
    rig.afterTick(0);
    expect(rig.player).toMatchObject({ x: 2, moveCooldown: 3 });
    expect(rig.entities[0]).toMatchObject({ x: 3, cooldownTicks: 3 });
    rig.afterTick(3);
    expect(rig.player.moveCooldown).toBe(0);
    expect(rig.entities[0].cooldownTicks).toBe(0);
  });

  it('D2 turns a block that cannot be pushed and records the refused move', () => {
    const rig = new LynxRig(lynxLevel(['####', '#@B#', '####']));
    rig.press('E');
    rig.afterTick(0);
    expect(rig.player).toMatchObject({ x: 1, dir: 'E' });
    expect(rig.entities[0].dir).toBe('E');
    expect(rig.soundCount('blocked')).toBe(1);
    expect(rig.engine.getTimedMoveHistory()).toEqual([{ tick: 0, dir: 'E' }]);
    expect(rig.engine.getStepsCount()).toBe(0);
    expect(rig.engine.canUndo()).toBe(false);
  });

  it('D2 leaves a block on ice facing its way when the refusal comes from Chip leaving his cell', () => {
    const glyphs = {
      '@': 'thin_wall_e',
      I: { terrain: 'ice', entity: { type: 'dirt_block', dir: 'N' as const } }
    };
    const rig = new LynxRig(lynxLevel(['#####', '#@I.#', '#####'], { glyphs }));
    rig.press('E');
    rig.afterTick(0);
    expect(rig.player).toMatchObject({ x: 1, dir: 'E' });
    expect(rig.entities[0].dir).toBe('N');
    rig.afterTick(1);
    expect(rig.entities[0].x).toBe(2);
  });

  it('D4 sinks a block into water and makes dirt', () => {
    const rig = new LynxRig(lynxLevel(['######', '#@BW.#', '######']));
    rig.press('E');
    rig.afterTick(3);
    expect(rig.engine.getTerrain()[1][3]).toBe('dirt');
    expect(rig.entities).toEqual([]);
    expect(rig.visuals).toContainEqual({ kind: 'splash', x: 3, y: 1, colorKey: undefined });
    expect(rig.sounds).toContain('splash');
    expect(rig.player.x).toBe(2);
  });

  it('D5 refuses a push into a cell held by a monster', () => {
    const level = lynxLevel(['#####', '#@B.#', '#####'], { entities: [monster('tank', 3, 1, 'N')] });
    const rig = new LynxRig(level);
    rig.press('E');
    rig.afterTick(0);
    expect(rig.player.x).toBe(1);
    expect(rig.entityAt(2, 1)).toMatchObject({ type: 'dirt_block', dir: 'E' });
    expect(rig.entityAt(3, 1)).toMatchObject({ type: 'tank', dir: 'N' });
  });

  it('D5 pushes a block at the turn of Chip into a cell a monster left earlier in the same tick', () => {
    const level = lynxLevel(['######', '#@B..#', '######'], { entities: [monster('pink_ball', 3, 1, 'E')] });
    const rig = new LynxRig(level);
    rig.press('E');
    rig.afterTick(0);
    expect(rig.player).toMatchObject({ x: 2, alive: true });
    expect(rig.entityAt(3, 1)).toMatchObject({ type: 'dirt_block', dir: 'E' });
    expect(rig.entityAt(4, 1)).toMatchObject({ type: 'pink_ball' });
  });

  it('D8 destroys a blue key under a block but keeps a red one', () => {
    const blue = new LynxRig(lynxLevel(['######', '#@Bu.#', '######']));
    blue.press('E');
    blue.afterTick(3);
    expect(blue.engine.getItems()[1][3]).toBeNull();

    const red = new LynxRig(lynxLevel(['#######', '#@Br..#', '#######']));
    red.press('E');
    red.afterTick(3);
    red.press('E');
    red.afterTick(4);
    expect(red.entities[0].x).toBe(4);
    expect(red.engine.getItems()[1][3]).toBe('key_red');
    red.afterTick(7);
    expect(red.player.keys.key_red).toBe(1);
  });

  it('D9 explodes a block and a bomb together', () => {
    const rig = new LynxRig(lynxLevel(['######', '#@Bm.#', '######']));
    rig.press('E');
    rig.afterTick(3);
    expect(rig.entities).toEqual([]);
    expect(rig.engine.getItems()[1][3]).toBeNull();
    expect(rig.visuals).toContainEqual({ kind: 'explosion', x: 3, y: 1, colorKey: undefined });
    expect(rig.sounds).toContain('bomb');
  });

  it('D10 leaves the item a block stood on at the start', () => {
    const level = lynxLevel(['#####', '#@j.#', '#####'], {
      chipsRequired: 1,
      glyphs: { j: { terrain: 'floor', item: 'chip', entity: { type: 'dirt_block' } } }
    });
    const rig = new LynxRig(level);
    rig.press('E');
    rig.afterTick(0);
    expect(rig.entities[0].x).toBe(3);
    expect(rig.engine.getItems()[1][2]).toBe('chip');
    rig.afterTick(3);
    expect(rig.engine.getChipsRemaining()).toBe(0);
  });
});
