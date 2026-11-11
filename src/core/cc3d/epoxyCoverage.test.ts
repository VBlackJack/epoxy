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

/**
 * Unit tests of the Epoxy coverage classifier. The corpus report at the end is optional: it runs only when
 * CC3D_CORPUS_DIR names a directory of level files (the data stays outside the repository) and writes to the
 * file named by CC3D_COVERAGE_REPORT. Ids and counts only, no level content.
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { CC3D_XML_EXTENSION, decodeCc3dFiles } from '../../formats/Cc3dXmlCodec';
import { cc3dModel, stacked, terrain } from './cc3dTestMaps';
import { classifyLevel, classifyStack, elementKeys, EPOXY_COVERAGE, stackedPairs } from './epoxyCoverage';
import type { CoverageLevel } from './epoxyCoverage';
import { CC3D_COLORS, CC3D_ITEM_KINDS, CC3D_MOB_KINDS } from './model';
import type { Cc3dColor, Cc3dItemKind, Cc3dMobKind, Cc3dTerrainKind } from './model';

const TERRAIN_KINDS: Record<Cc3dTerrainKind, true> = {
  floor: true, wall: true, water: true, fire: true, ice: true, ice_corner: true, force: true, force_random: true,
  exit: true, socket: true, socket_red: true, slime: true, turtle: true, dirt: true, gravel: true, sand: true,
  teleport_blue: true, teleport_red: true, push_up_wall: true, appearing_wall: true, false_wall: true, door: true,
  toggle_door: true, toggle_control: true, hold_door: true, plate: true, trap: true, trap_control: true,
  clone_machine: true, clone_switch: true, golem_control_blue: true, golem_control_yellow: true,
  laser_controller: true, bomb: true, gate_tools: true, gate_keys: true
};
const COLORED_TERRAIN_KINDS: readonly Cc3dTerrainKind[] = ['plate', 'hold_door', 'toggle_door', 'toggle_control'];
const TOP_N_STACKS = 30;
const SAMPLE_COLOR: Cc3dColor = 'red';

function levelOf(rows: string[], glyphs: Parameters<typeof cc3dModel>[1] = {}) {
  return cc3dModel(rows, glyphs);
}

describe('epoxy coverage table', () => {
  it('has an entry for every terrain, item and mob kind, with each colour that matters', () => {
    const missing: string[] = [];
    const check = (key: string) => {
      if (!EPOXY_COVERAGE[key]) missing.push(key);
    };
    for (const kind of Object.keys(TERRAIN_KINDS) as Cc3dTerrainKind[]) {
      if (COLORED_TERRAIN_KINDS.includes(kind)) for (const color of CC3D_COLORS) check(`${kind}_${color}`);
      else check(kind);
    }
    const itemKinds: Cc3dItemKind[] = CC3D_ITEM_KINDS;
    for (const kind of itemKinds) check(kind);
    const mobKinds: Array<Exclude<Cc3dMobKind, 'shot'>> = CC3D_MOB_KINDS;
    for (const kind of mobKinds) {
      if (kind === 'block_color') for (const color of CC3D_COLORS) check(`${kind}_${color}`);
      else check(kind);
    }
    check('stacked_terrain');
    check('stacked_runtime');
    check('panels_on_nonfloor');
    check('socket_red_stacked');
    check('trap_unworked');
    check('clone_switch_empty');
    check('bomb_with_item');
    check('bomb_buried');
    check('laser_shooter_covered');
    check('gravel_with_reflector');
    check('orbs_over_cap');
    check('appearing_wall_with_monster');
    check('monsters_meet');
    check('time_limit');
    expect(missing).toEqual([]);
  });

  it('holds exactly the keys the checks above name: no entry without an element behind it', () => {
    const named = new Set<string>();
    for (const kind of Object.keys(TERRAIN_KINDS) as Cc3dTerrainKind[]) {
      if (COLORED_TERRAIN_KINDS.includes(kind)) for (const color of CC3D_COLORS) named.add(`${kind}_${color}`);
      else named.add(kind);
    }
    for (const kind of CC3D_ITEM_KINDS) named.add(kind);
    for (const kind of CC3D_MOB_KINDS) {
      if (kind === 'block_color') for (const color of CC3D_COLORS) named.add(`${kind}_${color}`);
      else named.add(kind);
    }
    for (const key of [
      'stacked_terrain', 'stacked_runtime', 'panels_on_nonfloor', 'socket_red_stacked', 'trap_unworked',
      'clone_switch_empty', 'bomb_with_item', 'bomb_buried', 'laser_shooter_covered', 'gravel_with_reflector', 'orbs_over_cap',
      'appearing_wall_with_monster', 'monsters_meet', 'time_limit'
    ]) named.add(key);
    expect(Object.keys(EPOXY_COVERAGE).filter((key) => !named.has(key))).toEqual([]);
  });

  it('loses the three relation keys the Epoxy tiles cannot express, each with its own reason', () => {
    const keys = ['clone_switch_empty', 'bomb_with_item', 'laser_shooter_covered'];
    for (const key of keys) expect(EPOXY_COVERAGE[key].level, key).toBe('lost');
    expect(new Set(keys.map((key) => EPOXY_COVERAGE[key].reason)).size).toBe(keys.length);
  });

  it('plays a trap no control works as the sealed trap: exact, with a reason of its own', () => {
    expect(EPOXY_COVERAGE.trap_unworked.level).toBe('exact');
    expect(EPOXY_COVERAGE.trap_unworked.reason).toContain('trap_sealed');
  });

  it('gives every entry a level and a reason', () => {
    const levels: CoverageLevel[] = ['exact', 'approx', 'lost'];
    for (const found of Object.values(EPOXY_COVERAGE)) {
      expect(levels).toContain(found.level);
      expect(found.reason.length).toBeGreaterThan(0);
    }
  });
});

describe('classifyLevel', () => {
  it('calls a level of exact elements exact', () => {
    const result = classifyLevel(levelOf(['#####', '#@.X#', '#####']));
    expect(result).toEqual({ verdict: 'exact', lost: [], approx: [] });
  });

  it('keeps door and key exact whatever their colour', () => {
    const result = classifyLevel(levelOf(['######', '#@r1X#', '######']));
    expect(result.verdict).toBe('exact');
  });

  it('calls a level with a water cell exact now that the dirt block makes dirt_3d', () => {
    const result = classifyLevel(levelOf(['#####', '#@WX#', '#####']));
    expect(result).toEqual({ verdict: 'exact', lost: [], approx: [] });
  });

  it('calls a level with an appearing wall and no walking monster exact (cc3dEvidenceTerrain.test.ts)', () => {
    const result = classifyLevel(levelOf(['#####', '#@VX#', '#####'], { V: terrain('appearing_wall') }));
    expect(result).toEqual({ verdict: 'exact', lost: [], approx: [] });
  });

  it('calls a level with an appearing wall and a walking monster approx, whatever the monster', () => {
    for (const kind of ['walker', 'golem_blue', 'golem_yellow', 'omni'] as const) {
      const glyphs = { V: terrain('appearing_wall'), M: { mob: { kind, dir: 'E' as const } } };
      const result = classifyLevel(levelOf(['######', '#@VXM#', '######'], glyphs));
      expect(result.lost, kind).toEqual([]);
      expect(result.approx, kind).toContain('appearing_wall_with_monster');
      expect(result.approx, kind).not.toContain('appearing_wall');
    }
  });

  it('keeps an appearing wall exact beside monsters that do not walk: blocks, reflectors, turrets', () => {
    for (const kind of ['block_dirt', 'block_ice', 'reflector', 'bot_static', 'bot_cw'] as const) {
      const glyphs = { V: terrain('appearing_wall'), M: { mob: { kind, dir: 'E' as const, mirror: kind === 'reflector' ? 'LU' : undefined } } };
      const keys = elementKeys(levelOf(['######', '#@VXM#', '######'], glyphs));
      expect(keys.has('appearing_wall_with_monster'), kind).toBe(false);
    }
  });

  it('calls a level with a laser controller approx now that Epoxy has the shot trigger, and lists the other approx elements', () => {
    const glyphs = { Z: terrain('laser_controller'), V: terrain('appearing_wall') };
    const result = classifyLevel(levelOf(['######', '#@ZVX#', '######'], glyphs));
    expect(result.verdict).toBe('approx');
    expect(result.lost).toEqual([]);
    expect(result.approx).toEqual(['laser_controller']);
    expect(EPOXY_COVERAGE.laser_shooter.level).toBe('approx');
    expect(EPOXY_COVERAGE.laser_controller.level).toBe('approx');
  });

  it('plays sand, the extra fish and plain gravel exactly, and gravel in a level with a reflector approximately', () => {
    expect(classifyLevel(levelOf(['######', '#@AeX#', '######']))).toEqual({ verdict: 'exact', lost: [], approx: [] });
    expect(EPOXY_COVERAGE.sand.level).toBe('exact');
    expect(EPOXY_COVERAGE.fish_extra.level).toBe('exact');
    expect(classifyLevel(levelOf(['#####', '#@GX#', '#####']))).toEqual({ verdict: 'exact', lost: [], approx: [] });
    const withReflector = levelOf(['######', '#@GrX#', '######'], { r: { mob: { kind: 'reflector', mirror: 'LU' } } });
    expect(classifyLevel(withReflector)).toEqual({ verdict: 'approx', lost: [], approx: ['gravel_with_reflector', 'reflector'] });
  });

  it('plays a red socket on plain floor exactly, and one on any other layer approximately', () => {
    const onFloor = levelOf(['#####', '#@RX#', '#####'], { R: stacked({ kind: 'floor' }, { kind: 'socket_red' }) });
    expect(elementKeys(onFloor).has('socket_red')).toBe(true);
    expect(classifyLevel(onFloor).verdict).toBe('exact');
    const onSand = levelOf(['#####', '#@RX#', '#####'], { R: stacked({ kind: 'sand' }, { kind: 'socket_red' }) });
    expect(elementKeys(onSand).has('socket_red')).toBe(false);
    // Any layer under the socket other than plain floor is also a stacked cell, which Epoxy flattens.
    expect(classifyLevel(onSand)).toEqual({ verdict: 'lost', lost: ['stacked_runtime'], approx: ['socket_red_stacked'] });
    expect(elementKeys(onSand).has('socket_red_stacked')).toBe(true);
    // A bomb layer becomes the cell's item, so the socket alone is left over the floor: nothing is lost.
    const withDevice = levelOf(['#####', '#@RX#', '#####'], { R: stacked({ kind: 'floor' }, { kind: 'bomb' }, { kind: 'socket_red' }) });
    expect(classifyLevel(withDevice).lost).toEqual([]);
    expect(classifyLevel(withDevice).approx).toContain('socket_red_stacked');
  });

  it('plays every bot approximately, as an Epoxy turret', () => {
    for (const key of ['bot_static', 'bot_cw', 'bot_ccw', 'bot_multi']) {
      expect(EPOXY_COVERAGE[key].level).toBe('approx');
    }
  });

  it('plays the yellow golem, its control and the nibble as CC3D does, and names the golem timing and appearing wall differences', () => {
    for (const key of ['golem_yellow', 'golem_control_yellow', 'nibble']) {
      expect(EPOXY_COVERAGE[key].level, key).toBe('exact');
    }
    expect(EPOXY_COVERAGE.golem_yellow.reason).toMatch(/four ticks/);
    expect(EPOXY_COVERAGE.golem_yellow.reason).toMatch(/appearing wall/);
    expect(EPOXY_COVERAGE.sand.reason).toMatch(/yellow golem/);
  });

  it('plays the speed orb approximately', () => {
    expect(EPOXY_COVERAGE.orb_speed.level).toBe('approx');
  });

  it('plays the four orbs exactly while the map holds four orb items or fewer, the speed orb counting as one', () => {
    const glyphs = { a: { item: { kind: 'orb_ice' as const } }, o: { item: { kind: 'orb_force' as const } }, f: { item: { kind: 'orb_fire' as const } }, w: { item: { kind: 'orb_water' as const } }, s: { item: { kind: 'orb_speed' as const } } };
    expect(classifyLevel(levelOf(['#######', '#@afwo#', '#######'], glyphs))).toEqual({ verdict: 'exact', lost: [], approx: [] });
    const five = classifyLevel(levelOf(['########', '#@afwos#', '########'], glyphs));
    expect(five.lost).toEqual([]);
    expect(five.approx).toEqual(['orb_speed', 'orbs_over_cap']);
    const fourWithSpeed = classifyLevel(levelOf(['######', '#@afs#', '######'], glyphs));
    expect(fourWithSpeed.approx).toEqual(['orb_speed']);
    const overWithoutSpeed = classifyLevel(levelOf(['########', '#@afwoa#', '########'], glyphs));
    expect(overWithoutSpeed.approx).toEqual(['orbs_over_cap']);
  });

  it('separates the colours of a colour block, a plate and a toggle door, all played by Epoxy now', () => {
    const glyphs = {
      B: { stack: [{ kind: 'floor' as const }, { kind: 'plate' as const, color: 'blue' as const }] },
      R: { stack: [{ kind: 'floor' as const }, { kind: 'toggle_door' as const, color: 'red' as const, open: false }] }
    };
    const result = classifyLevel(levelOf(['#####', '#@BR#', '#####'], glyphs));
    expect(result.lost).toEqual([]);
    expect(result.approx).toEqual([]);
    expect(result.verdict).toBe('exact');
    const green = classifyLevel(levelOf(['#####', '#@J.#', '#####']));
    expect(green.verdict).toBe('exact');
    const colorBlock = classifyLevel(levelOf(['####', '#@C#', '####']));
    expect(colorBlock.lost).toEqual([]);
    expect(colorBlock.approx).toEqual([]);
    expect(colorBlock.verdict).toBe('exact');
  });

  it('detects a cell with two devices or blockers as stacked terrain, and loses it when a layer acts while covered', () => {
    const glyphs = { S: stacked({ kind: 'floor' }, { kind: 'plate', color: 'red' }, { kind: 'false_wall' }) };
    const level = levelOf(['####', '#@S#', '####'], glyphs);
    expect(elementKeys(level).has('stacked_runtime')).toBe(true);
    expect(classifyLevel(level).lost).toEqual(['stacked_runtime']);
    expect(elementKeys(levelOf(['####', '#@O#', '####'])).has('stacked_terrain')).toBe(false);
  });

  it('plays a removable top over one inert layer exactly, as an underlay', () => {
    const door = { kind: 'door' as const, color: 'red' as const };
    const under = (kind: Cc3dTerrainKind) => classifyStack({ terrain: [{ kind: 'floor' }, { kind }, door], panels: [], item: null });
    for (const kind of ['ice', 'ice_corner', 'water', 'exit', 'sand', 'slime', 'wall', 'toggle_control'] as const) {
      expect(under(kind)).toBe('underlay');
    }
    for (const kind of ['trap', 'door'] as const) {
      expect(under(kind)).toBe('runtime');
    }
    // Under a door or a socket Epoxy also plays a socket, dirt, a blocker, a trigger and the covered devices.
    const wider = ['socket', 'socket_red', 'dirt', 'push_up_wall', 'appearing_wall', 'laser_controller', 'toggle_door', 'hold_door', 'plate'] as const;
    for (const kind of wider) {
      expect(under(kind)).toBe('underlay');
      expect(classifyStack({ terrain: [{ kind: 'floor' }, { kind }, { kind: 'socket' }], panels: [], item: null })).toBe('underlay');
      // Under a false wall (which a push turns back into other things) they stay lost.
      expect(classifyStack({ terrain: [{ kind: 'floor' }, { kind }, { kind: 'false_wall' }], panels: [], item: null })).toBe('runtime');
    }
    const socketOverIce = levelOf(['####', '#@S#', '####'], { S: stacked({ kind: 'ice' }, { kind: 'socket' }) });
    expect(elementKeys(socketOverIce).has('stacked_terrain')).toBe(true);
    expect(classifyLevel(socketOverIce).lost).toEqual([]);
  });

  it('turns a bomb layer into the cell item when the slot is free, and keeps it a layer otherwise', () => {
    const door = { kind: 'door' as const, color: 'red' as const };
    const free = { terrain: [{ kind: 'floor' as const }, { kind: 'bomb' as const }, door], panels: [], item: null };
    expect(classifyStack(free)).toBe('flattened');
    const overToggle = { ...free, terrain: [{ kind: 'toggle_control' as const, color: 'red' as const }, { kind: 'bomb' as const }, door] };
    expect(classifyStack(overToggle)).toBe('underlay');
    const iceBomb = { terrain: [{ kind: 'ice' as const }, { kind: 'bomb' as const }], panels: [], item: null };
    expect(classifyStack(iceBomb)).toBe('flattened');
    const taken = { ...iceBomb, item: { kind: 'fish' as const } };
    expect(classifyStack(taken)).toBe('runtime');
  });

  it('drops inert layers under a top that is never removed, and keeps live ones lost', () => {
    const wetWall = { terrain: [{ kind: 'water' as const }, { kind: 'trap' as const }, { kind: 'wall' as const }], panels: [], item: null };
    expect(classifyStack(wetWall)).toBe('runtime');
    const iceWall = { terrain: [{ kind: 'ice' as const }, { kind: 'toggle_control' as const, color: 'red' as const }, { kind: 'wall' as const }], panels: [], item: null };
    expect(classifyStack(iceWall)).toBe('flattened');
    expect(classifyStack({ terrain: [{ kind: 'floor' }], panels: [], item: null })).toBe('plain');
  });

  it('loses a stack deeper than a removable top over one layer', () => {
    const deep = {
      terrain: [{ kind: 'ice' as const }, { kind: 'toggle_control' as const, color: 'red' as const }, { kind: 'door' as const, color: 'red' as const }],
      panels: [],
      item: null
    };
    expect(classifyStack(deep)).toBe('runtime');
  });

  it('detects panels on water, which cell edges now carry exactly', () => {
    const onWater = levelOf(['####', '#@W#', '####'], { W: { stack: [{ kind: 'water' }], panels: ['N'] } });
    expect(elementKeys(onWater).has('panels_on_nonfloor')).toBe(true);
    expect(classifyLevel(onWater).lost).toEqual([]);
    expect(classifyLevel(onWater).approx).toEqual([]);
    const onFloor = levelOf(['####', '#@.#', '####'], { '.': { stack: [{ kind: 'floor' }], panels: ['N'] } });
    expect(classifyLevel(onFloor).verdict).toBe('exact');
  });

  it('throws on a kind the table does not know', () => {
    const level = levelOf(['###', '#@#', '###']);
    level.cells[4] = { terrain: [{ kind: 'lava' as unknown as Cc3dTerrainKind }], panels: [], item: null };
    expect(() => classifyLevel(level)).toThrow(/lava/);
  });

  it('throws on a coloured plate without a colour', () => {
    const level = levelOf(['###', '#@#', '###'], { '@': terrain('plate') });
    expect(() => elementKeys(level)).toThrow(/no colour/);
  });
});

describe('relation keys', () => {
  const trap = { kind: 'trap' as const };
  const control = { kind: 'trap_control' as const };

  it('flags a trap no control works, and only that one', () => {
    const worked = levelOf(['#####', '#@bT#', '#####'], { b: stacked({ kind: 'floor' }, control), T: stacked({ kind: 'floor' }, trap) });
    expect(elementKeys(worked).has('trap_unworked')).toBe(false);
    const second = levelOf(['######', '#@bTT#', '######'], { b: stacked({ kind: 'floor' }, control), T: stacked({ kind: 'floor' }, trap) });
    expect(elementKeys(second).has('trap_unworked')).toBe(true);
  });

  it('does not flag a trap on a map without any trap control: it stays shut in both engines (cc3dEvidenceDevices.test.ts)', () => {
    const idle = levelOf(['#####', '#@.T#', '#####'], { T: stacked({ kind: 'floor' }, trap) });
    expect(elementKeys(idle).has('trap_unworked')).toBe(false);
    expect(classifyLevel(idle)).toEqual({ verdict: 'exact', lost: [], approx: [] });
  });

  it('flags monsters_meet for two or more walking monsters with one of a differing kind, and for a cloned one', () => {
    const mob = (kind: Cc3dMobKind) => ({ mob: { kind, dir: 'E' as const } });
    const two = classifyLevel(levelOf(['######', '#@MN.#', '######'], { M: mob('bouncer'), N: mob('bouncer') }));
    expect(two.approx).toContain('monsters_meet');
    const mixed = classifyLevel(levelOf(['######', '#@MN.#', '######'], { M: mob('bouncer'), N: mob('golem_blue') }));
    expect(mixed.approx).toContain('monsters_meet');
    const agreeing = classifyLevel(levelOf(['######', '#@MN.#', '######'], { M: mob('golem_blue'), N: mob('snappy') }));
    expect(agreeing.approx).not.toContain('monsters_meet');
    const alone = classifyLevel(levelOf(['#####', '#@M.#', '#####'], { M: mob('bouncer') }));
    expect(alone.approx).not.toContain('monsters_meet');
    const blocks = classifyLevel(levelOf(['######', '#@MK.#', '######'], { M: mob('bouncer') }));
    expect(blocks.approx).not.toContain('monsters_meet');
    const cloned = classifyLevel(levelOf(['#####', '#@c.#', '#####'], { c: { stack: [{ kind: 'floor' }, { kind: 'clone_machine', dir: 'E' }], mob: { kind: 'bouncer', dir: 'E' } } }));
    expect(cloned.approx).toContain('monsters_meet');
  });

  it('flags a clone switch whose nearest machine holds no template or a shooter, not one with a walker', () => {
    const glyphs = {
      x: stacked({ kind: 'floor' }, { kind: 'clone_switch' }),
      c: stacked({ kind: 'floor' }, { kind: 'clone_machine', dir: 'E' })
    };
    expect(elementKeys(levelOf(['######', '#@xc.#', '######'], glyphs)).has('clone_switch_empty')).toBe(true);
    const walker = { ...glyphs, c: { ...glyphs.c, mob: { kind: 'walker' as const } } };
    expect(elementKeys(levelOf(['######', '#@xc.#', '######'], walker)).has('clone_switch_empty')).toBe(false);
    const shooter = { ...glyphs, c: { ...glyphs.c, mob: { kind: 'laser_shooter' as const } } };
    expect(elementKeys(levelOf(['######', '#@xc.#', '######'], shooter)).has('clone_switch_empty')).toBe(true);
    // No machine at all: nothing to fire, nothing lost.
    expect(elementKeys(levelOf(['######', '#@x..#', '######'], { x: glyphs.x })).has('clone_switch_empty')).toBe(false);
  });

  it('flags a bomb layer sharing its cell with an item', () => {
    const bomb = stacked({ kind: 'floor' }, { kind: 'bomb' });
    expect(elementKeys(levelOf(['####', '#@O#', '####'], { O: bomb })).has('bomb_with_item')).toBe(false);
    expect(elementKeys(levelOf(['####', '#@O#', '####'], { O: { ...bomb, item: { kind: 'fish' } } })).has('bomb_with_item')).toBe(true);
  });

  it('flags a shooter standing on an item or on a layer other than plain floor', () => {
    const shooter = { kind: 'laser_shooter' as const };
    expect(elementKeys(levelOf(['####', '#@Z#', '####'], { Z: { mob: shooter } })).has('laser_shooter_covered')).toBe(false);
    expect(elementKeys(levelOf(['####', '#@Z#', '####'], { Z: { mob: shooter, item: { kind: 'fish' } } })).has('laser_shooter_covered')).toBe(true);
    expect(elementKeys(levelOf(['####', '#@Z#', '####'], { Z: { mob: shooter, stack: [{ kind: 'door', color: 'red' }] } })).has('laser_shooter_covered')).toBe(true);
    expect(elementKeys(levelOf(['####', '#@Z#', '####'], { Z: { mob: shooter, stack: [{ kind: 'fire' }] } })).has('laser_shooter_covered')).toBe(true);
  });

  it('does not flag a shooter standing on ground that does nothing under it: gravel, dirt, ice, sand, water or a laser controller', () => {
    const shooter = { kind: 'laser_shooter' as const };
    for (const kind of ['gravel', 'dirt', 'ice', 'sand', 'water', 'laser_controller'] as const) {
      expect(elementKeys(levelOf(['####', '#@Z#', '####'], { Z: { mob: shooter, stack: [{ kind }] } })).has('laser_shooter_covered'), kind).toBe(false);
    }
    // An item on the same cell, a second shooter or a live layer above the ground still count.
    expect(elementKeys(levelOf(['####', '#@Z#', '####'], { Z: { mob: shooter, item: { kind: 'fish' }, stack: [{ kind: 'water' }] } })).has('laser_shooter_covered')).toBe(true);
    expect(elementKeys(levelOf(['####', '#@Z#', '####'], { Z: { mob: shooter, stack: [{ kind: 'ice' }, { kind: 'door', color: 'red' }] } })).has('laser_shooter_covered')).toBe(true);
  });

  it('plays a red socket over a socket as a flattened stack, still exact', () => {
    const level = levelOf(['####', '#@S#', '####'], { S: stacked({ kind: 'floor' }, { kind: 'socket' }, { kind: 'socket_red' }) });
    expect(classifyStack(level.cells[level.width + 2])).toBe('flattened');
    expect(classifyLevel(level).lost).toEqual([]);
  });
});

describe('stackedPairs', () => {
  it('flags water+trap as stacked and floor+trap as not, and keeps the base in the key', () => {
    const wet = levelOf(['####', '#@T#', '####'], { T: stacked({ kind: 'water' }, { kind: 'trap' }) });
    expect(elementKeys(wet).has('stacked_runtime')).toBe(true);
    expect(stackedPairs(wet).get('water+trap')).toBe(1);
    const dry = levelOf(['####', '#@T#', '####'], { T: stacked({ kind: 'floor' }, { kind: 'trap' }) });
    expect(elementKeys(dry).has('stacked_terrain')).toBe(false);
    expect(elementKeys(dry).has('stacked_runtime')).toBe(false);
    expect(stackedPairs(dry).size).toBe(0);
  });

  it('counts the stacks bottom to top with colours', () => {
    const glyphs = {
      S: stacked({ kind: 'floor' }, { kind: 'bomb' }, { kind: 'door', color: SAMPLE_COLOR }),
      T: stacked({ kind: 'water' }, { kind: 'trap' }, { kind: 'wall' })
    };
    const level = levelOf(['#####', '#@SS#', '#TS.#', '#####'], glyphs);
    const pairs = stackedPairs(level);
    expect(pairs.get('bomb+door')).toBe(3);
    expect(pairs.get('water+trap+wall')).toBe(1);
    expect(pairs.size).toBe(2);
  });
});

describe('colour channel coverage', () => {
  it('plays every colour toggle door and control, and every hold door, exactly', () => {
    for (const color of ['red', 'blue', 'yellow']) {
      expect(EPOXY_COVERAGE[`toggle_door_${color}`].level).toBe('exact');
      expect(EPOXY_COVERAGE[`toggle_control_${color}`].level).toBe('exact');
    }
    for (const color of CC3D_COLORS) expect(EPOXY_COVERAGE[`hold_door_${color}`].level).toBe('exact');
  });

  it('plays every plate and every colour block exactly (plate timelines: cc3dEvidenceDevices.test.ts), and loses none of them', () => {
    for (const color of CC3D_COLORS) {
      expect(EPOXY_COVERAGE[`plate_${color}`].level).toBe('exact');
      expect(EPOXY_COVERAGE[`block_color_${color}`].level).toBe('exact');
    }
  });
});

const CORPUS_DIR = process.env.CC3D_CORPUS_DIR;
const REPORT_FILE = process.env.CC3D_COVERAGE_REPORT;
const CORPUS_TIMEOUT_MS = 120_000;

describe.skipIf(!CORPUS_DIR)('epoxy coverage corpus report', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('classifies every level and writes the report', { timeout: CORPUS_TIMEOUT_MS }, () => {
    const dir = CORPUS_DIR as string;
    const files = readdirSync(dir)
      .filter((name) => name.toLowerCase().endsWith(CC3D_XML_EXTENSION))
      .map((name) => ({ name, bytes: new Uint8Array(readFileSync(join(dir, name))) }));
    const { levels, failures } = decodeCc3dFiles(files, 'corpus');
    expect(failures).toEqual([]);

    const perVerdict: Record<CoverageLevel, number> = { exact: 0, approx: 0, lost: 0 };
    const lostAlone: Record<string, number> = {};
    const lostUsed: Record<string, number> = {};
    const stackMaps: Record<string, number> = {};
    const stackCells: Record<string, number> = {};
    for (const compiled of levels) {
      const cc3d = compiled.cc3d;
      if (!cc3d) throw new Error(`${compiled.id} has no cc3d data`);
      const result = classifyLevel(cc3d);
      perVerdict[result.verdict] += 1;
      for (const key of result.lost) lostUsed[key] = (lostUsed[key] ?? 0) + 1;
      if (result.lost.length === 1) lostAlone[result.lost[0]] = (lostAlone[result.lost[0]] ?? 0) + 1;
      for (const [pair, count] of stackedPairs(cc3d)) {
        stackCells[pair] = (stackCells[pair] ?? 0) + count;
        stackMaps[pair] = (stackMaps[pair] ?? 0) + 1;
      }
    }
    const lost = Object.keys(lostUsed)
      .map((key) => ({ key, mapsWonIfFixedAlone: lostAlone[key] ?? 0, mapsUsing: lostUsed[key] }))
      .sort((a, b) => b.mapsWonIfFixedAlone - a.mapsWonIfFixedAlone || b.mapsUsing - a.mapsUsing || a.key.localeCompare(b.key));
    const topStacks = Object.keys(stackCells)
      .map((pair) => ({ pair, cells: stackCells[pair], maps: stackMaps[pair] }))
      .sort((a, b) => b.cells - a.cells || a.pair.localeCompare(b.pair))
      .slice(0, TOP_N_STACKS);
    const report = { maps: levels.length, perVerdict, lost, topStacks };
    expect(perVerdict.exact + perVerdict.approx + perVerdict.lost).toBe(levels.length);
    if (REPORT_FILE) writeFileSync(REPORT_FILE, JSON.stringify(report, null, 1));
    console.info(`epoxy coverage: ${levels.length} maps, ${JSON.stringify(perVerdict)}`);
  });
});
