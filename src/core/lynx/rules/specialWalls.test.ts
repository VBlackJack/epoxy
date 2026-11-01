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
import { ENTITY } from '../lynxConstants';
import { GlyphOverride, lynxLevel, LynxLevelOptions, monster } from '../lynxTestMaps';
import { LynxRig } from '../lynxTestRig';
import { RuleContext, RuleModule } from '../ruleApi';
import { ADMISSION } from '../tileRules';
import { forceFloorRules } from './forceFloors';
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

function rigOf(rows: string[], glyphs: Record<string, GlyphOverride>, extra: LynxLevelOptions = {}): LynxRig {
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

  describe('D11 a block standing on a hidden wall is still pushed', () => {
    const MAP = ['###', '#.#', '#B#', '#@#', '###'];
    const BLOCK_START = { x: 1, y: 2 };
    const BLOCK_END_Y = 1;
    const ARRIVAL_TICK = 3;
    const FOLLOWING_TICKS = 4;
    const FORCED_FIRST_TICK = 1;

    /** A forced move starts one tick after the level does (spec 13.4), a chosen one at tick 0. */
    function expectPushedThenWall(rig: LynxRig, firstTick: number): void {
      rig.afterTick(firstTick);
      expect(rig.entityAt(BLOCK_START.x, BLOCK_END_Y)).toMatchObject({ x: 1, y: BLOCK_END_Y });
      expect(rig.entityAt(BLOCK_START.x, BLOCK_START.y)).toBeUndefined();
      expect(rig.player).toMatchObject({ x: 1, y: 3 });
      expect(rig.soundCount('blocked')).toBe(1);
      expect(terrainAt(rig, BLOCK_START.x, BLOCK_START.y)).toBe('wall');
      rig.afterTick(firstTick + ARRIVAL_TICK);
      expect(rig.entityAt(1, BLOCK_END_Y)).toMatchObject({ x: 1, y: BLOCK_END_Y });
      for (let k = firstTick + ARRIVAL_TICK + 1; k < firstTick + ARRIVAL_TICK + 1 + FOLLOWING_TICKS; k++) {
        rig.afterTick(k);
        expect(rig.player).toMatchObject({ x: 1, y: 3 });
      }
      expect(terrainAt(rig, BLOCK_START.x, BLOCK_START.y)).toBe('wall');
    }

    it.each(['appearing_wall', 'blue_wall_real'])('pushes at decision time over %s, then Chip bumps', (id) => {
      const rig = rigOf(MAP, { B: { terrain: id, entity: { type: ENTITY.block } } });
      rig.hold('N');
      expectPushedThenWall(rig, 0);
    });

    it.each(['appearing_wall', 'blue_wall_real'])('pushes at Chip\'s turn over %s when he is carried', (id) => {
      const rig = new LynxRig(
        lynxLevel(MAP, { glyphs: { B: { terrain: id, entity: { type: ENTITY.block } }, '@': 'force_n' } }),
        { modules: [specialWallRules, forceFloorRules] }
      );
      expectPushedThenWall(rig, FORCED_FIRST_TICK);
    });
  });

  it.each(['appearing_wall', 'blue_wall_real'])(
    'D11 a block that cannot move on %s refuses Chip and the tile stays',
    (id) => {
      const rig = rigOf(['###', '#B#', '#@#', '###'], { B: { terrain: id, entity: { type: ENTITY.block } } });
      rig.hold('N');
      rig.tick(3);
      expect(rig.player).toMatchObject({ x: 1, y: 2 });
      expect(rig.entityAt(1, 1)).toMatchObject({ x: 1, y: 1 });
      expect(rig.soundCount('blocked')).toBe(1);
      expect(terrainAt(rig, 1, 1)).toBe(id);
    }
  );

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
