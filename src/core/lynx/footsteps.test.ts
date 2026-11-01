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
  AudioManager: { playSfx: vi.fn(), playStep: vi.fn() }
}));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { lynxLevel } from './lynxTestMaps';
import { LynxRig } from './lynxTestRig';

beforeAll(() => {
  loadTestConfigs();
});

const TERRAINS = { glyphs: { I: 'ice', v: 'force_s' } };

describe('Lynx footsteps', () => {
  it('plays the plain step for a chosen step onto floor', () => {
    const rig = new LynxRig(lynxLevel(['####', '#@.#', '####']));
    rig.press('E');
    rig.tick(4);
    expect(rig.steps).toEqual([null]);
  });

  it('plays the ice step for a chosen step onto ice, and none for the slide that follows', () => {
    const rig = new LynxRig(lynxLevel(['#######', '#@III.#', '#######'], TERRAINS));
    rig.press('E');
    rig.tick(12);
    expect(rig.steps).toEqual(['ice']);
  });

  it('plays the force step for a chosen step onto a force floor, and none for the carry', () => {
    const rig = new LynxRig(lynxLevel(['#####', '#@v.#', '##.##', '#####'], TERRAINS));
    rig.press('E');
    rig.tick(12);
    expect(rig.steps).toEqual(['force']);
  });

  it('plays the water step only when Chip holds the water boots', () => {
    const bare = new LynxRig(lynxLevel(['####', '#@W#', '####']));
    bare.press('E');
    bare.tick(1);
    expect(bare.steps).toEqual([null]);

    const booted = new LynxRig(lynxLevel(['#####', '#@qW#', '#####']));
    booted.press('E');
    booted.tick(4);
    booted.press('E');
    booted.tick(4);
    expect(booted.steps).toEqual([null, 'water']);
  });

  it('plays the step of the destination tile when Chip, allowed to choose on a force floor, steps off it', () => {
    const rig = new LynxRig(lynxLevel(['######', '#>>>.#', '#@.###', '######'], { glyphs: { '>': 'force_e' } }));
    rig.press('N');
    rig.afterTick(0);
    expect(rig.steps).toEqual(['force']);
    rig.press('S');
    rig.afterTick(4);
    expect(rig.player).toMatchObject({ x: 2, y: 2, dir: 'S' });
    expect(rig.steps).toEqual(['force', null]);
  });

  it('plays the plain step on undo', () => {
    const rig = new LynxRig(lynxLevel(['####', '#@.#', '####']));
    rig.press('E');
    rig.tick(4);
    rig.steps.length = 0;
    expect(rig.engine.undo()).toBe(true);
    expect(rig.steps).toEqual([null]);
  });
});
