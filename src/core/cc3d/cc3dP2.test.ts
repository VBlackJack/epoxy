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
import { MONSTER_TRAITS, isSupportedMonster } from './cc3dMonsterTraits';
import { Cc3dSimulation } from './Cc3dSimulation';
import { onArrival } from './cc3dArrival';
import { buildWorld } from './cc3dWorld';
import { cc3dLevel, cc3dModel, stacked } from './cc3dTestMaps';
import type { GlyphMeaning } from './cc3dTestMaps';
import { Cc3dRig } from './cc3dTestRig';
import type { Cc3dMobKind } from './model';

beforeAll(() => {
  loadTestConfigs();
});

const SETTLE_TICKS = 60;

function mob(kind: Cc3dMobKind, dir: Direction = 'E'): GlyphMeaning {
  return { mob: { kind, dir } };
}

const golemControl = stacked({ kind: 'floor' }, { kind: 'golem_control_yellow' });

describe('traits table', () => {
  it('has a row for every P2 kind, and they are all supported', () => {
    for (const kind of ['snappy', 'nibble', 'golem_yellow', 'legs_green', 'legs_red', 'omni'] as const) {
      expect(MONSTER_TRAITS[kind], kind).toBeDefined();
      expect(isSupportedMonster(kind)).toBe(true);
    }
  });

  it('leaves only the P3 kinds unsupported', () => {
    const glyphs = {
      a: mob('snappy'),
      b: mob('nibble'),
      c: mob('golem_yellow'),
      d: mob('legs_green'),
      e: mob('legs_red'),
      f: mob('omni'),
      g: mob('laser_shooter'),
      h: mob('bot_static'),
      i: mob('bot_cw'),
      j: mob('bot_ccw'),
      k: mob('bot_multi'),
      l: stacked({ kind: 'floor' }, { kind: 'laser_controller' }),
      m: golemControl,
      s: { item: { kind: 'orb_speed' as const } }
    };
    const rig = new Cc3dRig(cc3dLevel(['#@abcdefghijklms#'], { glyphs }));
    expect(rig.engine.getUnsupportedTiles()).toEqual([
      'bot_ccw',
      'bot_cw',
      'bot_multi',
      'bot_static',
      'laser_controller',
      'laser_shooter'
    ]);
  });
});

describe('legs [U base patterns]', () => {
  const room = ['#####', '#...#', '#.M##', '#...#', '#####', '#####', '#@###'];

  it('green goes forward, right, left, back; red forward, left, right, back', () => {
    const green = new Cc3dRig(cc3dLevel(room, { glyphs: { M: mob('legs_green') } }));
    green.tick(1);
    expect(green.entities[0]).toMatchObject({ x: 2, y: 3 });
    const red = new Cc3dRig(cc3dLevel(room, { glyphs: { M: mob('legs_red') } }));
    red.tick(1);
    expect(red.entities[0]).toMatchObject({ x: 2, y: 1 });
  });
});

describe('Snappy flees [U]', () => {
  const room = ['#######', '#.....#', '#@.M..#', '#.....#', '#######'];

  it('steps forward when that increases the distance', () => {
    const rig = new Cc3dRig(cc3dLevel(room, { glyphs: { M: mob('snappy', 'E') } }));
    rig.tick(1);
    expect(rig.entities[0]).toMatchObject({ x: 4, y: 2 });
  });

  it('breaks ties forward, right, left, back: facing the player it turns right', () => {
    const rig = new Cc3dRig(cc3dLevel(room, { glyphs: { M: mob('snappy', 'W') } }));
    rig.tick(1);
    expect(rig.entities[0]).toMatchObject({ x: 3, y: 1 });
  });

  it('takes the right when forward is shut', () => {
    const shut = ['#######', '#.....#', '#@.M#.#', '#.....#', '#######'];
    const rig = new Cc3dRig(cc3dLevel(shut, { glyphs: { M: mob('snappy', 'E') } }));
    rig.tick(1);
    expect(rig.entities[0]).toMatchObject({ x: 3, y: 3 });
  });

  it('rests a step between steps: one at normal speed, then one step of waiting', () => {
    const rig = new Cc3dRig(cc3dLevel(room, { glyphs: { M: mob('snappy', 'E') } }));
    rig.afterTick(0);
    expect(rig.entities[0].cooldownTicks).toBe(3);
    rig.afterTick(7);
    expect(rig.entities[0].x).toBe(4);
    rig.afterTick(8);
    expect(rig.entities[0].x).toBe(5);
  });

  it('waits when no direction increases the distance', () => {
    const rig = new Cc3dRig(cc3dLevel(['#####', '#.@M#', '#####'], { glyphs: { M: mob('snappy', 'E') } }));
    rig.tick(SETTLE_TICKS);
    expect(rig.entities[0].x).toBe(3);
    expect(rig.player.alive).toBe(true);
  });
});

describe('Nibble chases [U]', () => {
  it('walks towards the player and kills him on contact', () => {
    const rig = new Cc3dRig(cc3dLevel(['#M...@#'], { glyphs: { M: mob('nibble', 'E') } }));
    rig.afterTick(0);
    expect(rig.entities[0].x).toBe(2);
    rig.tick(SETTLE_TICKS);
    expect(rig.player.alive).toBe(false);
    expect(rig.player.deathReasonKey).toBe('hud.messages.death_monster');
  });

  it('picks the direction that gets closer, ties forward first', () => {
    const rig = new Cc3dRig(cc3dLevel(['#######', '#.....#', '#..M..#', '#....@#', '#######'], { glyphs: { M: mob('nibble', 'N') } }));
    rig.tick(1);
    // Forward (north) moves away; right (east) and left (west) tie at the same distance to change: east is closer.
    expect(rig.entities[0]).toMatchObject({ x: 4, y: 2 });
  });
});

describe('Omni [U]', () => {
  it('takes slow steps of eight ticks in a seeded random direction', () => {
    const rows = ['#####', '#...#', '#.M.#', '#...#', '#####', '#####', '#@###'];
    let moved = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const rig = new Cc3dRig(cc3dLevel(rows, { glyphs: { M: mob('omni') } }), seed);
      rig.tick(1);
      const e = rig.entities[0];
      if (e.x !== 2 || e.y !== 2) {
        moved += 1;
        expect(e.cooldownTicks).toBe(7);
      }
    }
    expect(moved).toBeGreaterThan(0);
  });

  it('a blocked draw costs one slow step before the next draw', () => {
    let seen = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const rig = new Cc3dRig(cc3dLevel(['#MO.#', '#####', '#@###'], { glyphs: { M: mob('omni'), O: { stack: [{ kind: 'floor' }] } } }), seed);
      rig.tick(1);
      if (rig.entities[0].x === 1) {
        seen += 1;
        rig.afterTick(7);
        expect(rig.entities[0].x).toBe(1);
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('survives slime and then leaves slime on bare floor only', () => {
    const bare: GlyphMeaning = { mob: { kind: 'omni', dir: 'E' } };
    const withItem: GlyphMeaning = { mob: { kind: 'omni', dir: 'E' }, item: { kind: 'key', color: 'red' } };
    const run = (start: GlyphMeaning): Cc3dRig => {
      const rig = new Cc3dRig(cc3dLevel(['#OL#', '####', '#@##'], { glyphs: { O: start } }), 3);
      rig.tick(600);
      return rig;
    };
    const plain = run(bare);
    expect(plain.entities).toHaveLength(1);
    expect(plain.terrainAt(1, 0)).toBe('slime');
    const keyed = run(withItem);
    expect(keyed.terrainAt(1, 0)).toBe('floor');
  });
});

describe('yellow golems and their control [U]', () => {
  const glyphs = { G: mob('golem_yellow'), c: golemControl };

  it('never move on their own', () => {
    const rig = new Cc3dRig(cc3dLevel(['#@.G.#'], { glyphs }));
    rig.tick(SETTLE_TICKS);
    expect(rig.entities[0].x).toBe(3);
  });

  it('a line of three moves east together, front first', () => {
    const rig = new Cc3dRig(cc3dLevel(['#@cGGG...#'], { glyphs }));
    rig.walk('E');
    rig.tick(8);
    expect(rig.entities.map((e) => e.x).sort()).toEqual([4, 5, 6]);
  });

  it('a line of three moves west together', () => {
    const rig = new Cc3dRig(cc3dLevel(['#.GGG..c@#'], { glyphs }));
    rig.walk('W');
    rig.tick(8);
    expect(rig.entities.map((e) => e.x).sort()).toEqual([1, 2, 3]);
  });

  it('moves in the direction the player was moving, and only for the player', () => {
    const block = new Cc3dRig(cc3dLevel(['#@Kc.G.#'], { glyphs }));
    block.walk('E');
    block.tick(8);
    expect(block.entities.find((e) => e.type === 'cc3d_golem_yellow')?.x).toBe(5);
  });

  it('pushes a block, and an ice chain, but not two plain blocks', () => {
    const one = new Cc3dRig(cc3dLevel(['#@cGK.#'], { glyphs }));
    one.walk('E');
    one.tick(8);
    expect(one.entities.map((e) => e.x).sort()).toEqual([4, 5]);
    expect(one.entities.some((e) => e.type === 'dirt_block' && e.x === 5)).toBe(true);
    const chain = new Cc3dRig(cc3dLevel(['#@cGZZ.#'], { glyphs }));
    chain.walk('E');
    chain.tick(8);
    expect(chain.entities.map((e) => e.x).sort()).toEqual([4, 5, 6]);
    const two = new Cc3dRig(cc3dLevel(['#@cGKK.#'], { glyphs }));
    two.walk('E');
    two.tick(8);
    expect(two.entities.map((e) => e.x).sort()).toEqual([3, 4, 5]);
  });

  it('refuses water, fire and slime and enters sand and gravel', () => {
    for (const glyph of ['W', 'F', 'L']) {
      const rig = new Cc3dRig(cc3dLevel([`#@cG${glyph}.#`], { glyphs }));
      rig.walk('E');
      rig.tick(8);
      expect(rig.entities[0].x, glyph).toBe(3);
    }
    for (const glyph of ['A', 'G']) {
      const level = cc3dLevel([`#@c!${glyph}.#`], { glyphs: { ...glyphs, '!': mob('golem_yellow') } });
      const rig = new Cc3dRig(level);
      rig.walk('E');
      rig.tick(8);
      expect(rig.entities[0].x, glyph).toBe(4);
    }
  });

  it('ignores ice and force floors', () => {
    const ice = new Cc3dRig(cc3dLevel(['#@c!I..#'], { glyphs: { ...glyphs, '!': mob('golem_yellow') } }));
    ice.walk('E');
    ice.tick(SETTLE_TICKS);
    expect(ice.entities[0].x).toBe(4);
    const force = new Cc3dRig(cc3dLevel(['#@c!>..#'], { glyphs: { ...glyphs, '!': mob('golem_yellow') } }));
    force.walk('E');
    force.tick(SETTLE_TICKS);
    expect(force.entities[0].x).toBe(4);
  });
});

describe('speed orb [U]', () => {
  const corridor = (monsterRow: string): string[] => [monsterRow, '#########', '#@s######'];

  it('doubles the steps a monster starts after the player holds it', () => {
    const without = new Cc3dRig(cc3dLevel(['#M....#', '#######', '#@.####'], { glyphs: { M: mob('bouncer') } }));
    without.afterTick(4);
    expect(without.entities[0]).toMatchObject({ x: 3, cooldownTicks: 3 });
    const rig = new Cc3dRig(cc3dLevel(corridor('#M....###'), { glyphs: { M: mob('bouncer') } }));
    rig.press('E');
    rig.afterTick(4);
    expect(rig.entities[0]).toMatchObject({ x: 3, cooldownTicks: 7 });
  });

  it('doubles the rest of a Snappy too', () => {
    const rig = new Cc3dRig(cc3dLevel(corridor('#...M..##'), { glyphs: { M: mob('snappy') } }));
    rig.press('E');
    rig.afterTick(11);
    expect(rig.entities[0].x).toBe(5);
    rig.afterTick(12);
    expect(rig.entities[0].x).toBe(6);
  });

  it('does not slow a block the player pushes', () => {
    const rig = new Cc3dRig(cc3dLevel(['#@sK..#']));
    rig.walk('E');
    rig.press('E');
    rig.tick(1);
    expect(rig.entities[0]).toMatchObject({ x: 4, cooldownTicks: 3 });
  });

  it('slows a block a golem pushes', () => {
    const glyphs = { G: mob('golem_yellow'), c: golemControl };
    const rig = new Cc3dRig(cc3dLevel(['#@scGK..#'], { glyphs }));
    rig.walk('E', 'E');
    const block = rig.entities.find((e) => e.type === 'dirt_block');
    const golem = rig.entities.find((e) => e.type === 'cc3d_golem_yellow');
    expect(golem).toMatchObject({ x: 5, cooldownTicks: 7 });
    expect(block).toMatchObject({ x: 6, cooldownTicks: 7 });
  });
});

describe('review fixes', () => {
  const machine = (kind: Cc3dMobKind): GlyphMeaning => ({
    stack: [{ kind: 'floor' }, { kind: 'clone_machine', dir: 'E' }],
    mob: { kind, dir: 'E' }
  });
  const sw = stacked({ kind: 'floor' }, { kind: 'clone_switch' });

  it('a Snappy released from a clone machine does not rest afterwards', () => {
    const rig = new Cc3dRig(cc3dLevel(['#@bm....#'], { glyphs: { b: sw, m: machine('snappy') } }));
    rig.walk('E');
    rig.afterTick(7);
    // Released at tick 3, arrived at tick 6, no rest: the next step starts at tick 7.
    expect(rig.entities.some((e) => e.x === 5)).toBe(true);
  });

  it('the speed orb slows a monster released from a clone machine, not a block', () => {
    const monster = new Cc3dRig(cc3dLevel(['#@sbm...#'], { glyphs: { b: sw, m: machine('bouncer') } }));
    monster.walk('E', 'E');
    expect(monster.entities.find((e) => e.x === 5)?.cooldownTicks).toBe(7);
    const block = new Cc3dRig(cc3dLevel(['#@sbm...#'], { glyphs: { b: sw, m: machine('block_ice') } }));
    block.walk('E', 'E');
    expect(block.entities.find((e) => e.x === 5)?.cooldownTicks).toBe(3);
  });

  it('a player killed while arriving takes nothing from his cell', () => {
    const control: GlyphMeaning = { stack: [{ kind: 'floor' }, { kind: 'golem_control_yellow' }], item: { kind: 'key', color: 'red' } };
    const model = cc3dModel(['#@Gc.#'], { G: mob('golem_yellow'), c: control });
    const world = buildWorld(model, 1);
    const sim = new Cc3dSimulation(world, { visual: () => undefined, sound: () => undefined, step: () => undefined }, 0);
    world.player.x = 3;
    world.player.dir = 'E';
    onArrival(sim, world.player);
    expect(world.player.alive).toBe(false);
    expect(world.cells[3].item).not.toBeNull();
    expect(world.player.keys.red).toBe(0);
  });

  it('an Omni that starts on slime leaves a trail from its first step', () => {
    const glyphs = { O: { stack: [{ kind: 'slime' as const }], mob: { kind: 'omni' as const, dir: 'E' as const } } };
    const rig = new Cc3dRig(cc3dLevel(['#O.#', '####', '#@##'], { glyphs }), 5);
    let previousX = 1;
    for (let i = 0; i < 800; i++) {
      rig.tick();
      const x = rig.entities[0].x;
      if (previousX === 2 && x === 1) break;
      previousX = x;
    }
    expect(previousX).toBe(2);
    expect(rig.terrainAt(2, 0)).toBe('slime');
  });
});
