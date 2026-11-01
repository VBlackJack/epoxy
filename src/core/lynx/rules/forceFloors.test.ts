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

const SUCTION_ITEM = 'boots_force';
const SOUTH = { glyphs: { v: 'force_s' } };
const EAST = { glyphs: { '>': 'force_e' } };

describe('force floors (spec 13.2 to 13.4)', () => {
  it('C5 carries Chip at double speed and keeps pushing while he rests', () => {
    const rig = new LynxRig(lynxLevel(['#####', '#@v.#', '##.##', '#####'], SOUTH));
    rig.press('E');
    rig.afterTick(0);
    expect(rig.player.x).toBe(2);
    rig.afterTick(1);
    expect(rig.player).toMatchObject({ x: 2, y: 1, moveCooldown: 0 });
    rig.afterTick(2);
    expect(rig.player).toMatchObject({ x: 2, y: 2, isSliding: true, moveCooldown: 3 });
    rig.afterTick(5);
    expect(rig.player).toMatchObject({ y: 2, moveCooldown: 0 });
    rig.afterTick(6);
    expect(rig.player).toMatchObject({ x: 2, y: 2 });
  });

  it('C6 does not force Chip in tick 0 when he starts on a floor', () => {
    const rig = new LynxRig(lynxLevel(['####', '#@.#', '####'], { glyphs: { '@': 'force_e' } }));
    rig.afterTick(0);
    expect(rig.player.x).toBe(1);
    rig.afterTick(1);
    expect(rig.player).toMatchObject({ x: 2, isSliding: true });
  });

  it('C7 lets Chip steer only after a forced step has been attempted', () => {
    const rig = new LynxRig(lynxLevel(['######', '#>>>.#', '#@.###', '######'], EAST));
    rig.press('N');
    rig.afterTick(0);
    expect(rig.player).toMatchObject({ x: 1, y: 1 });
    expect(rig.press('S')).toBe(false);
    rig.afterTick(2);
    expect(rig.player).toMatchObject({ x: 2, y: 1 });
    rig.afterTick(4);
    expect(rig.player).toMatchObject({ x: 2, y: 2, dir: 'S', isSliding: false });
  });

  it('C7 keeps pushing Chip east when he chooses nothing', () => {
    const rig = new LynxRig(lynxLevel(['######', '#>>>.#', '#@.###', '######'], EAST));
    rig.press('N');
    rig.afterTick(4);
    expect(rig.player).toMatchObject({ x: 3, y: 1 });
    rig.afterTick(6);
    expect(rig.player).toMatchObject({ x: 4, y: 1 });
  });

  it('C7 refuses a step against the floor and costs the permission', () => {
    const rig = new LynxRig(lynxLevel(['######', '#>>>.#', '#@.###', '######'], EAST));
    rig.press('N');
    rig.afterTick(3);
    rig.press('W');
    rig.afterTick(4);
    expect(rig.player).toMatchObject({ x: 2, y: 1, dir: 'W' });
    rig.afterTick(5);
    expect(rig.player).toMatchObject({ x: 3, y: 1 });
    // The permission was lost by the chosen step, so Chip is pushed again and cannot steer.
    rig.press('S');
    expect(rig.engine.attemptPlayerMove('S')).toBe(false);
  });

  it('13.3 loses the permission on a step taken from an ordinary tile', () => {
    const rig = new LynxRig(lynxLevel(['######', '#>>>.#', '#@.###', '######'], EAST));
    rig.press('N');
    rig.afterTick(2);
    // Chip was pushed once (permission gained); step off the row onto floor, then back onto the row.
    rig.press('S');
    rig.afterTick(5);
    expect(rig.player).toMatchObject({ x: 2, y: 2 });
    rig.press('N');
    rig.afterTick(8);
    expect(rig.player).toMatchObject({ x: 2, y: 1 });
    expect(rig.engine.attemptPlayerMove('S')).toBe(false);
  });

  it('C8 lets suction boots stop the pushing and the speed-up', () => {
    const rig = new LynxRig(lynxLevel(['######', '#@sv.#', '###.##', '######'], { glyphs: { s: { item: SUCTION_ITEM }, v: 'force_s' } }));
    rig.press('E');
    rig.afterTick(3);
    rig.press('E');
    rig.afterTick(4);
    expect(rig.player).toMatchObject({ x: 3, moveCooldown: 3 });
    rig.afterTick(7);
    expect(rig.player).toMatchObject({ x: 3, y: 1, moveCooldown: 0 });
    rig.afterTick(8);
    expect(rig.player).toMatchObject({ x: 3, y: 1 });
  });

  it('13.3 neither tracks nor changes the permission while Chip wears suction boots', () => {
    const glyphs = { '@': 'force_e', '>': 'force_e', p: { item: SUCTION_ITEM }, T: 'thief' };
    const rig = new LynxRig(lynxLevel(['#########', '#@>p>.T.#', '#########'], { glyphs }));
    const permission = (): number =>
      (rig.engine as unknown as { sim: { world: { chip: { data: Record<string, number> } } } }).sim.world.chip.data
        .slidePermission ?? 0;
    const restAt = (x: number): void => {
      for (let guard = 0; guard < 40 && !(rig.player.x === x && rig.player.moveCooldown === 0); guard++) rig.tick();
    };
    // Pushed along the first floors without choosing: the permission is gained.
    rig.tick();
    restAt(3);
    expect(rig.engine.holdsItem(SUCTION_ITEM)).toBe(true);
    expect(permission()).toBe(1);
    // Steps from an ordinary tile and a chosen step from a force floor, both with the boots on.
    rig.press('E');
    restAt(4);
    expect(permission()).toBe(1);
    rig.press('E');
    restAt(5);
    expect(permission()).toBe(1);
    rig.press('E');
    restAt(6);
    expect(rig.engine.holdsItem(SUCTION_ITEM)).toBe(false);
    expect(permission()).toBe(1);
    // The boots are gone: the next step counts again.
    rig.press('E');
    rig.tick();
    expect(permission()).toBe(0);
  });

  it('refuses a step against the floor for everyone but Chip with suction boots', () => {
    const plain = new LynxRig(lynxLevel(['#####', '#@v.#', '#####'], SOUTH));
    plain.press('E');
    plain.afterTick(1);
    plain.press('W');
    plain.afterTick(1);
    expect(plain.player.x).toBe(2);

    const walled = new LynxRig(lynxLevel(['####', '#@v#', '####'], { glyphs: { v: 'force_e' } }));
    walled.press('E');
    walled.afterTick(3);
    expect(walled.player.x).toBe(2);
    // The forced step east is a wall: retried every tick, no bounce, he stays facing east.
    walled.afterTick(12);
    expect(walled.player).toMatchObject({ x: 2, dir: 'E' });

  });

  it('D6 carries a block that stands on a floor but refuses to push it mid-step', () => {
    const rig = new LynxRig(lynxLevel(['#####', '#>..#', '#.@.#', '#####'], { glyphs: { '>': { terrain: 'force_e', entity: { type: 'dirt_block', dir: 'N' } } } }));
    rig.afterTick(0);
    expect(rig.entities[0]).toMatchObject({ x: 1 });
    rig.afterTick(1);
    expect(rig.entities[0]).toMatchObject({ x: 2 });
    rig.press('N');
    rig.afterTick(2);
    expect(rig.player).toMatchObject({ x: 2, y: 2, dir: 'N' });
    expect(rig.entities[0].dir).toBe('E');
  });

  it('D7 kills Chip when a block slides into him', () => {
    const rig = new LynxRig(lynxLevel(['#####', '#.v.#', '#.@.#', '#####'], { glyphs: { v: { terrain: 'force_s', entity: { type: 'dirt_block', dir: 'N' } } } }));
    rig.afterTick(0);
    expect(rig.player.alive).toBe(true);
    rig.afterTick(1);
    expect(rig.player).toMatchObject({ alive: false, deathReasonKey: 'hud.messages.death_block' });
    expect(rig.visualsOf('explosion')).toEqual(
      expect.arrayContaining([expect.objectContaining({ x: 2, y: 2 }), expect.objectContaining({ x: 2, y: 1 })])
    );
  });

  it('F15 carries a monster across a force floor', () => {
    const rig = new LynxRig(
      lynxLevel(['#####', '#.v.#', '##.##', '#####', '#@#'], { ...SOUTH, entities: [monster('pink_ball', 1, 1, 'E')] })
    );
    rig.afterTick(0);
    expect(rig.entities[0]).toMatchObject({ x: 2, y: 1 });
    rig.afterTick(2);
    expect(rig.entities[0]).toMatchObject({ x: 2, y: 2, dir: 'S', isSliding: true });
  });
});

describe('random force floor (spec 14.3)', () => {
  const RANDOM = { glyphs: { '?': 'force_random' } };
  const map = ['#####', '#.#.#', '#@?.#', '##.##', '#####'];

  it('I1 pushes east first, then follows the shared rotating direction', () => {
    const rig = new LynxRig(lynxLevel(map, RANDOM));
    rig.press('E');
    rig.afterTick(2);
    expect(rig.player).toMatchObject({ x: 3, y: 2 });
  });

  it('I1 starts from the direction the replay harness sets', () => {
    const rig = new LynxRig(lynxLevel(map, RANDOM), { replay: { randomForceStart: 'E' } });
    rig.press('E');
    rig.afterTick(2);
    expect(rig.player).toMatchObject({ x: 2, y: 3 });
  });

  it('turns the shared direction once per creature, in list order', () => {
    const block = { terrain: 'force_random', entity: { type: 'dirt_block', dir: 'N' as const } };
    const rig = new LynxRig(lynxLevel(['#######', '#.?.?.#', '#######', '#@#'], { glyphs: { '?': block } }));
    // Chip's place is swapped with the first, so the list is [Chip, right block, left block]: the left one acts first.
    rig.afterTick(0);
    expect(rig.entities.map((e) => e.x)).toEqual([4, 2]);
    rig.afterTick(1);
    // The left block turns north to east and is pushed east; the right one then turns east to south: a wall.
    expect(rig.entities.map((e) => e.x)).toEqual([4, 3]);
    expect(rig.entities[0].dir).toBe('S');
  });

  it('does not turn the direction for Chip wearing suction boots', () => {
    const level = lynxLevel(['#######', '#@k?..#', '#######'], { glyphs: { '?': 'force_random', k: { item: SUCTION_ITEM } } });
    const rig = new LynxRig(level);
    rig.press('E');
    rig.afterTick(3);
    rig.press('E');
    rig.afterTick(12);
    // He walks on and off the random floor: he is never forced, and stops where his input ends.
    expect(rig.player.x).toBe(3);
  });
});
