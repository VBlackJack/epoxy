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

describe('C. moving and blocking', () => {
  const thin = { glyphs: { n: 'thin_wall_n' } };

  it('C1 refuses to enter a thin wall across its blocked edge', () => {
    const rig = new LynxRig(lynxLevel(['#####', '#.@.#', '#.n.#', '#...#', '#####'], thin));
    rig.press('S');
    rig.afterTick(0);
    expect(rig.player).toMatchObject({ x: 2, y: 1, dir: 'S' });
    expect(rig.soundCount('blocked')).toBe(1);
  });

  it('C1 refuses to leave a thin wall across its blocked edge', () => {
    const rig = new LynxRig(lynxLevel(['#####', '#...#', '#.n.#', '#.@.#', '#####'], thin));
    rig.press('N');
    rig.afterTick(0);
    expect(rig.player).toMatchObject({ x: 2, y: 2 });
    rig.afterTick(3);
    rig.press('N');
    rig.afterTick(4);
    expect(rig.player).toMatchObject({ x: 2, y: 2, dir: 'N' });
  });

  it('C9 makes hint a Chip-only tile', () => {
    const rig = new LynxRig(
      lynxLevel(['######', '#.H..#', '######', '#@#'], { entities: [monster('pink_ball', 3, 1, 'W')] })
    );
    rig.afterTick(0);
    expect(rig.entities[0]).toMatchObject({ x: 4, dir: 'E' });

    const block = new LynxRig(lynxLevel(['######', '#@BH.#', '######']));
    block.press('E');
    block.afterTick(0);
    expect(block.player.x).toBe(1);
    expect(block.entities[0]).toMatchObject({ x: 2, dir: 'E' });

    const chip = new LynxRig(lynxLevel(['####', '#@H#', '####']));
    chip.hold('E');
    chip.afterTick(2);
    expect(chip.engine.isPlayerOnHint()).toBe(false);
    chip.afterTick(3);
    expect(chip.engine.isPlayerOnHint()).toBe(true);
  });

  it('C10 gravel admits Chip and blocks, dirt only Chip', () => {
    const gravel = new LynxRig(lynxLevel(['######', '#@BG.#', '######']));
    gravel.press('E');
    gravel.afterTick(0);
    expect(gravel.entities[0].x).toBe(3);

    const dirtBlock = new LynxRig(lynxLevel(['######', '#@BD.#', '######']));
    dirtBlock.press('E');
    dirtBlock.afterTick(0);
    expect(dirtBlock.player.x).toBe(1);
    expect(dirtBlock.entities[0]).toMatchObject({ x: 2, dir: 'E' });

    const dirt = new LynxRig(lynxLevel(['#####', '#@D.#', '#####']));
    dirt.press('E');
    dirt.afterTick(3);
    expect(dirt.engine.getTerrain()[1][2]).toBe('floor');

    const ball = new LynxRig(
      lynxLevel(['######', '#.G..#', '######', '#@#'], { entities: [monster('pink_ball', 1, 1, 'E')] })
    );
    ball.afterTick(0);
    expect(ball.entities[0]).toMatchObject({ x: 1, dir: 'W' });
  });

  it('C11 plays blocked once per run of refusals and again after a quiet tick', () => {
    const rig = new LynxRig(lynxLevel(['@..']));
    rig.hold('W');
    rig.tick(3);
    expect(rig.player.x).toBe(0);
    expect(rig.soundCount('blocked')).toBe(1);
    rig.release();
    rig.tick(1);
    rig.press('W');
    rig.tick(1);
    expect(rig.soundCount('blocked')).toBe(2);
  });
});
