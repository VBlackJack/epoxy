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

describe('B. who acts when', () => {
  it('B1 puts Chip first and processes from the last place', () => {
    const level = lynxLevel(['#####', '#...#', '#####', '#@#'], {
      entities: [monster('pink_ball', 1, 1, 'E'), monster('pink_ball', 3, 1, 'W')]
    });
    const rig = new LynxRig(level);
    rig.afterTick(0);
    expect(rig.entityAt(2, 1)).toBeDefined();
    expect(rig.entityAt(3, 1)).toMatchObject({ dir: 'W' });
  });

  it('B1 variant: with Chip above, the other ball acts first', () => {
    const level = lynxLevel(['#@#', '###', '#####', '#...#', '#####'], {
      entities: [monster('pink_ball', 1, 3, 'E'), monster('pink_ball', 3, 3, 'W')]
    });
    const rig = new LynxRig(level);
    rig.afterTick(0);
    expect(rig.entityAt(2, 3)).toMatchObject({ dir: 'W' });
    expect(rig.entityAt(1, 3)).toMatchObject({ dir: 'E' });
  });

  it('B2 lets a ball enter first, then Chip walks into it and both die', () => {
    const level = lynxLevel(['#####', '#@..#', '#####'], { entities: [monster('pink_ball', 3, 1, 'W')] });
    const rig = new LynxRig(level);
    rig.press('E');
    rig.afterTick(0);
    expect(rig.player).toMatchObject({ x: 1, y: 1, alive: false, deathReasonKey: 'hud.messages.death_monster' });
    expect(rig.visuals).toContainEqual({ kind: 'explosion', x: 1, y: 1, colorKey: 'red' });
    expect(rig.visuals).toContainEqual({ kind: 'explosion', x: 2, y: 1, colorKey: undefined });
    expect(rig.entities).toEqual([]);
  });

  it('B3 kills Chip when a ball steps into him', () => {
    const level = lynxLevel(['#####', '#..@#', '#####'], { entities: [monster('pink_ball', 1, 1, 'E')] });
    const rig = new LynxRig(level);
    rig.afterTick(0);
    expect(rig.entities[0]).toMatchObject({ x: 2 });
    rig.afterTick(4);
    expect(rig.player).toMatchObject({ x: 3, alive: false });
    expect(rig.visuals).toContainEqual({ kind: 'explosion', x: 2, y: 1, colorKey: undefined });
    expect(rig.visuals).toContainEqual({ kind: 'explosion', x: 3, y: 1, colorKey: 'red' });
  });

  it('B4 lets a ball that acts first take the cell Chip is about to leave', () => {
    const level = lynxLevel(['######', '#.@..#', '######'], { entities: [monster('pink_ball', 1, 1, 'E')] });
    const rig = new LynxRig(level);
    rig.press('E');
    rig.afterTick(0);
    expect(rig.player).toMatchObject({ x: 2, y: 1, alive: false });
    expect(rig.visuals).toContainEqual({ kind: 'explosion', x: 1, y: 1, colorKey: undefined });
  });

  it('B5 kills Chip who steps into a cell a monster just left, and pulls the monster back', () => {
    const level = lynxLevel(['#####', '#@..#', '#####'], { entities: [monster('pink_ball', 2, 1, 'E')] });
    const rig = new LynxRig(level);
    rig.press('E');
    rig.afterTick(0);
    expect(rig.player).toMatchObject({ x: 1, y: 1, alive: false });
    expect(rig.visuals).toContainEqual({ kind: 'explosion', x: 1, y: 1, colorKey: 'red' });
    expect(rig.visuals).toContainEqual({ kind: 'explosion', x: 2, y: 1, colorKey: undefined });
    expect(rig.entities).toEqual([]);
  });
});

describe('J. remains', () => {
  const bombRow = ['######', '#..m.#', '###@##', '######'];

  it('J1 blocks Chip until the remains vanish', () => {
    const rig = new LynxRig(lynxLevel(bombRow, { entities: [monster('pink_ball', 1, 1, 'E')] }));
    rig.afterTick(7);
    expect(rig.entities).toEqual([]);
    expect(rig.visualsOf('explosion')).toContainEqual({ kind: 'explosion', x: 3, y: 1, colorKey: undefined });
    rig.hold('N');
    rig.afterTick(18);
    expect(rig.player).toMatchObject({ x: 3, y: 2 });
    expect(rig.soundCount('blocked')).toBe(1);
    rig.afterTick(19);
    expect(rig.player).toMatchObject({ x: 3, y: 1 });
  });

  it('J1 variant: a phase offset of 1 shortens the remains by one tick', () => {
    const rig = new LynxRig(lynxLevel(bombRow, { entities: [monster('pink_ball', 1, 1, 'E')] }), {
      replay: { phaseOffset: 1 }
    });
    rig.afterTick(7);
    rig.hold('N');
    rig.afterTick(17);
    expect(rig.player).toMatchObject({ y: 2 });
    rig.afterTick(18);
    expect(rig.player).toMatchObject({ y: 1 });
  });

  it('J2 lets a monster erase remains by walking into them', () => {
    const rows = ['######', '###.##', '###.##', '###.##', '#..m@#', '######'];
    const level = lynxLevel(rows, {
      entities: [monster('pink_ball', 1, 4, 'E'), monster('pink_ball', 3, 1, 'S')]
    });
    const rig = new LynxRig(level);
    rig.afterTick(7);
    expect(rig.entityAt(3, 4)).toBeUndefined();
    rig.afterTick(12);
    rig.press('W');
    rig.afterTick(13);
    expect(rig.player).toMatchObject({ x: 3, y: 4, alive: true });
  });
});
