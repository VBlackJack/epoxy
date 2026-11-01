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
import { lynxLevel, LynxLevelOptions, monster } from '../lynxTestMaps';
import { LynxRig } from '../lynxTestRig';
import { RuleContext, RuleModule } from '../ruleApi';
import { ADMISSION } from '../tileRules';
import { specialWallRules } from './specialWalls';

beforeAll(() => {
  loadTestConfigs();
});

const GREEN_BUTTON = 'button_green';
const TOGGLE_OPEN = 'toggle_wall_open';
const TOGGLE_CLOSED = 'toggle_wall_closed';

function flipToggleWalls(ctx: RuleContext): void {
  for (let y = 0; y < ctx.height; y++) {
    for (let x = 0; x < ctx.width; x++) {
      const id = ctx.world.terrain[y][x];
      if (id === TOGGLE_OPEN) ctx.setTerrain(x, y, TOGGLE_CLOSED);
      else if (id === TOGGLE_CLOSED) ctx.setTerrain(x, y, TOGGLE_OPEN);
    }
  }
}

/** Stands in for the buttons module: any arrival on a green button flips every toggle wall. */
const greenButtonStub: RuleModule = {
  name: 'greenButtonStub',
  tiles: {
    [GREEN_BUTTON]: {
      admits: ADMISSION.everyone,
      arrival: { chip: flipToggleWalls, monster: flipToggleWalls, block: flipToggleWalls }
    }
  }
};

function rigOf(rows: string[], glyphs: Record<string, string>, extra: LynxLevelOptions = {}): LynxRig {
  return new LynxRig(lynxLevel(rows, { glyphs, ...extra }), { modules: [specialWallRules, greenButtonStub] });
}

const terrainAt = (rig: LynxRig, x: number, y: number): string => rig.engine.getTerrain()[y][x];

describe('special walls', () => {
  it('E9 a recessed wall closes behind Chip, who may still leave it', () => {
    const rig = rigOf(['#####', '#@R.#', '#####'], { R: 'recessed_wall' });
    rig.press('E');
    rig.afterTick(3);
    expect(terrainAt(rig, 2, 1)).toBe('wall');
    expect(rig.player.x).toBe(2);
    rig.press('E');
    rig.afterTick(4);
    expect(rig.player.x).toBe(3);
    rig.afterTick(7);
    rig.press('W');
    rig.afterTick(8);
    expect(rig.player).toMatchObject({ x: 3, dir: 'W' });
  });

  it.each(['appearing_wall', 'blue_wall_real'])('E10 %s turns into a wall when Chip tries to enter', (id) => {
    const rig = rigOf(['####', '#@A#', '####'], { A: id });
    rig.press('E');
    rig.afterTick(0);
    expect(terrainAt(rig, 2, 1)).toBe('wall');
    expect(rig.player).toMatchObject({ x: 1, dir: 'E' });
    expect(rig.soundCount('blocked')).toBe(1);
  });

  it('E10 an invisible wall refuses Chip and never changes', () => {
    const rig = rigOf(['####', '#@A#', '####'], { A: 'invisible_wall' });
    rig.press('E');
    rig.afterTick(0);
    expect(terrainAt(rig, 2, 1)).toBe('invisible_wall');
    expect(rig.player.x).toBe(1);
  });

  it('E10 a fake blue wall lets Chip in and becomes floor, but stops monsters', () => {
    const rig = rigOf(['#####', '#@f.#', '#####'], { f: 'blue_wall_fake' });
    rig.press('E');
    rig.afterTick(3);
    expect(terrainAt(rig, 2, 1)).toBe('floor');
    expect(rig.player.x).toBe(2);

    const ball = rigOf(['#####', '#.f.#', '#####', '#@#'], { f: 'blue_wall_fake' }, {
      entities: [monster('pink_ball', 1, 1, 'E')]
    });
    ball.afterTick(0);
    expect(ball.entities[0]).toMatchObject({ x: 1, y: 1, dir: 'W' });
    expect(terrainAt(ball, 2, 1)).toBe('blue_wall_fake');
  });

  it('keeps hidden walls hidden from monster decisions and block tests', () => {
    const ball = rigOf(['#####', '#.A.#', '#####', '#@#'], { A: 'appearing_wall' }, {
      entities: [monster('pink_ball', 1, 1, 'E')]
    });
    ball.tick(4);
    expect(terrainAt(ball, 2, 1)).toBe('appearing_wall');

    const block = rigOf(['#####', '#@BA#', '#####'], { A: 'blue_wall_real' });
    block.press('E');
    block.afterTick(0);
    expect(terrainAt(block, 3, 1)).toBe('blue_wall_real');
    expect(block.player.x).toBe(1);

    const fake = rigOf(['######', '#@Bf.#', '######'], { f: 'blue_wall_fake' });
    fake.press('E');
    fake.afterTick(0);
    expect(fake.player.x).toBe(1);
  });

  it('E11 and G1 a green button flips the toggle walls, for Chip and for a monster', () => {
    const glyphs = { k: GREEN_BUTTON, o: TOGGLE_OPEN, c: TOGGLE_CLOSED };
    const rig = rigOf(['########', '#@k.oc.#', '########'], glyphs);
    rig.press('E');
    rig.afterTick(3);
    expect(terrainAt(rig, 4, 1)).toBe(TOGGLE_CLOSED);
    expect(terrainAt(rig, 5, 1)).toBe(TOGGLE_OPEN);

    const ball = rigOf(['########', '#.k.oc.#', '########', '#@#'], glyphs, {
      entities: [monster('pink_ball', 1, 1, 'E')]
    });
    ball.afterTick(2);
    expect(terrainAt(ball, 4, 1)).toBe(TOGGLE_OPEN);
    ball.afterTick(3);
    expect(terrainAt(ball, 4, 1)).toBe(TOGGLE_CLOSED);
    expect(terrainAt(ball, 5, 1)).toBe(TOGGLE_OPEN);
  });

  it('lets Chip into an open toggle wall and refuses a closed one', () => {
    const rig = rigOf(['######', '#@oc.#', '######'], { o: TOGGLE_OPEN, c: TOGGLE_CLOSED });
    rig.hold('E');
    rig.afterTick(3);
    expect(rig.player.x).toBe(2);
    rig.afterTick(7);
    expect(rig.player).toMatchObject({ x: 2, dir: 'E' });
    expect(rig.soundCount('blocked')).toBe(1);
  });
});
