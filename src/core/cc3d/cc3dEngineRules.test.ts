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
import type { Direction } from '../types';
import { cc3dLevel, stacked } from './cc3dTestMaps';
import type { GlyphMeaning } from './cc3dTestMaps';
import { Cc3dRig } from './cc3dTestRig';
import type { Cc3dMobKind } from './model';

beforeAll(() => {
  loadTestConfigs();
});

const SETTLE_TICKS = 60;

function mob(kind: Cc3dMobKind, dir: Direction = 'E', extra: Partial<GlyphMeaning> = {}): GlyphMeaning {
  return { mob: { kind, dir }, ...extra };
}

/** A walled-in player cell below a level, so only the other mobs matter. */
function withPlayerApart(rows: string[]): string[] {
  const width = Math.max(...rows.map((r) => r.length));
  return [...rows.map((r) => r.padEnd(width, '#')), '#'.repeat(width), '#@'.padEnd(width, '#')];
}

describe('10.1 item 0: nothing acts before the first input [P]', () => {
  it('a monster stands still until the player starts a first step, and moves in that very tick', () => {
    const rig = new Cc3dRig(cc3dLevel(['#M...#', '#####', '#@.###'], { glyphs: { M: mob('bouncer') } }), undefined, false);
    rig.tick(30);
    expect(rig.entities[0].x).toBe(1);
    rig.press('E');
    rig.tick(1);
    expect(rig.entities[0].x).toBe(2);
  });

  it('a refused move does not start play', () => {
    const rig = new Cc3dRig(cc3dLevel(['#M...#', '#####', '#@#'], { glyphs: { M: mob('bouncer') } }), undefined, false);
    rig.hold('E');
    rig.tick(20);
    expect(rig.entities[0].x).toBe(1);
  });

  it('undoing the first step puts the world back to sleep', () => {
    const rig = new Cc3dRig(cc3dLevel(['#M...#', '#####', '#@.###'], { glyphs: { M: mob('bouncer') } }), undefined, false);
    rig.walk('E');
    expect(rig.entities[0].x).toBeGreaterThan(1);
    rig.engine.undo();
    rig.tick(30);
    expect(rig.entities[0].x).toBe(1);
  });
});

describe('10.1 item 2: the blue golem', () => {
  const blue = stacked({ kind: 'floor' }, { kind: 'golem_control_blue' });

  it('stops when blocked and does not turn round by itself', () => {
    const rig = new Cc3dRig(cc3dLevel(withPlayerApart(['#G.#']), { glyphs: { G: mob('golem_blue') } }));
    rig.tick(SETTLE_TICKS);
    expect(rig.entities[0].x).toBe(2);
  });

  it('turns round when a switch-pressing mob STARTS its step onto a blue control', () => {
    const rig = new Cc3dRig(cc3dLevel(['#.G..#', '#@b..#'], { glyphs: { G: mob('golem_blue'), b: blue } }));
    rig.press('E');
    rig.tick(1);
    // The player has only started his step; the golem already walks west.
    expect(rig.entities[0].x).toBe(1);
  });

  it('a golem stepping onto the control reverses too [U]', () => {
    const rig = new Cc3dRig(cc3dLevel(withPlayerApart(['#.Gb..#']), { glyphs: { G: mob('golem_blue'), b: blue } }));
    rig.tick(SETTLE_TICKS);
    expect(rig.entities[0].x).toBe(1);
  });
});

describe('10.1 items 5, 7, 16: monsters', () => {
  const toggle = stacked({ kind: 'floor' }, { kind: 'toggle_control', color: 'green' });

  it('the adult blinky and screamer work no switch; the baby ones and others do', () => {
    for (const [kind, flips] of [
      ['blinky', false],
      ['screamer', false],
      ['baby_blinky', true],
      ['baby_screamer', true],
      ['bouncer', true]
    ] as const) {
      const rig = new Cc3dRig(cc3dLevel(withPlayerApart(['#Mc.##', '#J####']), { glyphs: { M: mob(kind), c: toggle } }));
      rig.tick(8);
      expect(rig.terrainAt(1, 1) === 'toggle_wall_open', kind).toBe(flips);
    }
  });

  it('both blinkies cross a turtle without sinking it', () => {
    for (const [kind, sinks] of [
      ['blinky', false],
      ['baby_blinky', false],
      ['bouncer', true]
    ] as const) {
      const rig = new Cc3dRig(cc3dLevel(withPlayerApart(['#MT.#']), { glyphs: { M: mob(kind) } }));
      rig.tick(20);
      expect(rig.terrainAt(2, 0) === 'water', kind).toBe(sinks);
    }
  });

  it('a screamer, adult or baby, melts an ice block in its way into water and stays put', () => {
    for (const kind of ['screamer', 'baby_screamer'] as const) {
      const rig = new Cc3dRig(cc3dLevel(withPlayerApart(['#MZ.#']), { glyphs: { M: mob(kind) } }));
      rig.tick(1);
      expect(rig.entities.filter((e) => e.type === 'ice_block'), kind).toHaveLength(0);
      expect(rig.terrainAt(2, 0), kind).toBe('water');
      expect(rig.entities[0].x, kind).toBe(1);
    }
  });

  it('monsters cannot enter a push up wall or a false wall, and reveal an appearing wall by trying', () => {
    for (const glyph of ['P', 'V']) {
      const rig = new Cc3dRig(cc3dLevel(withPlayerApart([`#M${glyph}.#`]), { glyphs: { M: mob('bouncer') } }));
      rig.tick(20);
      expect(rig.entities[0].x, glyph).toBe(1);
    }
    const rig = new Cc3dRig(cc3dLevel(withPlayerApart(['#MQ.#']), { glyphs: { M: mob('bouncer') } }));
    rig.tick(2);
    expect(rig.terrainAt(2, 0)).toBe('wall');
  });
});

describe('10.1 item 8: who works a plate', () => {
  const plate = (color: 'green' | 'yellow'): GlyphMeaning => stacked({ kind: 'floor' }, { kind: 'plate', color });
  const door = (color: 'green' | 'yellow'): GlyphMeaning => stacked({ kind: 'floor' }, { kind: 'hold_door', color, open: false });

  it('a pushed reflector, ice block, security bot and dirt block press a plate of any colour', () => {
    for (const block of [mob('reflector', 'N', { mob: { kind: 'reflector', dir: 'N', mirror: 'LU' } }), mob('block_ice'), mob('bot_static', 'N'), mob('block_dirt')]) {
      const rig = new Cc3dRig(cc3dLevel(['#@Bp#', '#H###'], { glyphs: { B: block, p: plate('yellow'), H: door('yellow') } }));
      rig.walk('E');
      expect(rig.terrainAt(1, 1), block.mob?.kind).toBe('cc3d_hold_door_yellow_open');
    }
  });

  it('a colour block still presses only its own colour', () => {
    const other = new Cc3dRig(cc3dLevel(['#@Cp#', '#H###'], { glyphs: { C: { mob: { kind: 'block_color', color: 'green' } }, p: plate('yellow'), H: door('yellow') } }));
    other.walk('E');
    expect(other.terrainAt(1, 1)).toBe('cc3d_hold_door_yellow_closed');
  });
});

describe('10.1 item 10: clone machines', () => {
  const sw = stacked({ kind: 'floor' }, { kind: 'clone_switch' });
  const machine = (kind: Cc3dMobKind, dir: Direction): GlyphMeaning => ({
    stack: [{ kind: 'floor' }, { kind: 'clone_machine', dir }],
    mob: { kind, dir: 'N' }
  });

  it('the template faces the machine direction, and nothing may enter the machine', () => {
    const rig = new Cc3dRig(cc3dLevel(['#@m.#'], { glyphs: { m: machine('block_ice', 'S') } }));
    expect(rig.entityAt(2, 0)?.dir).toBe('S');
    rig.walk('E');
    expect(rig.player.x).toBe(1);
    const empty = new Cc3dRig(cc3dLevel(['#@m.#'], { glyphs: { m: stacked({ kind: 'floor' }, { kind: 'clone_machine', dir: 'E' }) } }));
    empty.walk('E');
    expect(empty.player.x).toBe(1);
  });

  it('a pushed block on a clone switch works the machine', () => {
    const rig = new Cc3dRig(cc3dLevel(['#@Kb.m..#'], { glyphs: { b: sw, m: machine('block_ice', 'E') } }));
    rig.walk('E');
    rig.tick(SETTLE_TICKS);
    expect(rig.entityAt(6, 0)?.type).toBe('ice_block');
    expect(rig.entityAt(5, 0)?.type).toBe('ice_block');
  });

  it('a security bot template beams', () => {
    const rig = new Cc3dRig(cc3dLevel(withPlayerApart(['#m.!..#']), { glyphs: { m: machine('bot_static', 'E'), '!': mob('golem_yellow') } }));
    rig.tick(1);
    expect(rig.entities.some((e) => e.type === 'cc3d_golem_yellow')).toBe(false);
  });
});

describe('10.1 items 17-23: terrain and items', () => {
  it('[S] a player holding the fire and the water orb survives slime and cleans it into floor', () => {
    const rig = new Cc3dRig(cc3dLevel(['#@fwL.#']));
    rig.walk('E', 'E', 'E');
    expect(rig.player.alive).toBe(true);
    expect(rig.terrainAt(4, 0)).toBe('floor');
  });

  it('a block clears dirt by entering it; the ice block passes without clearing it; reflectors are refused by dirt and gravel but not sand', () => {
    const dirt = new Cc3dRig(cc3dLevel(['#@KD.#']));
    dirt.walk('E');
    expect(dirt.terrainAt(3, 0)).toBe('floor');
    const ice = new Cc3dRig(cc3dLevel(['#@ZD.#']));
    ice.walk('E');
    expect(ice.terrainAt(3, 0)).toBe('dirt');
    expect(ice.entityAt(3, 0)?.type).toBe('ice_block');
    const reflector = { mob: { kind: 'reflector' as const, dir: 'N' as const, mirror: 'LU' } };
    for (const [glyph, enters] of [
      ['D', false],
      ['G', false],
      ['A', true]
    ] as const) {
      const rig = new Cc3dRig(cc3dLevel([`#@R${glyph}.#`], { glyphs: { R: reflector } }));
      rig.walk('E');
      expect(rig.player.x, glyph).toBe(enters ? 2 : 1);
    }
  });

  it('any mob may enter a bomb: the bomb and the monster are both gone [S]', () => {
    const rig = new Cc3dRig(cc3dLevel(withPlayerApart(['#MO.#']), { glyphs: { M: mob('bouncer') } }));
    rig.tick(8);
    expect(rig.entities).toHaveLength(0);
    expect(rig.terrainAt(2, 0)).toBe('floor');
  });

  it('the exit is for the player only', () => {
    const rig = new Cc3dRig(cc3dLevel(withPlayerApart(['#MX.#']), { glyphs: { M: mob('bouncer') } }));
    rig.tick(10);
    expect(rig.entities[0].x).toBe(1);
  });

  it('the blue gate turns into floor when a monster enters it; the red gate is for the player even when open', () => {
    const blue = new Cc3dRig(cc3dLevel(withPlayerApart(['#MS.#']), { glyphs: { M: mob('bouncer') } }));
    blue.tick(8);
    expect(blue.terrainAt(2, 0)).toBe('floor');
    const red = new Cc3dRig(cc3dLevel(withPlayerApart(['#MS.#']), { glyphs: { M: mob('bouncer'), S: stacked({ kind: 'floor' }, { kind: 'socket_red' }) } }));
    red.tick(20);
    expect(red.entities[0].x).toBe(1);
  });

  it('the security gates are for the player, the ice block and the shot only', () => {
    const ordinary = new Cc3dRig(cc3dLevel(['#@KN.#']));
    ordinary.walk('E');
    expect(ordinary.player.x).toBe(1);
    const ice = new Cc3dRig(cc3dLevel(['#@ZN.#']));
    ice.walk('E');
    expect(ice.player.x).toBe(2);
    expect(ice.entityAt(3, 0)?.type).toBe('ice_block');
  });

  it('an ordinary block is refused by a key, an orb or a F.I.S.H.; the ice block slides over them', () => {
    for (const glyph of ['r', 'a', 'i']) {
      const rig = new Cc3dRig(cc3dLevel([`#@K${glyph}.#`]));
      rig.walk('E');
      expect(rig.player.x, glyph).toBe(1);
    }
    const ice = new Cc3dRig(cc3dLevel(['#@Zr.#']));
    ice.walk('E');
    expect(ice.entityAt(3, 0)?.type).toBe('ice_block');
    expect(ice.engine.getItems()[0][3]).toBe('key_red');
  });

  it('the ice block pushes a chain of any blocks, reflectors and bots', () => {
    const rig = new Cc3dRig(
      cc3dLevel(['#@ZRB.#'], { glyphs: { R: { mob: { kind: 'reflector', dir: 'N', mirror: 'LU' } }, B: mob('bot_static', 'N') } })
    );
    rig.walk('E');
    expect(rig.player.x).toBe(2);
    expect(rig.entityAt(3, 0)?.type).toBe('ice_block');
    expect(rig.entityAt(4, 0)?.type).toBe('cc3d_reflector_lu');
    expect(rig.entityAt(5, 0)?.type).toBe('cc3d_bot_static');
  });
});

describe('10.1 item 23: the ice block pushes a row', () => {
  it('the player pushes an ice block into a row of ordinary blocks and the whole row moves', () => {
    const rig = new Cc3dRig(cc3dLevel(['#@ZKC..#'], { glyphs: { C: { mob: { kind: 'block_color', color: 'blue' } } } }));
    rig.walk('E');
    expect(rig.player.x).toBe(2);
    expect(rig.entityAt(3, 0)?.type).toBe('ice_block');
    expect(rig.entityAt(4, 0)?.type).toBe('dirt_block');
    expect(rig.entityAt(5, 0)?.type).toBe('cc3d_block_blue');
  });
});

describe('play starts with any step of the player [U]', () => {
  it('a player who starts on a force floor and is carried wakes the monsters', () => {
    const glyphs = { '@': stacked({ kind: 'force', dir: 'E' }), M: mob('bouncer') };
    const rig = new Cc3dRig(cc3dLevel(['#@..#', '#####', '#M.#'], { glyphs }), undefined, false);
    rig.tick(1);
    expect(rig.entities[0].x).toBe(2);
  });
});

describe('10.1 item 24: blocks slide', () => {
  it('a pushed block slides over ice at fast speed until non-ice', () => {
    const rig = new Cc3dRig(cc3dLevel(['#@KII..#']));
    rig.walk('E');
    rig.tick(SETTLE_TICKS);
    expect(rig.entities[0].x).toBe(5);
  });

  it('a blocked sliding block stops, with no bounce [U]', () => {
    const rig = new Cc3dRig(cc3dLevel(['#@KIII#']));
    rig.walk('E');
    rig.tick(SETTLE_TICKS);
    expect(rig.entities[0].x).toBe(5);
  });

  it('a sliding ordinary block crushes a monster in its way', () => {
    const rig = new Cc3dRig(cc3dLevel(['#@KII!.#'], { glyphs: { '!': mob('golem_yellow') } }));
    rig.walk('E');
    rig.tick(SETTLE_TICKS);
    expect(rig.entities.filter((e) => e.type === 'cc3d_golem_yellow')).toHaveLength(0);
    expect(rig.entities.some((e) => e.type === 'dirt_block')).toBe(true);
  });

  it('a pushed block is refused by a monster (it does not crush)', () => {
    const rig = new Cc3dRig(cc3dLevel(['#@K!.#'], { glyphs: { '!': mob('golem_yellow') } }));
    rig.walk('E');
    expect(rig.player.x).toBe(1);
    expect(rig.entities).toHaveLength(2);
  });
});
