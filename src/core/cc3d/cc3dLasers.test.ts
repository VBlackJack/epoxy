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

import { DIRECTION_VECTORS } from '../../config/constants';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import type { Direction } from '../types';
import { cc3dLevel, panelled, stacked } from './cc3dTestMaps';
import type { GlyphMeaning } from './cc3dTestMaps';
import { Cc3dRig } from './cc3dTestRig';

beforeAll(() => {
  loadTestConfigs();
});

const SETTLE_TICKS = 60;
const GOLEM = 'cc3d_golem_yellow';

const golem: GlyphMeaning = { mob: { kind: 'golem_yellow', dir: 'E' } };
const controller = stacked({ kind: 'floor' }, { kind: 'laser_controller' });

function shooter(dir: Direction): GlyphMeaning {
  return { mob: { kind: 'laser_shooter', dir } };
}

function bot(kind: 'bot_static' | 'bot_cw' | 'bot_ccw' | 'bot_multi', dir: Direction): GlyphMeaning {
  return { mob: { kind, dir } };
}

function golemsAt(rig: Cc3dRig): string[] {
  return rig.entities
    .filter((e) => e.type === GOLEM)
    .map((e) => `${e.x},${e.y}`)
    .sort();
}

/** The player walks onto the controller (east of him) and the shot is fired by the shooter beyond it. */
function fired(rows: string[], glyphs: Record<string, GlyphMeaning>): Cc3dRig {
  const rig = new Cc3dRig(cc3dLevel(rows, { glyphs: { S: shooter('E'), c: controller, '!': golem, ...glyphs } }));
  rig.walk('E');
  rig.tick(SETTLE_TICKS);
  return rig;
}

describe('controller, shooter and shot', () => {
  it('entering a controller fires the nearest shooter by straight-line distance; the shot kills what it reaches', () => {
    const rows = ['#S.!#', '#####', '#@c##', '#S.!#'];
    const rig = fired(rows, {});
    expect(golemsAt(rig)).toEqual(['3,0']);
    expect(rig.entities.some((e) => e.type === 'cc3d_shot')).toBe(false);
  });

  it('breaks a tie in reading order', () => {
    const rig = fired(['#S.!#', '#@c##', '#S.!#'], {});
    expect(golemsAt(rig)).toEqual(['3,2']);
  });

  it('[S] measures straight-line, not Manhattan, distance', () => {
    // From the controller at (2,1): Q at (5,1) is 3 away in a line (9 squared), P at (3,3) is 3 away by Manhattan but nearer in a line (5).
    const rows = ['#######', '#@c!.Q#', '#.....#', '#..P.!#'];
    const rig = fired(rows, { Q: shooter('W'), P: shooter('E') });
    expect(golemsAt(rig)).toEqual(['3,1']);
  });

  it('flies one cell per two ticks', () => {
    const rig = new Cc3dRig(cc3dLevel(['#@cS.....#'], { glyphs: { S: shooter('E'), c: controller } }));
    rig.walk('E');
    // Fired in tick 3 into the cell in front of the shooter.
    const shot = (): { x: number; cooldownTicks: number } | undefined => rig.entities.find((e) => e.type === 'cc3d_shot');
    expect(shot()).toMatchObject({ x: 4, cooldownTicks: 1 });
    rig.tick(2);
    expect(shot()?.x).toBe(5);
    rig.tick(2);
    expect(shot()?.x).toBe(6);
  });

  it('dies at once when the first cell is blocked', () => {
    const rig = new Cc3dRig(cc3dLevel(['#@cS#'], { glyphs: { S: shooter('E'), c: controller } }));
    rig.walk('E');
    expect(rig.entities.some((e) => e.type === 'cc3d_shot')).toBe(false);
  });

  it('[S] no relay: a shot that reaches a shooter stops, and that shooter does not fire', () => {
    const rig = fired(['#S.T#', '#@c.#', '###!#'], { T: shooter('S') });
    expect(golemsAt(rig)).toEqual(['3,2']);
    expect(rig.entities.filter((e) => e.type === 'cc3d_laser_shooter')).toHaveLength(2);
  });

  it('[S] two adjacent facing shooters: the shot stops at the other one', () => {
    const rig = fired(['#@cST#'], { T: shooter('W') });
    expect(rig.player.alive).toBe(true);
    expect(rig.entities.some((e) => e.type === 'cc3d_shot')).toBe(false);
    expect(rig.entities.filter((e) => e.type === 'cc3d_laser_shooter')).toHaveLength(2);
  });

  it('[S] the bump rule is gone: a shooter on a controller is only an obstacle', () => {
    const glyphs = { S: { stack: [{ kind: 'floor' as const }, { kind: 'laser_controller' as const }], mob: { kind: 'laser_shooter' as const, dir: 'E' as const } }, '!': golem };
    const rig = new Cc3dRig(cc3dLevel(['#@S.!#'], { glyphs }));
    rig.hold('E');
    rig.tick(SETTLE_TICKS);
    expect(rig.player.x).toBe(1);
    expect(rig.player.alive).toBe(true);
    expect(golemsAt(rig)).toEqual(['4,0']);
  });

  it('a plain shooter blocks the player without hurting him', () => {
    const rig = new Cc3dRig(cc3dLevel(['#@S.#'], { glyphs: { S: shooter('E') } }));
    rig.walk('E');
    expect(rig.player.x).toBe(1);
    expect(rig.player.alive).toBe(true);
  });

  it('the first cell in front of a shooter follows the same entry rule: a player there dies', () => {
    const rig = new Cc3dRig(cc3dLevel(['#@cS#'], { glyphs: { S: shooter('W'), c: controller } }));
    rig.walk('E');
    expect(rig.player.alive).toBe(false);
    expect(rig.player.deathReasonKey).toBe('hud.messages.death_laser');
  });

  it('a panel stops a shot on the side it crosses', () => {
    const entering = fired(['#@cS.!#'], { '.': panelled('W') });
    expect(golemsAt(entering)).toEqual(['5,0']);
    const leaving = fired(['#@cS.!#'], { S: { ...shooter('E'), panels: ['E'] } });
    expect(golemsAt(leaving)).toEqual(['5,0']);
  });

  it('melts an ice block into water; another block stops it', () => {
    const ice = fired(['#@cS.Z.!#'], {});
    expect(ice.entities.some((e) => e.type === 'ice_block')).toBe(false);
    expect(ice.terrainAt(5, 0)).toBe('water');
    expect(golemsAt(ice)).toEqual(['7,0']);
    const dirt = fired(['#@cS.K.!#'], {});
    expect(dirt.entities.some((e) => e.type === 'dirt_block')).toBe(true);
    expect(golemsAt(dirt)).toEqual(['7,0']);
  });

  it('[S] passes over water, fire, slime, ice, dirt, gravel, sand, gates, traps, plates and force floors', () => {
    const glyphs = {
      x: stacked({ kind: 'floor' }, { kind: 'trap' }),
      p: stacked({ kind: 'floor' }, { kind: 'plate', color: 'green' }),
      H: stacked({ kind: 'floor' }, { kind: 'hold_door', color: 'green', open: false })
    };
    const rig = fired(['#@cSWFLIDGANxp^!#', '#H###############'], glyphs);
    expect(golemsAt(rig)).toEqual([]);
    expect(rig.terrainAt(8, 0)).toBe('dirt');
    expect(rig.terrainAt(1, 1)).toBe('cc3d_hold_door_green_closed');
  });

  it('does not move through teleports', () => {
    const rig = fired(['#@cSk!#', '#k#####'], {});
    expect(golemsAt(rig)).toEqual([]);
  });

  it('[S] stops on a cell holding a key, an orb or a F.I.S.H., a closed door and a clone machine', () => {
    for (const glyph of ['r', 'a', 'i', '1']) {
      const rig = fired([`#@cS.${glyph}.!#`], {});
      expect(golemsAt(rig), glyph).toEqual(['7,0']);
    }
    const machine: GlyphMeaning = { stack: [{ kind: 'floor' }, { kind: 'clone_machine', dir: 'E' }] };
    const rig = fired(['#@cS.m.!#'], { m: machine });
    expect(golemsAt(rig)).toEqual(['7,0']);
  });

  it('sets off a bomb: the bomb and the shot are both gone', () => {
    const rig = fired(['#@cS.O.!#'], {});
    expect(rig.terrainAt(5, 0)).toBe('floor');
    expect(golemsAt(rig)).toEqual(['7,0']);
  });

  it('kills a security bot and a golem', () => {
    const bots = fired(['#@cS.B..#', '#########'], { B: bot('bot_static', 'S') });
    expect(bots.entities.some((e) => e.type === 'cc3d_bot_static')).toBe(false);
    const golems = fired(['#@cS.!#'], {});
    expect(golemsAt(golems)).toEqual([]);
  });

  it('does not swap places with a monster walking towards it', () => {
    const rig = new Cc3dRig(cc3dLevel(['#@cS..B#'], { glyphs: { S: shooter('E'), c: controller, B: { mob: { kind: 'bouncer', dir: 'W' } } } }));
    rig.walk('E');
    rig.tick(SETTLE_TICKS);
    expect(rig.entities.some((e) => e.type === 'pink_ball')).toBe(false);
    expect(rig.entities.some((e) => e.type === 'cc3d_shot')).toBe(false);
    expect(rig.entities.some((e) => e.type === 'cc3d_laser_shooter')).toBe(true);
  });

  it('walking into a flying shot kills the walker and spends the shot', () => {
    const glyphs = { S: shooter('S'), c: controller };
    const rig = new Cc3dRig(cc3dLevel(['#..S#', '#@c.#', '###.#'], { glyphs }));
    rig.walk('E');
    rig.press('E');
    rig.tick(1);
    expect(rig.player.alive).toBe(false);
    expect(rig.player.deathReasonKey).toBe('hud.messages.death_laser');
    expect(rig.entities.some((e) => e.type === 'cc3d_shot')).toBe(false);
  });

  it('[S] any switch-pressing mob works a controller: a block pushed onto it fires the shooter', () => {
    const rig = new Cc3dRig(cc3dLevel(['#@Kc.S.!#'], { glyphs: { S: shooter('E'), c: controller, '!': golem } }));
    rig.walk('E');
    rig.tick(SETTLE_TICKS);
    expect(golemsAt(rig)).toEqual([]);
  });
});

describe('reflectors (reading Z table)', () => {
  const VECTOR = DIRECTION_VECTORS;
  const OPPOSITE: Record<Direction, Direction> = { N: 'S', E: 'W', S: 'N', W: 'E' };
  /** mirror -> travel direction -> the direction the shot leaves in (absent: back face, both are destroyed). */
  const TABLE: Record<string, Partial<Record<Direction, Direction>>> = {
    LU: { E: 'S', N: 'W' },
    DL: { S: 'W', E: 'N' },
    UR: { N: 'E', W: 'S' },
    RD: { W: 'N', S: 'E' }
  };
  const SIZE = 7;
  const CENTRE = 3;

  function room(mirror: string, travel: Direction): Cc3dRig {
    const grid: string[][] = Array.from({ length: SIZE }, (_, y) =>
      Array.from({ length: SIZE }, (_, x) => (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1 ? '#' : '.'))
    );
    const put = (dx: number, dy: number, glyph: string): void => {
      grid[CENTRE + dy][CENTRE + dx] = glyph;
    };
    const v = VECTOR[travel];
    put(0, 0, 'R');
    put(-v.dx, -v.dy, 'S');
    for (const d of ['N', 'E', 'S', 'W'] as const) {
      if (d !== OPPOSITE[travel]) put(VECTOR[d].dx, VECTOR[d].dy, '!');
    }
    grid[1][1] = '@';
    grid[1][2] = 'c';
    return new Cc3dRig(
      cc3dLevel(
        grid.map((row) => row.join('')),
        { glyphs: { S: shooter(travel), R: { mob: { kind: 'reflector', mirror } }, '!': golem, c: controller } }
      )
    );
  }

  for (const mirror of Object.keys(TABLE)) {
    for (const travel of ['N', 'E', 'S', 'W'] as const) {
      const out = TABLE[mirror][travel];
      it(`${mirror}: a shot travelling ${travel} ${out ? `leaves ${out}` : 'destroys itself and the reflector on the back face'}`, () => {
        const rig = room(mirror, travel);
        const before = golemsAt(rig);
        rig.walk('E');
        rig.tick(SETTLE_TICKS);
        const killed = before.filter((g) => !golemsAt(rig).includes(g));
        const reflectorId = `cc3d_reflector_${mirror.toLowerCase()}`;
        if (out) {
          expect(killed).toEqual([`${CENTRE + VECTOR[out].dx},${CENTRE + VECTOR[out].dy}`]);
          expect(rig.entities.some((e) => e.type === reflectorId)).toBe(true);
        } else {
          expect(killed).toEqual([]);
          expect(rig.entities.some((e) => e.type === reflectorId)).toBe(false);
        }
        expect(rig.entities.some((e) => e.type === 'cc3d_shot')).toBe(false);
      });
    }
  }
});

describe('undo', () => {
  it('restores a shot in flight', () => {
    const glyphs = { S: shooter('E'), c: controller };
    const rig = new Cc3dRig(cc3dLevel(['#@cS......#'], { glyphs }));
    rig.walk('E');
    expect(rig.entities.some((e) => e.type === 'cc3d_shot')).toBe(true);
    rig.walk('W');
    expect(rig.player.x).toBe(1);
    rig.engine.undo();
    expect(rig.player.x).toBe(2);
    expect(rig.entities.filter((e) => e.type === 'cc3d_shot')).toHaveLength(1);
    rig.engine.undo();
    expect(rig.entities.some((e) => e.type === 'cc3d_shot')).toBe(false);
    expect(rig.player.x).toBe(1);
  });
});

describe('security bots', () => {
  const beamX = (rig: Cc3dRig): number[] =>
    rig.engine
      .getBeamCells()
      .map((c) => c.x)
      .sort();

  it('project a beam of three cells from the next cell in their facing', () => {
    const rig = new Cc3dRig(cc3dLevel(['#B.....#', '#######', '#@#####'], { glyphs: { B: bot('bot_static', 'E') } }));
    rig.tick(1);
    expect(beamX(rig)).toEqual([2, 3, 4]);
    expect(rig.engine.getBeamCells().every((c) => c.horizontal && !c.vertical)).toBe(true);
  });

  it('[P] do nothing before the player has started a first step, then are always on', () => {
    const rows = ['#B.@..#', '#######', '#@.####'];
    const rig = new Cc3dRig(cc3dLevel(rows, { glyphs: { B: bot('bot_static', 'E'), '@': { stack: [{ kind: 'floor' }] } } }), undefined, false);
    rig.tick(10);
    expect(rig.engine.getBeamCells()).toEqual([]);
  });

  it('kill the player standing in the beam, covering his cell and stopping there', () => {
    const rig = new Cc3dRig(cc3dLevel(['#B.@..#'], { glyphs: { B: bot('bot_static', 'E') } }));
    rig.tick(1);
    expect(rig.player.alive).toBe(false);
    expect(rig.player.deathReasonKey).toBe('hud.messages.death_laser');
    expect(beamX(rig)).toEqual([2, 3]);
  });

  it('kill a monster, stop at it and leave blocks unharmed', () => {
    const monster = new Cc3dRig(cc3dLevel(['#B.!..#', '#######', '#@#####'], { glyphs: { B: bot('bot_static', 'E'), '!': golem } }));
    monster.tick(1);
    expect(golemsAt(monster)).toEqual([]);
    expect(beamX(monster)).toEqual([2, 3]);
    const block = new Cc3dRig(cc3dLevel(['#B.K..#', '#######', '#@#####'], { glyphs: { B: bot('bot_static', 'E') } }));
    block.tick(1);
    expect(block.entities.some((e) => e.type === 'dirt_block')).toBe(true);
    expect(beamX(block)).toEqual([2]);
  });

  it('are stopped by a panel on the side the beam crosses', () => {
    const stopped = new Cc3dRig(cc3dLevel(['#Bp...#', '#######', '#@#####'], { glyphs: { B: bot('bot_static', 'E'), p: panelled('W') } }));
    stopped.tick(1);
    expect(beamX(stopped)).toEqual([]);
    const leaving = new Cc3dRig(cc3dLevel(['#B.p...#', '#######', '#@#####'], { glyphs: { B: bot('bot_static', 'E'), p: panelled('E') } }));
    leaving.tick(1);
    expect(beamX(leaving)).toEqual([2, 3]);
  });

  it('are stopped by a cell a block could not enter, and by a wall', () => {
    const rig = new Cc3dRig(cc3dLevel(['#B.F..#', '#######', '#@#####'], { glyphs: { B: bot('bot_static', 'E') } }));
    rig.tick(1);
    expect(beamX(rig)).toEqual([2]);
    const wall = new Cc3dRig(cc3dLevel(['#B#...#', '#######', '#@#####'], { glyphs: { B: bot('bot_static', 'E') } }));
    wall.tick(1);
    expect(beamX(wall)).toEqual([]);
  });

  it('[U] are stopped, uncovered, at items, gates, the exit, fire and clone machines', () => {
    const machine: GlyphMeaning = { stack: [{ kind: 'floor' }, { kind: 'clone_machine', dir: 'E' }] };
    for (const glyph of ['r', 'a', 'i', 'N', 'n', 'X', 'F', 'm']) {
      const rig = new Cc3dRig(cc3dLevel(['#B.' + glyph + '..#', '#######', '#@#####'], { glyphs: { B: bot('bot_static', 'E'), m: machine } }));
      rig.tick(1);
      expect(beamX(rig), glyph).toEqual([2]);
    }
  });

  it('a multidirectional bot projects in all four directions', () => {
    const rows = ['#######', '#.....#', '#.....#', '#..B..#', '#.....#', '#.....#', '#######', '#@#####'];
    const rig = new Cc3dRig(cc3dLevel(rows, { glyphs: { B: bot('bot_multi', 'N') } }));
    rig.tick(1);
    expect(rig.engine.getBeamCells()).toHaveLength(8);
  });

  it('[S] the rotating bots turn once at the start of play, then every three seconds', () => {
    const rows = ['#######', '#.....#', '#.....#', '#..B..#', '#.....#', '#.....#', '#######', '#@#####'];
    for (const [kind, sequence] of [
      ['bot_cw', ['S', 'W', 'N']],
      ['bot_ccw', ['N', 'W', 'S']]
    ] as const) {
      const rig = new Cc3dRig(cc3dLevel(rows, { glyphs: { B: bot(kind, 'E') } }));
      const facing = (): string | undefined => rig.entities.find((e) => e.type.startsWith('cc3d_bot'))?.dir;
      rig.afterTick(59);
      expect(facing()).toBe(sequence[0]);
      rig.afterTick(60);
      expect(facing()).toBe(sequence[1]);
      rig.afterTick(120);
      expect(facing()).toBe(sequence[2]);
    }
  });

  it('[P] a rotating bot waits for the first step, then turns once on that tick', () => {
    const rows = ['#######', '#.....#', '#.....#', '#..B..#', '#.....#', '#.....#', '#######', '#@.####'];
    const rig = new Cc3dRig(cc3dLevel(rows, { glyphs: { B: bot('bot_cw', 'E') } }), undefined, false);
    rig.tick(10);
    expect(rig.entities.find((e) => e.type === 'cc3d_bot_cw')?.dir).toBe('E');
    rig.press('E');
    rig.tick(1);
    expect(rig.entities.find((e) => e.type === 'cc3d_bot_cw')?.dir).toBe('S');
    expect(rig.engine.getBeamCells().length).toBeGreaterThan(0);
  });

  it('never move by themselves but can be pushed by the player, keeping their facing', () => {
    const rig = new Cc3dRig(cc3dLevel(['#@B...#'], { glyphs: { B: bot('bot_static', 'E') } }));
    rig.tick(SETTLE_TICKS / 2);
    expect(rig.entityAt(2, 0)).toBeDefined();
    rig.walk('E');
    expect(rig.player.x).toBe(2);
    expect(rig.entityAt(3, 0)?.type).toBe('cc3d_bot_static');
    expect(rig.entityAt(3, 0)?.dir).toBe('E');
    rig.tick(1);
    expect(beamX(rig)).toEqual([4, 5]);
  });

  it('a player walking into a beam dies', () => {
    const rig = new Cc3dRig(cc3dLevel(['#B....#', '###.###', '###@###'], { glyphs: { B: bot('bot_static', 'E') } }));
    rig.walk('N');
    expect(rig.player.alive).toBe(true);
    rig.walk('N');
    expect(rig.player.alive).toBe(false);
  });

  it('reports no beam without bots', () => {
    const rig = new Cc3dRig(cc3dLevel(['#@..#']));
    rig.tick(3);
    expect(rig.engine.getBeamCells()).toEqual([]);
  });
});

describe('review fixes (P3)', () => {
  const reflector = (mirror: string): GlyphMeaning => ({ mob: { kind: 'reflector', mirror } });

  it('a reflector loop sending the shot back to its shooter stops it there', () => {
    const rows = ['#######', '#@c...#', '#.S..L#', '#.....#', '#.....#', '#.R..D#', '#######'];
    const glyphs = { S: shooter('E'), c: controller, L: reflector('LU'), D: reflector('DL'), R: reflector('RD') };
    const rig = new Cc3dRig(cc3dLevel(rows, { glyphs }));
    rig.walk('E');
    expect(rig.entities.some((e) => e.type === 'cc3d_shot')).toBe(true);
    rig.tick(200);
    expect(rig.entities.some((e) => e.type === 'cc3d_shot')).toBe(false);
    expect(rig.entities.some((e) => e.type === 'cc3d_laser_shooter')).toBe(true);
  });

  it('a beam covers a player standing on a floating colour block', () => {
    const rig = new Cc3dRig(cc3dLevel(['#BWC@.#'], { glyphs: { B: bot('bot_static', 'E') } }));
    rig.walk('W');
    expect(rig.player.alive).toBe(true);
    rig.walk('W');
    expect(rig.player.alive).toBe(false);
  });

  it('a monster covered by two beams dies once', () => {
    const rows = ['#B.!.b#', '#######', '#@#####'];
    const rig = new Cc3dRig(cc3dLevel(rows, { glyphs: { B: bot('bot_static', 'E'), b: bot('bot_static', 'W'), '!': golem } }));
    rig.tick(1);
    expect(golemsAt(rig)).toEqual([]);
    expect(rig.visualsOf('explosion')).toHaveLength(1);
  });

  it('a player stepping into the cell of a reflector a shot is crossing dies [U]', () => {
    const rig = new Cc3dRig(cc3dLevel(['#SLc@#'], { glyphs: { S: shooter('E'), L: reflector('LU'), c: controller } }));
    rig.walk('W');
    rig.press('W');
    rig.tick(1);
    expect(rig.player.alive).toBe(false);
    expect(rig.player.deathReasonKey).toBe('hud.messages.death_laser');
    expect(rig.entities.some((e) => e.type === 'cc3d_reflector_lu')).toBe(true);
  });

  it('undo restores the facing of a rotating bot', () => {
    const rows = ['#######', '#.....#', '#.....#', '#..B..#', '#.....#', '#.....#', '#######', '#@.####'];
    const rig = new Cc3dRig(cc3dLevel(rows, { glyphs: { B: bot('bot_cw', 'E') } }));
    rig.tick(62);
    rig.walk('E');
    rig.tick(70);
    expect(rig.entities.find((e) => e.type === 'cc3d_bot_cw')?.dir).toBe('N');
    rig.engine.undo();
    expect(rig.entities.find((e) => e.type === 'cc3d_bot_cw')?.dir).toBe('W');
    expect(rig.engine.getBeamCells().every((c) => c.horizontal)).toBe(true);
  });
});
