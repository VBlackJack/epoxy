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
import { cc3dLevel, panelled, terrain } from './cc3dTestMaps';
import { Cc3dRig } from './cc3dTestRig';
import type { Direction } from '../types';

beforeAll(() => {
  loadTestConfigs();
});

const SETTLE_TICKS = 40;

describe('floors and walls: the simple kinds', () => {
  it('a wall blocks and the blocked sound plays once per bump', () => {
    const rig = new Cc3dRig(cc3dLevel(['###', '#@#', '###']));
    rig.hold('E');
    rig.tick(10);
    expect(rig.player.x).toBe(1);
    expect(rig.soundCount('blocked')).toBe(1);
  });

  it('water kills without the water orb', () => {
    const rig = new Cc3dRig(cc3dLevel(['#@W.#']));
    rig.walk('E', 'E');
    expect(rig.player.alive).toBe(false);
    expect(rig.player.deathReasonKey).toBe('hud.messages.death_water');
    expect(rig.visualsOf('splash')).toHaveLength(1);
  });

  it('water is safe with the water orb', () => {
    const rig = new Cc3dRig(cc3dLevel(['#@wW.#']));
    rig.walk('E', 'E', 'E');
    expect(rig.player.alive).toBe(true);
    expect(rig.player.x).toBe(4);
  });

  it('fire kills without the fire orb and is safe with it', () => {
    const dead = new Cc3dRig(cc3dLevel(['#@F.#']));
    dead.walk('E');
    expect(dead.player.deathReasonKey).toBe('hud.messages.death_fire');
    const safe = new Cc3dRig(cc3dLevel(['#@fF.#']));
    safe.walk('E', 'E', 'E');
    expect(safe.player.alive).toBe(true);
    expect(safe.player.x).toBe(4);
  });

  it('slime kills the player, orb or not [U]', () => {
    const rig = new Cc3dRig(cc3dLevel(['#@wL.#']));
    rig.walk('E', 'E');
    expect(rig.player.alive).toBe(false);
    expect(rig.player.deathReasonKey).toBe('hud.messages.death_slime');
  });

  it('a bomb kills the player and is used up', () => {
    const rig = new Cc3dRig(cc3dLevel(['#@O.#']));
    rig.walk('E');
    expect(rig.player.deathReasonKey).toBe('hud.messages.death_bomb');
    expect(rig.terrainAt(2, 0)).toBe('floor');
  });

  it('the exit wins once and reports the score', () => {
    const rig = new Cc3dRig(cc3dLevel(['#@X#']));
    rig.walk('E');
    rig.tick(5);
    expect(rig.engine.isLevelCompleted()).toBe(true);
    expect(rig.wins).toHaveLength(1);
    expect(rig.wins[0].moves).toEqual(['E']);
    expect(rig.visualsOf('win')).toHaveLength(1);
  });

  it('dirt is cleared by the player walking in', () => {
    const rig = new Cc3dRig(cc3dLevel(['#@D.#']));
    rig.walk('E');
    expect(rig.player.x).toBe(2);
    expect(rig.terrainAt(2, 0)).toBe('floor');
  });

  it('gravel and sand are crossed by the player', () => {
    const rig = new Cc3dRig(cc3dLevel(['#@GA.#']));
    rig.walk('E', 'E', 'E');
    expect(rig.player.x).toBe(4);
  });

  it('a turtle becomes water once the player has left it', () => {
    const rig = new Cc3dRig(cc3dLevel(['#@T.#']));
    rig.walk('E');
    expect(rig.terrainAt(2, 0)).toBe('turtle');
    rig.walk('E');
    expect(rig.terrainAt(2, 0)).toBe('water');
    expect(rig.player.alive).toBe(true);
  });

  it('a push up wall rises behind the player', () => {
    const rig = new Cc3dRig(cc3dLevel(['#@P.#']));
    rig.walk('E', 'E');
    expect(rig.terrainAt(2, 0)).toBe('wall');
    rig.walk('W');
    expect(rig.player.x).toBe(3);
  });

  it('an appearing wall turns into a wall when bumped', () => {
    const rig = new Cc3dRig(cc3dLevel(['#@Q.#']));
    expect(rig.terrainAt(2, 0)).toBe('appearing_wall');
    rig.walk('E');
    expect(rig.player.x).toBe(1);
    expect(rig.terrainAt(2, 0)).toBe('wall');
  });

  it('a false wall lets the player through and disappears', () => {
    const rig = new Cc3dRig(cc3dLevel(['#@V.#']));
    rig.walk('E');
    expect(rig.player.x).toBe(2);
    expect(rig.terrainAt(2, 0)).toBe('floor');
  });

  it('open toggle doors let the player pass, closed ones do not', () => {
    const open = new Cc3dRig(cc3dLevel(['#@j.#']));
    open.walk('E', 'E');
    expect(open.player.x).toBe(3);
    const closed = new Cc3dRig(cc3dLevel(['#@J.#']));
    closed.walk('E');
    expect(closed.player.x).toBe(1);
  });

  it('a hold door with no plate of its colour stays closed [U]', () => {
    const rig = new Cc3dRig(cc3dLevel(['#@h.#']));
    rig.walk('E');
    expect(rig.player.x).toBe(1);
  });

  it('a panel blocks its side, leaving and entering', () => {
    const leaving = new Cc3dRig(cc3dLevel(['#@..#'], { glyphs: { '@': panelled('E') } }));
    leaving.walk('E');
    expect(leaving.player.x).toBe(1);
    const entering = new Cc3dRig(cc3dLevel(['#@..#'], { glyphs: { '.': panelled('W') } }));
    entering.walk('E');
    expect(entering.player.x).toBe(1);
    const across = new Cc3dRig(cc3dLevel(['#@..#'], { glyphs: { '@': panelled('N', 'S') } }));
    across.walk('E');
    expect(across.player.x).toBe(2);
  });
});

describe('ice', () => {
  it('[P] sliding into an obstacle sends the player back the way it came', () => {
    const rig = new Cc3dRig(cc3dLevel(['#@IIII#']));
    rig.press('E');
    let sawReturn = false;
    for (let i = 0; i < SETTLE_TICKS; i++) {
      rig.tick();
      const p = rig.player;
      if (p.dir === 'W' && p.x > 1 && p.isSliding) sawReturn = true;
    }
    expect(sawReturn).toBe(true);
    expect(rig.player.x).toBe(1);
    expect(rig.player.alive).toBe(true);
    expect(rig.player.isSliding).toBe(false);
  });

  it('[S] entering ice is already a fast step, and the slide goes on at fast speed until it reaches non-ice', () => {
    const rig = new Cc3dRig(cc3dLevel(['#@II..#']));
    rig.press('E');
    rig.afterTick(0);
    expect(rig.player.x).toBe(2);
    expect(rig.player.moveCooldown).toBe(1);
    rig.afterTick(2);
    expect(rig.player.x).toBe(3);
    expect(rig.player.moveCooldown).toBe(1);
    expect(rig.player.isSliding).toBe(true);
    rig.tick(SETTLE_TICKS);
    expect(rig.player.x).toBe(4);
  });

  it('ignores input while sliding', () => {
    const rig = new Cc3dRig(cc3dLevel(['#.#.#', '#@II.', '#.#.#']));
    rig.press('E');
    rig.tick(4);
    rig.press('N');
    rig.tick(SETTLE_TICKS);
    expect(rig.player.y).toBe(1);
    expect(rig.player.x).toBe(4);
  });

  it('the ice orb lets the player walk on ice normally', () => {
    const rig = new Cc3dRig(cc3dLevel(['#@aII#']));
    rig.walk('E', 'E');
    rig.tick(SETTLE_TICKS);
    expect(rig.player.x).toBe(3);
  });

  it('an ice corner turns the slide towards its open side [U]', () => {
    const glyphs = { c: terrain('ice_corner', { corner: ['S', 'E'] }) };
    const rig = new Cc3dRig(cc3dLevel(['###.#', '#@Ic#', '#####'], { glyphs }));
    rig.press('E');
    rig.tick(SETTLE_TICKS);
    expect(rig.player.x).toBe(3);
    expect(rig.player.y).toBe(0);
  });

  it('an ice corner cannot be entered through a closed side', () => {
    const glyphs = { c: terrain('ice_corner', { corner: ['S', 'E'] }) };
    const rig = new Cc3dRig(cc3dLevel(['###', '#c#', '#@#', '###'], { glyphs }));
    rig.walk('N');
    expect(rig.player.y).toBe(2);
  });
});

describe('force floors', () => {
  it('carries at fast speed, repeatedly; entering a force floor is already a fast step [S]', () => {
    const rig = new Cc3dRig(cc3dLevel(['#@>>>.#']));
    rig.press('E');
    rig.afterTick(0);
    expect(rig.player.moveCooldown).toBe(1);
    rig.afterTick(2);
    expect(rig.player.x).toBe(3);
    expect(rig.player.moveCooldown).toBe(1);
    rig.afterTick(4);
    expect(rig.player.x).toBe(4);
    rig.afterTick(6);
    expect(rig.player.x).toBe(5);
    rig.tick(SETTLE_TICKS);
    expect(rig.player.x).toBe(5);
  });

  it('[P] the player can step off a force floor sideways', () => {
    const rows = ['#####', '#.^.#', '#.^.#', '#.@.#', '#####'];
    const rig = new Cc3dRig(cc3dLevel(rows));
    rig.press('N');
    rig.tick(1);
    expect(rig.player.y).toBe(2);
    rig.hold('W');
    rig.tick(4);
    expect(rig.player.x).toBe(1);
    expect(rig.player.y).toBe(2);
  });

  it('without input the player is carried along the column', () => {
    const rows = ['#####', '#.^.#', '#.^.#', '#.@.#', '#####'];
    const rig = new Cc3dRig(cc3dLevel(rows));
    rig.walk('N');
    rig.tick(SETTLE_TICKS);
    expect(rig.player.x).toBe(2);
    expect(rig.player.y).toBe(1);
  });

  it('input along the force axis does not fight the floor', () => {
    const rows = ['#####', '#.^.#', '#.^.#', '#.@.#', '#####'];
    const rig = new Cc3dRig(cc3dLevel(rows));
    rig.walk('N');
    rig.hold('S');
    rig.tick(SETTLE_TICKS);
    expect(rig.player.y).toBe(1);
  });

  it('the force orb cancels the floor', () => {
    const rig = new Cc3dRig(cc3dLevel(['#@o>..#']));
    rig.walk('E', 'E');
    rig.tick(SETTLE_TICKS);
    expect(rig.player.x).toBe(3);
  });

  it('[S] a random force floor sends successive entries east, south, west, north', () => {
    const rows = ['#####', '#...#', '#@?.#', '#...#', '#####'];
    const rig = new Cc3dRig(cc3dLevel(rows));
    const expected: Array<[Direction, number, number]> = [
      ['E', 3, 2],
      ['W', 2, 3],
      ['N', 1, 2],
      ['E', 2, 1]
    ];
    for (const [dir, x, y] of expected) {
      rig.walk(dir);
      rig.tick(SETTLE_TICKS);
      expect([rig.player.x, rig.player.y]).toEqual([x, y]);
    }
  });

  it('the random force counter is part of undo', () => {
    const rig = new Cc3dRig(cc3dLevel(['#####', '#...#', '#@?.#', '#...#', '#####']));
    rig.walk('E');
    rig.tick(SETTLE_TICKS);
    expect(rig.player.x).toBe(3);
    rig.engine.undo();
    rig.walk('E');
    rig.tick(SETTLE_TICKS);
    expect(rig.player.x).toBe(3);
  });
});

describe('teleports', () => {
  it('[P] sends the mover to the previous teleport of the colour in reading order', () => {
    const rig = new Cc3dRig(cc3dLevel(['#.k.#', '#@k.#', '#.k.#']));
    rig.walk('E');
    rig.tick(SETTLE_TICKS);
    expect([rig.player.x, rig.player.y]).toEqual([3, 0]);
  });

  it('[P] wraps from the first teleport to the last', () => {
    const rig = new Cc3dRig(cc3dLevel(['#@k.#', '#.k.#', '#.k.#']));
    rig.walk('E');
    rig.tick(SETTLE_TICKS);
    expect([rig.player.x, rig.player.y]).toEqual([3, 2]);
  });

  it('red teleports follow the same order [U]', () => {
    const rig = new Cc3dRig(cc3dLevel(['#.t.#', '#@t.#', '#.t.#']));
    rig.walk('E');
    rig.tick(SETTLE_TICKS);
    expect([rig.player.x, rig.player.y]).toEqual([3, 0]);
  });

  it('[observed] a red teleport against an edge exits to the right first', () => {
    const rig = new Cc3dRig(cc3dLevel(['#####.#', '#@t..t#', '#####.#']));
    rig.walk('E');
    rig.tick(SETTLE_TICKS);
    expect([rig.player.x, rig.player.y]).toEqual([5, 2]);
  });

  it('[U] when the exit of the previous teleport is walled, the mover comes out of the one before it', () => {
    const rig = new Cc3dRig(cc3dLevel(['#.k##', '#@k.#', '#.k.#']));
    rig.walk('E');
    rig.tick(SETTLE_TICKS);
    expect([rig.player.x, rig.player.y]).toEqual([3, 2]);
  });

  it('a red teleport sends the player to the other one, leaving in its own direction', () => {
    const rig = new Cc3dRig(cc3dLevel(['#@t..t.#']));
    rig.walk('E');
    rig.tick(SETTLE_TICKS);
    expect(rig.player.x).toBe(6);
    expect(rig.visualsOf('teleport')).toHaveLength(2);
  });

  it('a blue teleport leaves only in its own direction', () => {
    const open = new Cc3dRig(cc3dLevel(['#@k..k.#']));
    open.walk('E');
    open.tick(SETTLE_TICKS);
    expect(open.player.x).toBe(6);
    const blocked = new Cc3dRig(cc3dLevel(['#######', '#@k..k#', '#####.#', '#######']));
    blocked.walk('E');
    blocked.tick(SETTLE_TICKS);
    expect([blocked.player.x, blocked.player.y]).toEqual([2, 1]);
  });
});
