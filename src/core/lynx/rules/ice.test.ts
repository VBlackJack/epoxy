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
import { lynxLevel } from '../lynxTestMaps';
import { LynxRig } from '../lynxTestRig';

beforeAll(() => {
  loadTestConfigs();
});

const SKATES_ITEM = 'boots_ice';
const ICE = { glyphs: { I: 'ice' } };
const SKATES = { glyphs: { I: 'ice', k: { item: SKATES_ITEM } } };

describe('ice (spec 13.1)', () => {
  it('A9 carries Chip at double speed and reports carried steps as sliding', () => {
    const rig = new LynxRig(lynxLevel(['#######', '#@III.#', '#######'], ICE));
    rig.press('E');
    rig.afterTick(0);
    expect(rig.player).toMatchObject({ x: 2, moveCooldown: 1, isSliding: false });
    rig.afterTick(1);
    expect(rig.player).toMatchObject({ x: 2, moveCooldown: 0 });
    rig.afterTick(2);
    expect(rig.player).toMatchObject({ x: 3, isSliding: true });
    rig.afterTick(4);
    expect(rig.player.x).toBe(4);
    rig.afterTick(6);
    expect(rig.player).toMatchObject({ x: 5, moveCooldown: 3, isSliding: true });
    for (const [tick, cooldown] of [
      [7, 2],
      [8, 1],
      [9, 0]
    ] as const) {
      rig.afterTick(tick);
      expect(rig.player).toMatchObject({ x: 5, moveCooldown: cooldown, isSliding: true });
    }
    rig.afterTick(10);
    expect(rig.player).toMatchObject({ x: 5, dir: 'E', isSliding: false });
  });

  it('C2 turns Chip on an ice corner and carries him on', () => {
    const rig = new LynxRig(lynxLevel(['#####', '#####', '#.c.#', '#.@.#', '#####'], { glyphs: { c: 'ice_nw' } }));
    rig.press('N');
    rig.afterTick(0);
    expect(rig.player).toMatchObject({ x: 2, y: 2, dir: 'N' });
    rig.afterTick(1);
    expect(rig.player.dir).toBe('E');
    rig.afterTick(2);
    expect(rig.player).toMatchObject({ x: 3, y: 2, isSliding: true });
    rig.afterTick(5);
    expect(rig.player).toMatchObject({ x: 3, y: 2, moveCooldown: 0 });
  });

  it('C2 refuses to enter an ice corner across a solid side', () => {
    const rig = new LynxRig(lynxLevel(['#####', '#####', '#@c.#', '#...#', '#####'], { glyphs: { c: 'ice_nw' } }));
    rig.press('E');
    rig.afterTick(0);
    expect(rig.player).toMatchObject({ x: 1, y: 2, dir: 'E' });
    expect(rig.soundCount('blocked')).toBe(1);
  });

  it('refuses to leave an ice corner across a solid side and bounces', () => {
    const rig = new LynxRig(
      lynxLevel(['#####', '#.@.#', '#####'], { glyphs: { '@': 'ice_nw' } })
    );
    rig.press('W');
    rig.afterTick(0);
    // Refused (west is a solid side): reversed to east, which the corner does not turn.
    expect(rig.player).toMatchObject({ x: 2, dir: 'E' });
    expect(rig.soundCount('blocked')).toBe(1);
    rig.afterTick(1);
    expect(rig.player).toMatchObject({ x: 3, isSliding: true });
  });

  it('C3 bounces Chip off the end of the ice', () => {
    const rig = new LynxRig(lynxLevel(['#####', '#@II#', '#####'], ICE));
    rig.press('E');
    rig.afterTick(0);
    expect(rig.player.x).toBe(2);
    rig.afterTick(2);
    expect(rig.player.x).toBe(3);
    rig.afterTick(3);
    expect(rig.soundCount('blocked')).toBe(0);
    rig.afterTick(4);
    expect(rig.player).toMatchObject({ x: 3, dir: 'W' });
    expect(rig.soundCount('blocked')).toBe(1);
    rig.afterTick(5);
    expect(rig.player.x).toBe(2);
    rig.afterTick(7);
    expect(rig.player.x).toBe(1);
    rig.afterTick(10);
    expect(rig.player).toMatchObject({ x: 1, dir: 'W', moveCooldown: 0 });
  });

  it('applies the corner turn of its own cell after a bounce', () => {
    const rig = new LynxRig(lynxLevel(['####', '##c#', '##.#', '##@#', '####'], { glyphs: { c: 'ice_ne' } }));
    rig.press('N');
    rig.afterTick(3);
    rig.press('N');
    rig.afterTick(4);
    expect(rig.player).toMatchObject({ x: 2, y: 1 });
    rig.afterTick(5);
    // Arrived facing north on ice_ne: turned west.
    expect(rig.player.dir).toBe('W');
    rig.afterTick(6);
    // Forced west into the wall: reversed to east, which the corner turns south.
    expect(rig.player.dir).toBe('S');
    expect(rig.soundCount('blocked')).toBe(1);
  });

  it('C4 lets ice skates stop the sliding and the speed-up', () => {
    const rig = new LynxRig(lynxLevel(['#######', '#@kII.#', '#######'], SKATES));
    rig.press('E');
    rig.afterTick(3);
    expect(rig.player.x).toBe(2);
    expect(rig.engine.holdsItem(SKATES_ITEM)).toBe(true);
    rig.press('E');
    rig.afterTick(4);
    expect(rig.player).toMatchObject({ x: 3, moveCooldown: 3 });
    rig.afterTick(7);
    expect(rig.player).toMatchObject({ x: 3, moveCooldown: 0 });
    rig.afterTick(8);
    expect(rig.player).toMatchObject({ x: 3, isSliding: false });
  });

  it('does not turn Chip with skates on a corner', () => {
    const map = ['#####', '#.c.#', '#.k.#', '#.@.#', '#####'];
    const rig = new LynxRig(lynxLevel(map, { glyphs: { c: 'ice_nw', k: { item: SKATES_ITEM } } }));
    rig.press('N');
    rig.afterTick(3);
    rig.press('N');
    rig.afterTick(7);
    expect(rig.player).toMatchObject({ x: 2, y: 1, dir: 'N' });
    rig.afterTick(12);
    expect(rig.player).toMatchObject({ x: 2, y: 1, dir: 'N', isSliding: false });
  });

  it('I2 leaves a block on ice alone in tick 0, then carries it', () => {
    const glyphs = { I: { terrain: 'ice', entity: { type: 'dirt_block', dir: 'N' as const } } };
    const rig = new LynxRig(lynxLevel(['#.#', '#I#', '#.#', '###', '#@#'], { glyphs }));
    rig.afterTick(0);
    expect(rig.entities[0]).toMatchObject({ x: 1, y: 1 });
    rig.afterTick(1);
    expect(rig.entities[0]).toMatchObject({ x: 1, y: 0, isSliding: true });
  });

  it('K4 keeps the sliding flag after an undo', () => {
    const rig = new LynxRig(lynxLevel(['#######', '#@BII.#', '##.####', '#######'], ICE));
    rig.press('E');
    rig.afterTick(4);
    rig.press('S');
    rig.afterTick(6);
    expect(rig.engine.undo()).toBe(true);
    expect(rig.engine.getTick()).toBe(5);
    expect(rig.player).toMatchObject({ x: 2, y: 1, moveCooldown: 0 });
    expect(rig.entities[0]).toMatchObject({ x: 5, y: 1, isSliding: true, cooldownTicks: 3 });
    rig.tick();
    expect(rig.entities[0].isSliding).toBe(true);
    rig.afterTick(7);
    expect(rig.entities[0]).toMatchObject({ isSliding: true, cooldownTicks: 0 });
    rig.afterTick(8);
    expect(rig.entities[0].isSliding).toBe(false);
  });
});
