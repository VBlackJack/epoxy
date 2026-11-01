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

describe('E. tiles', () => {
  it('E1 drowns Chip on arrival, unless he has water boots', () => {
    const rig = new LynxRig(lynxLevel(['####', '#@W#', '####']));
    rig.press('E');
    rig.afterTick(2);
    expect(rig.player.alive).toBe(true);
    rig.afterTick(3);
    expect(rig.player).toMatchObject({ alive: false, deathReasonKey: 'hud.messages.death_water' });
    expect(rig.visuals).toContainEqual({ kind: 'splash', x: 2, y: 1, colorKey: undefined });

    const boots = new LynxRig(lynxLevel(['#######', '#@qW.#', '#######']));
    boots.press('E');
    boots.afterTick(3);
    boots.press('E');
    boots.afterTick(7);
    expect(boots.player).toMatchObject({ x: 3, alive: true, inWater: true });
  });

  it('E2 burns Chip on fire, unless he has fire boots', () => {
    const rig = new LynxRig(lynxLevel(['####', '#@F#', '####']));
    rig.press('E');
    rig.afterTick(3);
    expect(rig.player).toMatchObject({ alive: false, deathReasonKey: 'hud.messages.death_fire' });
    expect(rig.visuals).toContainEqual({ kind: 'explosion', x: 2, y: 1, colorKey: 'red' });
    expect(rig.sounds).toContain('burn');

    const boots = new LynxRig(lynxLevel(['#######', '#@pF.#', '#######']));
    boots.press('E');
    boots.afterTick(3);
    boots.press('E');
    boots.afterTick(7);
    expect(boots.player).toMatchObject({ x: 3, alive: true });
  });

  it('E3 keeps monsters out of fire, except the fireball, and leaves blocks on it', () => {
    const rows = ['#####', '#.F.#', '#####', '#@#'];
    const bug = new LynxRig(lynxLevel(rows, { entities: [monster('bug', 1, 1, 'E')] }));
    bug.tick(20);
    expect(bug.entities[0]).toMatchObject({ x: 1, y: 1 });

    const fireball = new LynxRig(lynxLevel(rows, { entities: [monster('fireball', 1, 1, 'E')] }));
    fireball.afterTick(0);
    expect(fireball.entities[0].x).toBe(2);
    fireball.tick(6);
    expect(fireball.entities).toHaveLength(1);

    const block = new LynxRig(lynxLevel(['######', '#@BF.#', '######']));
    block.press('E');
    block.afterTick(3);
    expect(block.entities[0].x).toBe(3);
  });

  it('E4 explodes whoever arrives on a bomb', () => {
    const rig = new LynxRig(lynxLevel(['####', '#@m#', '####']));
    rig.press('E');
    rig.afterTick(3);
    expect(rig.player).toMatchObject({ alive: false, deathReasonKey: 'hud.messages.death_bomb' });
    expect(rig.engine.getItems()[1][2]).toBeNull();
    expect(rig.sounds).toContain('bomb');

    const ball = new LynxRig(
      lynxLevel(['#####', '#.m.#', '#####', '#@#'], { entities: [monster('pink_ball', 1, 1, 'E')] })
    );
    ball.afterTick(3);
    expect(ball.entities).toEqual([]);
    expect(ball.engine.getItems()[1][2]).toBeNull();
  });

  it('E5 opens doors with keys, keeping green keys', () => {
    const red = new LynxRig(lynxLevel(['#######', '#@r1.#', '#######']));
    red.hold('E');
    red.afterTick(3);
    expect(red.player.keys.key_red).toBe(1);
    red.afterTick(7);
    expect(red.engine.getTerrain()[1][3]).toBe('floor');
    expect(red.player.keys.key_red).toBe(0);
    expect(red.visuals).toContainEqual({ kind: 'unlock', x: 3, y: 1, colorKey: 'red' });
    expect(red.sounds).toContain('door');

    const green = new LynxRig(lynxLevel(['########', '#@g44..#', '########']));
    green.hold('E');
    green.tick(20);
    expect(green.engine.getTerrain()[1].slice(3, 5)).toEqual(['floor', 'floor']);
    expect(green.player.keys.key_green).toBe(1);

    const locked = new LynxRig(lynxLevel(['####', '#@1#', '####']));
    locked.press('E');
    locked.afterTick(0);
    expect(locked.player.x).toBe(1);
  });

  it('E6 lets monsters roll over red and blue keys only', () => {
    const red = new LynxRig(
      lynxLevel(['#####', '#.r..#', '#####', '#@#'], { entities: [monster('pink_ball', 1, 1, 'E')] })
    );
    red.afterTick(0);
    expect(red.engine.getItems()[1][2]).toBe('key_red');

    const blue = new LynxRig(
      lynxLevel(['#####', '#.u..#', '#####', '#@#'], { entities: [monster('pink_ball', 1, 1, 'E')] })
    );
    blue.afterTick(3);
    expect(blue.engine.getItems()[1][2]).toBeNull();

    for (const glyph of ['y', 'g', 'i', 'p', 'q']) {
      const rig = new LynxRig(
        lynxLevel(['#####', `#.${glyph}.#`, '#####', '#@#'], { entities: [monster('pink_ball', 1, 1, 'E')] })
      );
      rig.afterTick(0);
      expect(rig.entities[0]).toMatchObject({ x: 1, dir: 'W' });
    }
  });

  it('E8 gates the socket on chips and finishes on the exit', () => {
    const rig = new LynxRig(lynxLevel(['#######', '#@iSX.#', '#######'], { chipsRequired: 1 }));
    rig.hold('E');
    rig.afterTick(3);
    expect(rig.engine.getChipsRemaining()).toBe(0);
    rig.afterTick(7);
    expect(rig.engine.getTerrain()[1][3]).toBe('floor');
    rig.afterTick(11);
    expect(rig.engine.isLevelCompleted()).toBe(true);
    expect(rig.engine.getTick()).toBe(12);
    expect(rig.wins).toHaveLength(1);

    const short = new LynxRig(lynxLevel(['#######', '#@iSX.#', '#######'], { chipsRequired: 2 }));
    short.hold('E');
    short.tick(12);
    expect(short.player.x).toBe(2);
    expect(short.soundCount('blocked')).toBe(1);
  });

  it('E10 keeps an invisible wall closed without changing it', () => {
    const rig = new LynxRig(lynxLevel(['####', '#@A#', '####'], { glyphs: { A: 'invisible_wall' } }));
    rig.press('E');
    rig.afterTick(0);
    expect(rig.player.x).toBe(1);
    expect(rig.engine.getTerrain()[1][2]).toBe('invisible_wall');
  });

  it('K9 plays Epoxy-only tiles as walls and reports them', () => {
    const rig = new LynxRig(lynxLevel(['####', '#@T#', '####'], { glyphs: { T: 'turtle' } }));
    rig.press('E');
    rig.afterTick(0);
    expect(rig.player.x).toBe(1);
    expect(rig.engine.getUnsupportedTiles()).toEqual(['turtle']);
  });

  it('K9 leaves out entities with no rule and reports them', () => {
    const level = lynxLevel(['####', '#@.#', '####'], { entities: [monster('ice_block', 2, 1, 'N')] });
    const rig = new LynxRig(level);
    expect(rig.entities).toEqual([]);
    expect(rig.engine.getUnsupportedTiles()).toEqual(['ice_block']);
  });
});
