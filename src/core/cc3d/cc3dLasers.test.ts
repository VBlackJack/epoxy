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

/** A shooter that stands on a controller (38 of them do in the corpus). */
function mounted(dir: Direction): GlyphMeaning {
  return { stack: [{ kind: 'floor' }, { kind: 'laser_controller' }], mob: { kind: 'laser_shooter', dir } };
}

function bot(kind: 'bot_static' | 'bot_cw' | 'bot_ccw' | 'bot_multi', dir: Direction): GlyphMeaning {
  return { mob: { kind, dir } };
}

function golemsAt(rig: Cc3dRig): string[] {
  return rig.entities.filter((e) => e.type === GOLEM).map((e) => `${e.x},${e.y}`).sort();
}

describe('controller, shooter and shot', () => {
  it('entering a controller fires the nearest shooter; the shot kills what it reaches', () => {
    const rows = ['#S.!#', '#####', '#@c##', '#S.!#'];
    const rig = new Cc3dRig(cc3dLevel(rows, { glyphs: { S: shooter('E'), c: controller, '!': golem } }));
    rig.walk('E');
    rig.tick(SETTLE_TICKS);
    // The lower shooter is nearer to the controller (2 cells against 3).
    expect(golemsAt(rig)).toEqual(['3,0']);
    expect(rig.entities.some((e) => e.type === 'cc3d_shot')).toBe(false);
  });

  it('breaks a tie in reading order', () => {
    const rows = ['#S.!#', '#@c##', '#S.!#'];
    const rig = new Cc3dRig(cc3dLevel(rows, { glyphs: { S: shooter('E'), c: controller, '!': golem } }));
    rig.walk('E');
    rig.tick(SETTLE_TICKS);
    expect(golemsAt(rig)).toEqual(['3,2']);
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

  it('bumping a shooter that stands on a controller presses it, once per bump, without moving', () => {
    const rig = new Cc3dRig(cc3dLevel(['#@S.!#'], { glyphs: { S: mounted('E'), '!': golem } }));
    rig.hold('E');
    rig.tick(SETTLE_TICKS);
    expect(rig.player.x).toBe(1);
    expect(rig.player.alive).toBe(true);
    expect(golemsAt(rig)).toEqual([]);
  });

  it('a plain shooter blocks the player without hurting him', () => {
    const rig = new Cc3dRig(cc3dLevel(['#@S.#'], { glyphs: { S: shooter('E') } }));
    rig.walk('E');
    expect(rig.player.x).toBe(1);
    expect(rig.player.alive).toBe(true);
  });

  it('a shot that reaches a shooter makes it fire in its own facing (relay)', () => {
    const glyphs = { S: shooter('E'), T: shooter('S'), c: controller, '!': golem };
    const rig = new Cc3dRig(cc3dLevel(['#S.T#', '#@c.#', '###!#'], { glyphs }));
    rig.walk('E');
    rig.tick(SETTLE_TICKS);
    expect(golemsAt(rig)).toEqual([]);
    expect(rig.player.alive).toBe(true);
  });

  it('the first cell in front of a shooter follows the same entry rule: a player there dies', () => {
    const rig = new Cc3dRig(cc3dLevel(['#.S@.#'], { glyphs: { S: mounted('E') } }));
    rig.walk('W');
    expect(rig.player.alive).toBe(false);
    expect(rig.player.deathReasonKey).toBe('hud.messages.death_laser');
  });

  it('a panel stops a shot on the side it crosses', () => {
    const entering = new Cc3dRig(cc3dLevel(['#@S.!#'], { glyphs: { S: mounted('E'), '!': golem, '.': panelled('W') } }));
    entering.walk('E');
    entering.tick(SETTLE_TICKS);
    expect(golemsAt(entering)).toEqual(['4,0']);
    const leaving = new Cc3dRig(cc3dLevel(['#@S.!#'], { glyphs: { S: { ...mounted('E'), panels: ['E'] }, '!': golem } }));
    leaving.walk('E');
    leaving.tick(SETTLE_TICKS);
    expect(golemsAt(leaving)).toEqual(['4,0']);
  });

  it('removes an ice block it hits and keeps the terrain; another block stops it', () => {
    const ice = new Cc3dRig(cc3dLevel(['#@S.Z.!#'], { glyphs: { S: mounted('E'), '!': golem } }));
    ice.walk('E');
    ice.tick(SETTLE_TICKS);
    expect(ice.entities.some((e) => e.type === 'ice_block')).toBe(false);
    expect(ice.terrainAt(4, 0)).toBe('floor');
    expect(golemsAt(ice)).toEqual(['6,0']);
    const dirt = new Cc3dRig(cc3dLevel(['#@S.K.!#'], { glyphs: { S: mounted('E'), '!': golem } }));
    dirt.walk('E');
    dirt.tick(SETTLE_TICKS);
    expect(dirt.entities.some((e) => e.type === 'dirt_block')).toBe(true);
    expect(golemsAt(dirt)).toEqual(['6,0']);
  });

  it('passes over water, fire, ice and items with no effect', () => {
    const rig = new Cc3dRig(cc3dLevel(['#@SWFIr!#'], { glyphs: { S: mounted('E'), '!': golem } }));
    rig.walk('E');
    rig.tick(SETTLE_TICKS);
    expect(golemsAt(rig)).toEqual([]);
    expect(rig.engine.getItems()[0][6]).toBe('key_red');
    expect(rig.terrainAt(3, 0)).toBe('water');
    expect(rig.terrainAt(4, 0)).toBe('fire');
  });

  it('a wall and a closed door stop it', () => {
    const rig = new Cc3dRig(cc3dLevel(['#@S.1.!#'], { glyphs: { S: mounted('E'), '!': golem } }));
    rig.walk('E');
    rig.tick(SETTLE_TICKS);
    expect(golemsAt(rig)).toEqual(['6,0']);
  });

  it('does not swap places with a monster walking towards it', () => {
    const rig = new Cc3dRig(cc3dLevel(['#@S.B#'], { glyphs: { S: mounted('E'), B: { mob: { kind: 'bouncer', dir: 'W' } } } }));
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
});

describe('reflectors (reading Z table)', () => {
  const VECTOR = DIRECTION_VECTORS;
  const OPPOSITE: Record<Direction, Direction> = { N: 'S', E: 'W', S: 'N', W: 'E' };
  /** mirror -> travel direction -> the direction the shot leaves in (absent: it vanishes). */
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
    put(-2 * v.dx, -2 * v.dy, '@');
    for (const d of ['N', 'E', 'S', 'W'] as const) {
      if (d !== OPPOSITE[travel]) put(VECTOR[d].dx, VECTOR[d].dy, '!');
    }
    return new Cc3dRig(
      cc3dLevel(
        grid.map((row) => row.join('')),
        { glyphs: { S: mounted(travel), R: { mob: { kind: 'reflector', mirror } }, '!': golem } }
      )
    );
  }

  for (const mirror of Object.keys(TABLE)) {
    for (const travel of ['N', 'E', 'S', 'W'] as const) {
      const out = TABLE[mirror][travel];
      it(`${mirror}: a shot travelling ${travel} ${out ? `leaves ${out}` : 'vanishes on the back face'}`, () => {
        const rig = room(mirror, travel);
        const before = golemsAt(rig);
        rig.press(travel);
        rig.tick(SETTLE_TICKS);
        const killed = before.filter((g) => !golemsAt(rig).includes(g));
        if (out) {
          expect(killed).toEqual([`${CENTRE + VECTOR[out].dx},${CENTRE + VECTOR[out].dy}`]);
        } else {
          expect(killed).toEqual([]);
        }
        expect(rig.entities.some((e) => e.type === `cc3d_reflector_${mirror.toLowerCase()}`)).toBe(true);
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
    const stopped = new Cc3dRig(
      cc3dLevel(['#Bp...#', '#######', '#@#####'], { glyphs: { B: bot('bot_static', 'E'), p: panelled('W') } })
    );
    stopped.tick(1);
    expect(beamX(stopped)).toEqual([]);
    const leaving = new Cc3dRig(
      cc3dLevel(['#B.p...#', '#######', '#@#####'], { glyphs: { B: bot('bot_static', 'E'), p: panelled('E') } })
    );
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

  it('a multidirectional bot projects in all four directions', () => {
    const rows = ['#######', '#.....#', '#.....#', '#..B..#', '#.....#', '#.....#', '#######', '#@#####'];
    const rig = new Cc3dRig(cc3dLevel(rows, { glyphs: { B: bot('bot_multi', 'N') } }));
    rig.tick(1);
    expect(rig.engine.getBeamCells()).toHaveLength(8);
  });

  it('rotate a quarter turn every three seconds, clockwise or counter-clockwise', () => {
    const rows = ['#######', '#.....#', '#.....#', '#..B..#', '#.....#', '#.....#', '#######', '#@#####'];
    for (const [kind, first] of [
      ['bot_cw', 'S'],
      ['bot_ccw', 'N']
    ] as const) {
      const rig = new Cc3dRig(cc3dLevel(rows, { glyphs: { B: bot(kind, 'E') } }));
      rig.afterTick(59);
      expect(rig.entities.find((e) => e.type.startsWith('cc3d_bot'))?.dir).toBe('E');
      expect(rig.engine.getBeamCells().every((c) => c.horizontal)).toBe(true);
      rig.afterTick(60);
      expect(rig.entities.find((e) => e.type.startsWith('cc3d_bot'))?.dir).toBe(first);
      expect(rig.engine.getBeamCells().every((c) => c.vertical)).toBe(true);
      rig.afterTick(120);
      expect(rig.entities.find((e) => e.type.startsWith('cc3d_bot'))?.dir).toBe('W');
    }
  });

  it('never move by themselves but can be pushed by the player', () => {
    const rig = new Cc3dRig(cc3dLevel(['#@B...#'], { glyphs: { B: bot('bot_static', 'E') } }));
    rig.tick(SETTLE_TICKS / 2);
    expect(rig.entityAt(2, 0)).toBeDefined();
    rig.walk('E');
    expect(rig.player.x).toBe(2);
    expect(rig.entityAt(3, 0)?.type).toBe('cc3d_bot_static');
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

  it('two adjacent shooters facing each other end the relay instead of looping', () => {
    const rig = new Cc3dRig(cc3dLevel(['#@ST#'], { glyphs: { S: mounted('E'), T: shooter('W') } }));
    rig.press('E');
    rig.tick(SETTLE_TICKS);
    expect(rig.player.alive).toBe(true);
    expect(rig.entities.some((e) => e.type === 'cc3d_shot')).toBe(false);
  });

  it('a reflector loop sending the shot back to its shooter ends there', () => {
    const rows = ['#######', '#.....#', '#@S..L#', '#.....#', '#.....#', '#.R..D#', '#######'];
    const glyphs = { S: mounted('E'), L: reflector('LU'), D: reflector('DL'), R: reflector('RD') };
    const rig = new Cc3dRig(cc3dLevel(rows, { glyphs }));
    rig.press('E');
    rig.tick(1);
    expect(rig.entities.some((e) => e.type === 'cc3d_shot')).toBe(true);
    rig.tick(200);
    expect(rig.entities.some((e) => e.type === 'cc3d_shot')).toBe(false);
    expect(rig.entities.some((e) => e.type === 'cc3d_laser_shooter')).toBe(true);
  });

  it('a controller press by bumping still fires after refused moves in another direction', () => {
    const rig = new Cc3dRig(cc3dLevel(['######', '#@S.!#', '######'], { glyphs: { S: mounted('E'), '!': golem } }));
    rig.hold('N');
    rig.tick(3);
    rig.hold('E');
    rig.tick(SETTLE_TICKS);
    expect(golemsAt(rig)).toEqual([]);
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

  it('a shot that reaches a security bot vanishes and the bot survives [U]', () => {
    const rig = new Cc3dRig(cc3dLevel(['######', '#@S.B.!#', '#######'].map((r) => r.padEnd(8, '#')), { glyphs: { S: mounted('E'), B: bot('bot_static', 'N'), '!': golem } }));
    rig.walk('E');
    rig.tick(SETTLE_TICKS);
    expect(rig.entities.some((e) => e.type === 'cc3d_bot_static')).toBe(true);
    expect(golemsAt(rig)).toEqual(['6,1']);
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

  it('a shot crosses traps, plates, teleports, force floors and bombs with no effect', () => {
    const glyphs = {
      S: mounted('E'),
      x: stacked({ kind: 'floor' }, { kind: 'trap' }),
      p: stacked({ kind: 'floor' }, { kind: 'plate', color: 'green' }),
      H: stacked({ kind: 'floor' }, { kind: 'hold_door', color: 'green', open: false }),
      '!': golem
    };
    const rig = new Cc3dRig(cc3dLevel(['#@SxpkO^!#', '#H########', '#k########'], { glyphs }));
    rig.walk('E');
    rig.tick(SETTLE_TICKS);
    expect(golemsAt(rig)).toEqual([]);
    expect(rig.terrainAt(6, 0)).toBe('bomb');
    expect(rig.terrainAt(1, 1)).toBe('cc3d_hold_door_green_closed');
  });

  it('undo restores the facing of a rotating bot', () => {
    const rows = ['#######', '#.....#', '#.....#', '#..B..#', '#.....#', '#.....#', '#######', '#@.####'];
    const rig = new Cc3dRig(cc3dLevel(rows, { glyphs: { B: bot('bot_cw', 'E') } }));
    rig.tick(62);
    rig.walk('E');
    rig.tick(70);
    expect(rig.entities.find((e) => e.type === 'cc3d_bot_cw')?.dir).toBe('W');
    rig.engine.undo();
    expect(rig.entities.find((e) => e.type === 'cc3d_bot_cw')?.dir).toBe('S');
    expect(rig.engine.getBeamCells().every((c) => c.vertical)).toBe(true);
  });
});
