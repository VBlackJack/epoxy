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

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { ConfigRegistry } from '../../config/ConfigRegistry';
import { isCompiledLevelShape, sanitizeStoredLevels, stripInvalidTextFields } from '../../config/ConfigValidation';
import { PACK_JSON_VERSION_V17, PACK_JSON_VERSION_V7 } from '../../config/constants';
import { parsePackJson, serializePack } from '../../packs/packJson';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { GameEngine } from '../GameEngine';
import { usesV7Ids } from '../signalLinks';
import type { CompiledLevel, Direction } from '../types';
import { cc3dLinks } from './cc3dLinks';
import { cc3dLevel, panelled, stacked, terrain } from './cc3dTestMaps';
import type { GlyphMeaning } from './cc3dTestMaps';
import { converterRuleKeys, convertCc3dLevel, CONVERTED_ID_SUFFIX } from './cc3dToEpoxy';
import type { ConversionResult } from './cc3dToEpoxy';
import { DifferentialPair } from './cc3dToEpoxyDifferential';
import { classifyLevel, classifyStack, elementKeys, EPOXY_COVERAGE } from './epoxyCoverage';
import { CC3D_COLORS, normalizeCell } from './model';
import type { Cc3dColor, Cc3dItem, Cc3dMob, Cc3dTerrain, Cc3dTerrainKind } from './model';

const SIDES: readonly Direction[] = ['N', 'E', 'S', 'W'];
const OPPOSITE: Readonly<Record<Direction, Direction>> = { N: 'S', E: 'W', S: 'N', W: 'E' };
const VECTORS: Readonly<Record<Direction, { dx: number; dy: number }>> = {
  N: { dx: 0, dy: -1 },
  E: { dx: 1, dy: 0 },
  S: { dx: 0, dy: 1 },
  W: { dx: -1, dy: 0 }
};
const CELL_GLYPH = 'Q';
const CELL_ROWS = ['#####', '#@Q.#', '#####'];
const CELL_X = 2;
const CELL_Y = 1;
const SETTLE_TICKS = 60;
const SHOT_LAUNCHER_PREFIX = 'shot_launcher_';

beforeEach(() => {
  loadTestConfigs();
});

// ---------------------------------------------------------------------- helpers

function convertRows(rows: string[], glyphs: Record<string, GlyphMeaning> = {}): { source: CompiledLevel; result: ConversionResult } {
  const source = cc3dLevel(rows, { glyphs });
  return { source, result: convertCc3dLevel(source) };
}

/** Converts a 5x3 room whose cell (2, 1) holds the given meaning. */
function convertCell(meaning: GlyphMeaning): { source: CompiledLevel; result: ConversionResult } {
  return convertRows(CELL_ROWS, { [CELL_GLYPH]: meaning });
}

function stackOf(...layers: Cc3dTerrain[]): GlyphMeaning {
  return { stack: normalizeCell(layers) };
}

function terrainAtCell(result: ConversionResult): string {
  return result.level.terrain[CELL_Y][CELL_X];
}

function underlayAtCell(result: ConversionResult): string | undefined {
  return result.level.underlays?.find((u) => u.x === CELL_X && u.y === CELL_Y)?.terrain;
}

function reportKeys(result: ConversionResult): string[] {
  return [...result.report.exact, ...result.report.approx.map((e) => e.key), ...result.report.lost.map((e) => e.key)];
}

function lostKeys(result: ConversionResult): string[] {
  return result.report.lost.map((e) => e.key);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

function tileDefinition(id: string): Record<string, unknown> {
  return ConfigRegistry.getTiles().tiles[id] as unknown as Record<string, unknown>;
}

// ------------------------------------------------------------------ mapping rows

interface TerrainCase {
  key: string;
  layers: Cc3dTerrain[];
  id: string;
}

function terrainCase(key: string, id: string, ...layers: Cc3dTerrain[]): TerrainCase {
  return { key, id, layers: layers.length > 0 ? layers : [{ kind: key as Cc3dTerrainKind }] };
}

const colored = (key: string, id: (color: Cc3dColor) => string, layer: (color: Cc3dColor) => Cc3dTerrain): TerrainCase[] =>
  CC3D_COLORS.map((color) => terrainCase(`${key}_${color}`, id(color), layer(color)));

const TERRAIN_CASES: TerrainCase[] = [
  terrainCase('floor', 'floor'),
  terrainCase('wall', 'wall'),
  terrainCase('water', 'water'),
  terrainCase('fire', 'fire'),
  terrainCase('ice', 'ice'),
  terrainCase('ice_corner', 'ice_corner_3d_ne', { kind: 'ice_corner', corner: ['N', 'E'] }),
  terrainCase('ice_corner', 'ice_corner_3d_nw', { kind: 'ice_corner', corner: ['N', 'W'] }),
  terrainCase('ice_corner', 'ice_corner_3d_se', { kind: 'ice_corner', corner: ['S', 'E'] }),
  terrainCase('ice_corner', 'ice_corner_3d_sw', { kind: 'ice_corner', corner: ['S', 'W'] }),
  ...SIDES.map((dir) => terrainCase('force', `force_${dir.toLowerCase()}`, { kind: 'force', dir })),
  terrainCase('force_random', 'force_cycle'),
  terrainCase('exit', 'exit'),
  terrainCase('socket', 'fish_gate'),
  terrainCase('socket_red', 'socket'),
  terrainCase('slime', 'slime_3d'),
  terrainCase('turtle', 'turtle'),
  terrainCase('dirt', 'dirt_3d'),
  terrainCase('gravel', 'gravel'),
  terrainCase('sand', 'sand'),
  terrainCase('teleport_red', 'teleport_turning'),
  terrainCase('teleport_blue', 'teleport_forward'),
  terrainCase('push_up_wall', 'recessed_wall'),
  terrainCase('appearing_wall', 'appearing_wall_any'),
  terrainCase('false_wall', 'blue_wall_fake'),
  ...CC3D_COLORS.map((color) => terrainCase('door', `door_${color}`, { kind: 'door', color })),
  terrainCase('toggle_door_green', 'toggle_wall_open', { kind: 'toggle_door', color: 'green', open: true }),
  terrainCase('toggle_door_green', 'toggle_wall_closed', { kind: 'toggle_door', color: 'green', open: false }),
  terrainCase('toggle_door_green', 'toggle_wall_closed', { kind: 'toggle_door', color: 'green' }),
  ...(['red', 'blue', 'yellow'] as const).flatMap((color) => [
    terrainCase(`toggle_door_${color}`, `toggle_wall_${color}_open`, { kind: 'toggle_door', color, open: true }),
    terrainCase(`toggle_door_${color}`, `toggle_wall_${color}_closed`, { kind: 'toggle_door', color, open: false }),
    terrainCase(`toggle_door_${color}`, `toggle_wall_${color}_closed`, { kind: 'toggle_door', color })
  ]),
  terrainCase('toggle_control_green', 'button_green', { kind: 'toggle_control', color: 'green' }),
  ...(['red', 'blue', 'yellow'] as const).map((color) =>
    terrainCase(`toggle_control_${color}`, `toggle_button_${color}`, { kind: 'toggle_control', color })
  ),
  ...colored('hold_door', (color) => `hold_door_${color}_closed`, (color) => ({ kind: 'hold_door', color, open: false })),
  ...colored('plate', (color) => `pressure_plate_${color}`, (color) => ({ kind: 'plate', color })),
  terrainCase('trap', 'trap'),
  terrainCase('trap_control', 'button_brown'),
  terrainCase('clone_machine', 'clone_machine', { kind: 'clone_machine', dir: 'E' }),
  terrainCase('clone_switch', 'button_red'),
  terrainCase('golem_control_blue', 'button_blue'),
  terrainCase('golem_control_yellow', 'puppet_control'),
  terrainCase('laser_controller', 'shot_trigger'),
  terrainCase('gate_tools', 'thief'),
  terrainCase('gate_keys', 'thief_keys')
];

interface ItemCase {
  key: string;
  item: Cc3dItem;
  id: string;
}

const ITEM_CASES: ItemCase[] = [
  { key: 'fish', item: { kind: 'fish' }, id: 'chip' },
  { key: 'fish_extra', item: { kind: 'fish_extra' }, id: 'chip' },
  ...CC3D_COLORS.map((color): ItemCase => ({ key: 'key', item: { kind: 'key', color }, id: `key_${color}` })),
  { key: 'orb_ice', item: { kind: 'orb_ice' }, id: 'boots_ice' },
  { key: 'orb_force', item: { kind: 'orb_force' }, id: 'boots_force' },
  { key: 'orb_fire', item: { kind: 'orb_fire' }, id: 'boots_fire' },
  { key: 'orb_water', item: { kind: 'orb_water' }, id: 'boots_water' },
  { key: 'orb_speed', item: { kind: 'orb_speed' }, id: 'slow_time' }
];

interface MobCase {
  key: string;
  mob: NonNullable<GlyphMeaning['mob']>;
  /** Entity type; null for a shooter, which becomes terrain. */
  type: string | null;
  dir?: Direction;
}

const mobCase = (key: string, type: string | null, extra: Partial<MobCase['mob']> = {}, dir?: Direction): MobCase => ({
  key,
  type,
  mob: { kind: key as Cc3dMob['kind'], dir: 'N', ...extra },
  dir
});

const MOB_CASES: MobCase[] = [
  mobCase('block_dirt', 'dirt_block_3d'),
  mobCase('block_ice', 'ice_block_3d'),
  ...CC3D_COLORS.map((color): MobCase => ({ key: `block_color_${color}`, type: `color_block_3d_${color}`, mob: { kind: 'block_color', dir: 'N', color } })),
  mobCase('reflector', 'one_sided_mirror_sw', { mirror: 'LU' }),
  mobCase('reflector', 'one_sided_mirror_nw', { mirror: 'DL' }),
  mobCase('reflector', 'one_sided_mirror_se', { mirror: 'UR' }),
  mobCase('reflector', 'one_sided_mirror_ne', { mirror: 'RD' }),
  mobCase('walker', 'walker_3d'),
  mobCase('legs_green', 'legs_green'),
  mobCase('legs_red', 'legs_red'),
  mobCase('blinky', 'blinky'),
  mobCase('baby_blinky', 'baby_blinky'),
  mobCase('limpa', 'limpa'),
  mobCase('limpy', 'limpy'),
  mobCase('bouncer', 'bouncer'),
  mobCase('omni', 'omni'),
  mobCase('screamer', 'screamer'),
  mobCase('baby_screamer', 'baby_screamer'),
  mobCase('snappy', 'snappy'),
  mobCase('nibble', 'nibble'),
  mobCase('golem_blue', 'golem_blue'),
  mobCase('golem_yellow', 'golem_yellow'),
  mobCase('laser_shooter', null),
  mobCase('bot_static', 'turret_fixed'),
  mobCase('bot_cw', 'turret_cw', {}, 'E'),
  mobCase('bot_ccw', 'turret_ccw', {}, 'W'),
  mobCase('bot_multi', 'turret_multi')
];

interface StructuralCase {
  key: string;
  build: () => { source: CompiledLevel; result: ConversionResult };
  check: (result: ConversionResult) => void;
}

const STRUCTURAL_CASES: StructuralCase[] = [
  {
    key: 'stacked_terrain',
    build: () => convertCell(stackOf({ kind: 'ice' }, { kind: 'door', color: 'red' })),
    check: (result) => {
      expect(terrainAtCell(result)).toBe('door_red');
      expect(underlayAtCell(result)).toBe('ice');
    }
  },
  {
    key: 'stacked_runtime',
    build: () => convertCell(stackOf({ kind: 'plate', color: 'red' }, { kind: 'false_wall' })),
    check: (result) => {
      expect(terrainAtCell(result)).toBe('blue_wall_fake');
      expect(result.level.underlays).toBeUndefined();
      expect(lostKeys(result)).toContain('stacked_runtime');
    }
  },
  {
    key: 'panels_on_nonfloor',
    build: () => convertCell({ stack: [{ kind: 'water' }], panels: ['N', 'W'] }),
    check: (result) => {
      expect(terrainAtCell(result)).toBe('water');
      expect(result.level.cellEdges).toEqual([{ x: CELL_X, y: CELL_Y, sides: ['N', 'W'] }]);
    }
  },
  {
    key: 'socket_red_stacked',
    build: () => convertCell(stackOf({ kind: 'sand' }, { kind: 'socket_red' })),
    check: (result) => {
      expect(terrainAtCell(result)).toBe('socket');
    }
  },
  {
    key: 'trap_unworked',
    // A control works the next trap only: the second trap is worked by nothing and is sealed (a map with no control at all keeps the plain trap).
    build: () =>
      convertRows(['#######', '#@bTU.#', '#######'], {
        b: stackOf({ kind: 'trap_control' }),
        T: stackOf({ kind: 'trap' }),
        U: stackOf({ kind: 'trap' })
      }),
    check: (result) => {
      expect(result.level.trapLinks).toHaveLength(1);
      expect(result.level.terrain[1][4]).toBe('trap_sealed');
      expect(lostKeys(result)).not.toContain('trap_unworked');
      expect(result.report.exact).toContain('trap_unworked');
    }
  },
  {
    key: 'orbs_over_cap',
    build: () =>
      convertRows(['########', '#@afwos#', '########'], {
        a: { item: { kind: 'orb_ice' } },
        f: { item: { kind: 'orb_fire' } },
        w: { item: { kind: 'orb_water' } },
        o: { item: { kind: 'orb_force' } },
        s: { item: { kind: 'orb_speed' } }
      }),
    check: (result) => {
      expect(result.report.approx.map((e) => e.key)).toContain('orbs_over_cap');
    }
  },
  {
    key: 'monsters_meet',
    build: () => convertRows(['#######', '#@b.cX#', '#######'], { b: { mob: { kind: 'bouncer', dir: 'E' } }, c: { mob: { kind: 'bouncer', dir: 'W' } } }),
    check: (result) => {
      expect(result.report.approx.map((e) => e.key)).toContain('monsters_meet');
    }
  },
  {
    key: 'appearing_wall_with_monster',
    build: () => convertRows(['######', '#@VbX#', '######'], { V: terrain('appearing_wall'), b: { mob: { kind: 'bouncer', dir: 'E' } } }),
    check: (result) => {
      expect(result.report.approx.map((e) => e.key)).toContain('appearing_wall_with_monster');
    }
  },
  {
    key: 'clone_switch_empty',
    build: () => convertRows(['######', '#@xc.#', '######'], { x: stackOf({ kind: 'clone_switch' }), c: stackOf({ kind: 'clone_machine', dir: 'E' }) }),
    check: (result) => {
      expect(result.level.cloneLinks).toEqual([]);
      expect(result.report.drops).toEqual([{ key: 'clone_switch_empty', x: 2, y: 1 }]);
      expect(lostKeys(result)).toContain('clone_switch_empty');
    }
  },
  {
    key: 'bomb_with_item',
    build: () => convertCell({ stack: normalizeCell([{ kind: 'bomb' }]), item: { kind: 'fish' } }),
    check: (result) => {
      expect(result.level.items[CELL_Y][CELL_X]).toBe('chip');
      expect(terrainAtCell(result)).toBe('floor');
      expect(result.report.drops).toEqual([{ key: 'bomb_with_item', x: CELL_X, y: CELL_Y }]);
      expect(lostKeys(result)).toContain('bomb_with_item');
    }
  },
  {
    key: 'bomb_buried',
    build: () => convertCell(stackOf({ kind: 'bomb' }, { kind: 'socket' })),
    check: (result) => {
      expect(result.level.items[CELL_Y][CELL_X]).toBe('bomb');
      expect(result.report.approx.map((e) => e.key)).toContain('bomb_buried');
    }
  },
  {
    key: 'laser_shooter_covered',
    build: () => convertCell({ item: { kind: 'fish' }, mob: { kind: 'laser_shooter', dir: 'E' } }),
    check: (result) => {
      expect(terrainAtCell(result)).toBe('shot_launcher_e');
      expect(result.level.items[CELL_Y][CELL_X]).toBeNull();
      expect(result.level.chipsRequired).toBe(0);
      expect(lostKeys(result)).toContain('laser_shooter_covered');
    }
  },
  {
    key: 'gravel_with_reflector',
    build: () => convertRows(['#######', '#@Gr..#', '#######'], { r: { mob: { kind: 'reflector', mirror: 'LU' } } }),
    check: (result) => {
      expect(result.level.terrain[CELL_Y][CELL_X]).toBe('gravel');
      expect(result.level.entities.map((e) => e.type)).toEqual(['one_sided_mirror_sw']);
      expect(result.report.approx.map((e) => e.key)).toContain('gravel_with_reflector');
      expect(result.report.exact).toContain('gravel');
    }
  }
];

describe('mapping rows', () => {
  it.each(TERRAIN_CASES.map((c) => [`${c.key} -> ${c.id}`, c] as const))('terrain %s', (_name, { key, layers, id }) => {
    const { source, result } = convertCell(stackOf(...layers));
    expect(terrainAtCell(result)).toBe(id);
    expect(result.level.items[CELL_Y][CELL_X]).toBeNull();
    expect(elementKeys(source.cc3d as never).has(key)).toBe(true);
    expect(reportKeys(result)).toContain(key);
  });

  it('plays a bomb layer as the bomb item over plain floor', () => {
    const { source, result } = convertCell(stackOf({ kind: 'bomb' }));
    expect(terrainAtCell(result)).toBe('floor');
    expect(result.level.items[CELL_Y][CELL_X]).toBe('bomb');
    expect(reportKeys(result)).toContain('bomb');
    expect(elementKeys(source.cc3d as never).has('bomb')).toBe(true);
  });

  it.each(ITEM_CASES.map((c) => [`${c.item.kind} ${c.item.color ?? ''} -> ${c.id}`, c] as const))('item %s', (_name, { key, item, id }) => {
    const { source, result } = convertCell({ item });
    expect(result.level.items[CELL_Y][CELL_X]).toBe(id);
    expect(terrainAtCell(result)).toBe('floor');
    expect(elementKeys(source.cc3d as never).has(key)).toBe(true);
    expect(reportKeys(result)).toContain(key);
  });

  it.each(MOB_CASES.map((c) => [`${c.key} ${c.mob.mirror ?? ''} -> ${c.type ?? 'launcher'}`, c] as const))('mob %s', (_name, { key, mob, type, dir }) => {
    const { source, result } = convertCell({ mob: { ...mob, dir: mob.kind === 'laser_shooter' ? 'E' : mob.dir } });
    expect(elementKeys(source.cc3d as never).has(key)).toBe(true);
    expect(reportKeys(result)).toContain(key);
    if (type === null) {
      expect(result.level.entities).toEqual([]);
      expect(terrainAtCell(result)).toBe('shot_launcher_e');
    } else {
      expect(result.level.entities).toEqual([{ x: CELL_X, y: CELL_Y, type, dir: dir ?? 'N' }]);
      expect(terrainAtCell(result)).toBe('floor');
    }
  });

  it.each(STRUCTURAL_CASES.map((c) => [c.key, c] as const))('structural key %s', (_name, { key, build, check }) => {
    const { source, result } = build();
    expect(reportKeys(result)).toContain(key);
    expect(elementKeys(source.cc3d as never).has(key)).toBe(true);
    check(result);
  });

  it('drops a bomb buried under a plate, which is inert, without a loss and without an item', () => {
    const { result } = convertCell(stackOf({ kind: 'bomb' }, { kind: 'plate', color: 'green' }));
    expect(result.level.items[CELL_Y][CELL_X]).toBeNull();
    expect(result.report.drops).toEqual([]);
    expect(result.report.approx.map((e) => e.key)).not.toContain('bomb_buried');
  });

  it('keeps the same set of keys in the coverage table, the converter rules and the fixtures (no drift)', () => {
    const fixtureKeys = new Set<string>([
      ...TERRAIN_CASES.map((c) => c.key),
      'bomb',
      ...ITEM_CASES.map((c) => c.key),
      ...MOB_CASES.map((c) => c.key),
      ...STRUCTURAL_CASES.map((c) => c.key)
    ]);
    const coverageKeys = Object.keys(EPOXY_COVERAGE).sort();
    expect([...fixtureKeys].sort()).toEqual(coverageKeys);
    expect(converterRuleKeys()).toEqual(coverageKeys);
  });
});

// ------------------------------------------------------------ arbitration rules

describe('arbitration rules', () => {
  it('seals a trap no control works, and links the one a control works', () => {
    const { source, result } = convertRows(['#######', '#@bT.U#', '#######'], {
      b: stackOf({ kind: 'trap_control' }),
      T: stackOf({ kind: 'trap' }),
      U: stackOf({ kind: 'trap' })
    });
    expect(result.level.trapLinks).toEqual([{ buttonX: 2, buttonY: 1, trapX: 3, trapY: 1 }]);
    expect(result.level.terrain[1].filter((id) => id === 'trap_sealed')).toHaveLength(1);
    expect(result.level.terrain[1][5]).toBe('trap_sealed');
    expect(result.level.terrain[1][3]).toBe('trap');
    expect(lostKeys(result)).not.toContain('trap_unworked');
    expect(classifyLevel(source.cc3d as never).lost).not.toContain('trap_unworked');
  });

  it('records a clone switch with an empty machine as lost and emits no link for it', () => {
    const { result } = convertRows(['#######', '#@x.cM#', '#######'], {
      x: stackOf({ kind: 'clone_switch' }),
      c: stackOf({ kind: 'clone_machine', dir: 'E' }),
      M: { stack: normalizeCell([{ kind: 'clone_machine', dir: 'W' }]), mob: { kind: 'walker', dir: 'E' } }
    });
    // The switch is nearest to the empty machine at x = 4, so it is dropped even though another machine has a template.
    expect(result.level.cloneLinks).toEqual([]);
    expect(lostKeys(result)).toContain('clone_switch_empty');
  });

  it('treats a shooter used as a clone template as lost', () => {
    const { result } = convertRows(['######', '#@xc.#', '######'], {
      x: stackOf({ kind: 'clone_switch' }),
      c: { stack: normalizeCell([{ kind: 'clone_machine', dir: 'E' }]), mob: { kind: 'laser_shooter', dir: 'E' } }
    });
    expect(result.level.cloneLinks).toEqual([]);
    expect(result.level.entities).toEqual([]);
    expect(lostKeys(result)).toEqual(expect.arrayContaining(['clone_switch_empty', 'laser_shooter_covered']));
  });

  it('asks for the plain fish only, and only when a socket exists', () => {
    const rows = ['#######', '#@ie.S#', '#######'];
    const withSocket = convertRows(rows, {});
    expect(withSocket.result.level.chipsRequired).toBe(1);
    expect(withSocket.result.level.items[1].filter((id) => id === 'chip')).toHaveLength(2);
    const noSocket = convertRows(['#######', '#@ie..#', '#######'], {});
    expect(noSocket.result.level.chipsRequired).toBe(0);
    expect(noSocket.result.level.items[1].filter((id) => id === 'chip')).toHaveLength(2);
    const hiddenSocket = convertRows(['#######', '#@ie.Q#', '#######'], { Q: stackOf({ kind: 'ice' }, { kind: 'socket' }) });
    expect(hiddenSocket.result.level.chipsRequired).toBe(1);
  });

  it('puts a non-floor layer under a shooter in the ledger and drops the underlay of that cell', () => {
    const { result } = convertCell({ stack: normalizeCell([{ kind: 'ice' }, { kind: 'door', color: 'red' }]), mob: { kind: 'laser_shooter', dir: 'S' } });
    expect(terrainAtCell(result)).toBe('shot_launcher_s');
    expect(result.level.underlays).toBeUndefined();
    expect(result.report.drops).toEqual([{ key: 'laser_shooter_covered', x: CELL_X, y: CELL_Y }]);
    expect(lostKeys(result)).toContain('laser_shooter_covered');
  });

  it('leaves a shooter on plain floor untouched by the ledger', () => {
    const { result } = convertCell({ mob: { kind: 'laser_shooter', dir: 'W' } });
    expect(result.report.drops).toEqual([]);
    expect(lostKeys(result)).not.toContain('laser_shooter_covered');
  });

  it('drops a bomb under an item and keeps the item', () => {
    const { result } = convertCell({ stack: normalizeCell([{ kind: 'ice' }, { kind: 'bomb' }]), item: { kind: 'key', color: 'red' } });
    expect(terrainAtCell(result)).toBe('ice');
    expect(result.level.items[CELL_Y][CELL_X]).toBe('key_red');
    expect(lostKeys(result)).toContain('bomb_with_item');
  });

  it('flattens a socket over a socket, of either colour, to the top one and loses nothing', () => {
    for (const [layers, expected] of [
      [[{ kind: 'socket' }, { kind: 'socket' }], 'fish_gate'],
      [[{ kind: 'socket_red' }, { kind: 'socket' }], 'fish_gate'],
      [[{ kind: 'socket' }, { kind: 'socket_red' }], 'socket'],
      [[{ kind: 'socket_red' }, { kind: 'socket_red' }], 'socket']
    ] as Array<[Cc3dTerrain[], string]>) {
      const { result } = convertCell({ stack: [{ kind: 'floor' }, ...layers] });
      expect(terrainAtCell(result)).toBe(expected);
      expect(result.level.underlays).toBeUndefined();
      expect(lostKeys(result)).toEqual([]);
    }
    const onIce = convertCell({ stack: [{ kind: 'ice' }, { kind: 'socket' }, { kind: 'socket_red' }] });
    expect(terrainAtCell(onIce.result)).toBe('socket');
    expect(underlayAtCell(onIce.result)).toBe('ice');
  });

  it('classifies a red socket over a socket as flattened', () => {
    expect(classifyStack({ terrain: [{ kind: 'floor' }, { kind: 'socket' }, { kind: 'socket_red' }], panels: [], item: null })).toBe('flattened');
  });

  it('words the teleport reasons around the exit direction, and gives legs and screamers their own', () => {
    for (const key of ['teleport_red', 'teleport_blue']) expect(EPOXY_COVERAGE[key].reason).toMatch(/exit/);
    expect(EPOXY_COVERAGE.teleport_red.reason).not.toBe(EPOXY_COVERAGE.teleport_blue.reason);
    const own = new Set(['legs_green', 'legs_red', 'screamer', 'baby_screamer'].map((key) => EPOXY_COVERAGE[key].reason));
    expect(own.size).toBe(4);
    expect(own).not.toContain(EPOXY_COVERAGE.walker.reason);
    expect(EPOXY_COVERAGE.legs_green.reason).toMatch(/immun/);
    expect(EPOXY_COVERAGE.screamer.reason).toMatch(/ice and force/);
  });

  it('uses the machine direction for the clone template, else the template direction', () => {
    const withDir = convertRows(['######', '#@xc.#', '######'], {
      x: stackOf({ kind: 'clone_switch' }),
      c: { stack: normalizeCell([{ kind: 'clone_machine', dir: 'S' }]), mob: { kind: 'block_color', color: 'red', dir: 'E' } }
    });
    expect(withDir.result.level.cloneLinks).toEqual([
      { buttonX: 2, buttonY: 1, clonerX: 3, clonerY: 1, templateType: 'color_block_3d_red', templateDir: 'S' }
    ]);
    expect(withDir.result.level.entities).toEqual([{ x: 3, y: 1, type: 'color_block_3d_red', dir: 'E' }]);
    const without = convertRows(['######', '#@xc.#', '######'], {
      x: stackOf({ kind: 'clone_switch' }),
      c: { stack: normalizeCell([{ kind: 'clone_machine' }]), mob: { kind: 'walker', dir: 'W' } }
    });
    expect(without.result.level.cloneLinks[0].templateDir).toBe('W');
  });

  it('writes a hold door in the state its plates call for at load', () => {
    const hold: GlyphMeaning = stackOf({ kind: 'hold_door', color: 'green', open: true });
    const plate: GlyphMeaning = stackOf({ kind: 'plate', color: 'green' });
    const doorOf = (rows: string[], glyphs: Record<string, GlyphMeaning>): string =>
      convertRows(rows, { H: hold, ...glyphs }).result.level.terrain[1][1];
    // No plate: closed, whatever the source says.
    expect(doorOf(['#####', '#H@.#', '#####'], {})).toBe('hold_door_green_closed');
    // A plate nobody stands on: closed.
    expect(doorOf(['######', '#H@p.#', '######'], { p: plate })).toBe('hold_door_green_closed');
    // The only plate is pressed by a block: open.
    expect(doorOf(['######', '#H@p.#', '######'], { p: { ...plate, mob: { kind: 'block_dirt' } } })).toBe('hold_door_green_open');
    // Two plates, one pressed: closed. Both pressed: open.
    expect(doorOf(['#######', '#H@pq.#', '#######'], { p: { ...plate, mob: { kind: 'block_dirt' } }, q: plate })).toBe('hold_door_green_closed');
    expect(
      doorOf(['#######', '#H@pq.#', '#######'], {
        p: { ...plate, mob: { kind: 'block_dirt' } },
        q: { ...plate, mob: { kind: 'block_ice' } }
      })
    ).toBe('hold_door_green_open');
    // Epoxy monsters press a plate they stand on unless they fly; the puppet the yellow golem becomes does too.
    expect(doorOf(['######', '#H@p.#', '######'], { p: { ...plate, mob: { kind: 'walker' } } })).toBe('hold_door_green_open');
    expect(doorOf(['######', '#H@p.#', '######'], { p: { ...plate, mob: { kind: 'blinky' } } })).toBe('hold_door_green_closed');
    expect(doorOf(['######', '#H@p.#', '######'], { p: { ...plate, mob: { kind: 'golem_yellow' } } })).toBe('hold_door_green_open');
    // A colour block presses only a plate of its own colour.
    expect(doorOf(['######', '#H@p.#', '######'], { p: { ...plate, mob: { kind: 'block_color', color: 'red' } } })).toBe('hold_door_green_closed');
    expect(doorOf(['######', '#H@p.#', '######'], { p: { ...plate, mob: { kind: 'block_color', color: 'green' } } })).toBe('hold_door_green_open');
  });

  it('keeps a hold door open under a blue golem, as the Epoxy engine does', () => {
    const rows = ['#######', '#H@p..#', '#######'];
    const glyphs: Record<string, GlyphMeaning> = {
      H: stackOf({ kind: 'hold_door', color: 'red', open: false }),
      p: { ...stackOf({ kind: 'plate', color: 'red' }), mob: { kind: 'golem_blue' } }
    };
    const { result } = convertRows(rows, glyphs);
    expect(result.level.terrain[1][1]).toBe('hold_door_red_open');
    const engine = new GameEngine();
    engine.loadLevel(result.level);
    expect(engine.getTerrain()[1][1]).toBe('hold_door_red_open');
    // A flying monster on the plate does not hold the door.
    const flyer = convertRows(rows, { ...glyphs, p: { ...glyphs.p, mob: { kind: 'blinky' } } }).result;
    expect(flyer.level.terrain[1][1]).toBe('hold_door_red_closed');
  });

  it('presses a hold door plate with the player standing on it', () => {
    const level = cc3dLevel(['######', '#H@..#', '######'], {
      glyphs: { H: stackOf({ kind: 'hold_door', color: 'red', open: false }), '@': stackOf({ kind: 'plate', color: 'red' }) }
    });
    expect(convertCc3dLevel(level).level.terrain[1][1]).toBe('hold_door_red_open');
  });

  it('chooses an ice corner by the entry directions its tile blocks', () => {
    for (const first of ['N', 'S'] as const) {
      for (const second of ['E', 'W'] as const) {
        const { result } = convertCell({ stack: [{ kind: 'ice_corner', corner: [first, second] }] });
        const tile = tileDefinition(terrainAtCell(result));
        const blocked = (tile.blockedEntryDirections as string[]).slice().sort();
        // A closed side stops whoever enters from it: moving the opposite way.
        expect(blocked).toEqual([OPPOSITE[first], OPPOSITE[second]].sort());
      }
    }
  });

  it('refuses an ice corner that is not a corner', () => {
    expect(() => convertCell({ stack: [{ kind: 'ice_corner', corner: ['N', 'S'] }] })).toThrow(/ice_corner/);
  });

  it('writes the thin wall that blocks exactly the panel sides, and no cell edge for it', () => {
    for (let mask = 1; mask < 1 << SIDES.length; mask++) {
      const sides = SIDES.filter((_, bit) => (mask & (1 << bit)) !== 0);
      const { result } = convertCell(panelled(...sides));
      const tile = tileDefinition(terrainAtCell(result));
      expect([...(tile.blockedEdges as string[])].sort()).toEqual([...sides].sort());
      expect(result.level.cellEdges).toBeUndefined();
    }
  });

  it('turns a rotating turret one quarter turn in the sense of its rotation', () => {
    for (const dir of SIDES) {
      const cw = convertCell({ mob: { kind: 'bot_cw', dir } });
      const ccw = convertCell({ mob: { kind: 'bot_ccw', dir } });
      const index = SIDES.indexOf(dir);
      expect(cw.result.level.entities[0].dir).toBe(SIDES[(index + 1) % SIDES.length]);
      expect(ccw.result.level.entities[0].dir).toBe(SIDES[(index + SIDES.length - 1) % SIDES.length]);
    }
  });

  it('keeps blocks that start on water or fire as entities', () => {
    const { result } = convertRows(['#######', '#@WF..#', '#######'], {
      W: { stack: [{ kind: 'water' }], mob: { kind: 'block_dirt', dir: 'N' } },
      F: { stack: [{ kind: 'fire' }], mob: { kind: 'block_color', color: 'red', dir: 'N' } }
    });
    expect(result.level.terrain[1].slice(2, 4)).toEqual(['water', 'fire']);
    expect(result.level.entities.map((e) => e.type)).toEqual(['dirt_block_3d', 'color_block_3d_red']);
    expect(result.level.terrain.flat().some((id) => id.startsWith('floating_block'))).toBe(false);
  });

  it('does not sink or melt them when Epoxy loads the level', () => {
    const { result } = convertRows(['#######', '#@WF..#', '#######'], {
      W: { stack: [{ kind: 'water' }], mob: { kind: 'block_dirt', dir: 'N' } },
      F: { stack: [{ kind: 'fire' }], mob: { kind: 'block_ice', dir: 'N' } }
    });
    const engine = new GameEngine();
    engine.loadLevel(result.level, 1);
    for (let i = 0; i < SETTLE_TICKS; i++) engine.tick();
    expect(engine.getEntities().map((e) => [e.type, e.x, e.y])).toEqual([
      ['dirt_block_3d', 2, 1],
      ['ice_block_3d', 3, 1]
    ]);
    expect(engine.getTerrain()[1].slice(2, 4)).toEqual(['water', 'fire']);
  });

  it('hands the player the exit of the previous teleport in reading order, as CC3D does', () => {
    const { source, result } = convertRows(['##########', '#@.t.t...#', '##########'], {});
    const pair = new DifferentialPair(source, result.level, 1);
    pair.step('E');
    pair.step('E');
    // Onto the teleport at x = 3: out of the one at x = 5, one cell on.
    expect(pair.compare()).toBeNull();
    expect(pair.epoxy.getPlayer().x).toBe(6);
    pair.step('E');
    expect(pair.compare()).toBeNull();
    expect(pair.epoxy.getPlayer().x).toBe(7);
  });

  it('does not compare chips on a level with fish and no socket', () => {
    const { source, result } = convertRows(['#####', '#@i.#', '#####'], {});
    expect(result.level.chipsRequired).toBe(0);
    const pair = new DifferentialPair(source, result.level, 1);
    pair.step('E');
    pair.step('E');
    expect(pair.rig.engine.getChipsRemaining()).toBe(0);
    expect(pair.compare()).toBeNull();
    const left = convertRows(['#####', '#@.i#', '#####'], {});
    const idle = new DifferentialPair(left.source, left.result.level, 1);
    expect(left.source.cc3d?.cells.some((c) => c.item?.kind === 'fish')).toBe(true);
    expect(idle.rig.engine.getChipsRemaining()).toBe(1);
    expect(idle.epoxy.getChipsRemaining()).toBe(0);
    expect(idle.compare()).toBeNull();
  });

  it('deflects at an ice corner exactly as CC3D does, from every side', () => {
    const corners: Array<[Direction, Direction]> = [
      ['N', 'E'],
      ['N', 'W'],
      ['S', 'E'],
      ['S', 'W']
    ];
    let deflected = 0;
    for (const corner of corners) {
      for (const dir of SIDES) {
        const start = { x: 3 - VECTORS[dir].dx, y: 3 - VECTORS[dir].dy };
        const rows = Array.from({ length: 7 }, (_, y) =>
          Array.from({ length: 7 }, (_, x) => (x === 0 || y === 0 || x === 6 || y === 6 ? '#' : x === 3 && y === 3 ? 'C' : x === start.x && y === start.y ? '@' : '.')).join('')
        );
        const source = cc3dLevel(rows, { glyphs: { C: { stack: [{ kind: 'ice_corner', corner }] } } });
        const converted = convertCc3dLevel(source).level;
        const pair = new DifferentialPair(source, converted, 1);
        pair.step(dir);
        expect(pair.compare(), `${corner.join('')} entered moving ${dir}`).toBeNull();
        const player = pair.epoxy.getPlayer();
        if (player.x !== start.x || player.y !== start.y) deflected += 1;
      }
    }
    // Per corner, two of the four entries are open: eight in all.
    expect(deflected).toBe(8);
  });

  /** Presses the direction that points at the cell from where the player stands, preferring the long axis. */
  const towards = (from: { x: number; y: number }, to: { x: number; y: number }): Direction => {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 'E' : 'W';
    return dy > 0 ? 'S' : 'N';
  };

  const turningRows = ['#########', '#.......#', '#.......#', '#...?...#', '#...@...#', '#.......#', '#########'];

  it('turns a random force floor into the Turning Force Floor, which plays the same over several arrivals', () => {
    const source = cc3dLevel(turningRows);
    const converted = convertCc3dLevel(source).level;
    expect(converted.terrain.flat()).toContain('force_cycle');
    expect(converted.terrain.flat()).not.toContain('force_random');
    const pair = new DifferentialPair(source, converted, 1);
    const target = { x: 4, y: 3 };
    const pushed = new Set<string>();
    for (let i = 0; i < 12; i++) {
      pair.step(towards(pair.epoxy.getPlayer(), target));
      expect(pair.compare(), `arrival ${i + 1}`).toBeNull();
      const p = pair.epoxy.getPlayer();
      pushed.add(`${p.x},${p.y}`);
    }
    // The four directions were all handed out, so the player did not stay on one cell.
    expect(pushed.size).toBeGreaterThan(3);
  });

  it('counts the arrival of a protected player, as CC3D does', () => {
    const rows = ['#########', '#.......#', '#.......#', '#...?...#', '#..o@...#', '#.......#', '#########'];
    const source = cc3dLevel(rows, { glyphs: { o: { item: { kind: 'orb_force' } } } });
    const converted = convertCc3dLevel(source).level;
    const pair = new DifferentialPair(source, converted, 1);
    const target = { x: 4, y: 3 };
    pair.step('W');
    expect(pair.compare()).toBeNull();
    for (let i = 0; i < 10; i++) {
      pair.step(towards(pair.epoxy.getPlayer(), target));
      expect(pair.compare(), `arrival ${i + 1}`).toBeNull();
    }
  });

  it('classes the random force floor as exact and writes the converted level as pack format 7', () => {
    expect(EPOXY_COVERAGE.force_random.level).toBe('exact');
    const { level } = convertCc3dLevel(cc3dLevel(turningRows));
    expect(usesV7Ids(level)).toBe(true);
    const text = serializePack('Pack', [level]);
    expect((JSON.parse(text) as { version: number }).version).toBe(PACK_JSON_VERSION_V7);
    const parsed = parsePackJson(text, ConfigRegistry.getLevelSizeBounds(), new Set(), Date.now, undefined, ConfigRegistry.getLevelTextLimits());
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.levels).toEqual([level]);
  });
});

// ------------------------------------------------------------------- properties

const RICH_ROWS = [
  '################',
  '#@.ie.S.Xp.WC.O#',
  '#.bTbU.c.x.zZ..#',
  '#t..k.1.r.JB.H.#',
  '#.t..k...K.%.q.#',
  '################'
];

const RICH_GLYPHS: Record<string, GlyphMeaning> = {
  p: panelled('E', 'S'),
  W: { stack: [{ kind: 'water' }], panels: ['N'] },
  C: terrain('ice_corner', { corner: ['N', 'E'] }),
  b: stacked({ kind: 'floor' }, { kind: 'trap_control' }),
  T: stacked({ kind: 'floor' }, { kind: 'trap' }),
  U: stacked({ kind: 'floor' }, { kind: 'trap' }),
  c: { stack: [{ kind: 'floor' }, { kind: 'clone_machine', dir: 'E' }], mob: { kind: 'walker', dir: 'E' } },
  x: stacked({ kind: 'floor' }, { kind: 'clone_switch' }),
  z: { mob: { kind: 'laser_shooter', dir: 'W' } },
  q: { mob: { kind: 'laser_shooter', dir: 'N' } },
  Z: stacked({ kind: 'floor' }, { kind: 'laser_controller' }),
  B: stacked({ kind: 'floor' }, { kind: 'toggle_control', color: 'green' }),
  '%': stacked({ kind: 'floor' }, { kind: 'plate', color: 'green' })
};

function richLevel(): CompiledLevel {
  return cc3dLevel(RICH_ROWS, { glyphs: RICH_GLYPHS });
}

describe('relation keys agree between the table and the converter', () => {
  const RELATION = ['trap_unworked', 'clone_switch_empty', 'bomb_with_item', 'laser_shooter_covered'];
  const cases: Array<[string, string[], Record<string, GlyphMeaning>]> = [
    ['unworked trap', ['#######', '#@bT.U#', '#######'], { b: stackOf({ kind: 'trap_control' }), T: stackOf({ kind: 'trap' }), U: stackOf({ kind: 'trap' }) }],
    ['two shooters in one cell', ['#####', '#@..#', '#####'], {}],
    ['plain room', ['#####', '#@..#', '#####'], {}]
  ];
  for (const [name, rows, glyphs] of cases) {
    it(`gives the same relation keys for: ${name}`, () => {
      const source = cc3dLevel(rows, { glyphs });
      if (name === 'two shooters in one cell') {
        const cc3d = source.cc3d as NonNullable<CompiledLevel['cc3d']>;
        cc3d.mobs.push({ kind: 'laser_shooter', x: 2, y: 1, dir: 'E' }, { kind: 'laser_shooter', x: 2, y: 1, dir: 'W' });
      }
      const result = convertCc3dLevel(source);
      const table = classifyLevel(source.cc3d as never).lost.filter((key) => RELATION.includes(key)).sort();
      const converter = result.report.lost.map((e) => e.key).filter((key) => RELATION.includes(key)).sort();
      expect(converter).toEqual(table);
      if (name === 'unworked trap') {
        expect(result.level.terrain[1][5]).toBe('trap_sealed');
        expect(result.report.drops.filter((drop) => drop.key === 'trap_unworked')).toEqual([]);
      }
    });
  }
});

describe('properties of a conversion', () => {
  it('names the converted level after its source and carries no cc3d data', () => {
    const source = richLevel();
    const { level } = convertCc3dLevel(source);
    expect(level.id).toBe(`${source.id}${CONVERTED_ID_SUFFIX}`);
    expect(level.ruleset).toBe('epoxy');
    expect('cc3d' in level).toBe(false);
    expect(level.timeLimitSeconds).toBe(0);
    expect(level.number).toBe(source.number);
    expect(level.playerStart).toEqual({ x: 1, y: 1, dir: 'W' });
  });

  it('keeps the title and the author, and defaults the start facing to west', () => {
    const source = { ...richLevel(), customTitle: 'Name', author: 'Someone' };
    const { level } = convertCc3dLevel(source);
    expect(level.customTitle).toBe('Name');
    expect(level.author).toBe('Someone');
    expect(level.playerStart.dir).toBe('W');
    const faced = richLevel();
    (faced.cc3d as { player: { dir?: Direction } }).player.dir = 'E';
    expect(convertCc3dLevel(faced).level.playerStart.dir).toBe('E');
  });

  it('throws for a level without cc3d data', () => {
    const source = { ...richLevel(), cc3d: undefined };
    expect(() => convertCc3dLevel(source)).toThrow(/cc3d/);
  });

  it('never mutates the input: a deep-frozen level converts and stays equal to its copy', () => {
    const source = richLevel();
    const copy = structuredClone(source);
    deepFreeze(source);
    convertCc3dLevel(source);
    expect(source).toEqual(copy);
  });

  it('is deterministic', () => {
    const first = convertCc3dLevel(richLevel());
    const second = convertCc3dLevel(richLevel());
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('survives the stored-level checks unchanged', () => {
    const { level } = convertCc3dLevel(richLevel());
    const bounds = ConfigRegistry.getLevelSizeBounds();
    expect(isCompiledLevelShape(level, bounds, true)).toBe(true);
    expect(stripInvalidTextFields(level)).toBe(level);
    expect(sanitizeStoredLevels([level], bounds, ConfigRegistry.getLevelTextLimits())).toEqual([level]);
  });

  it('round trips through a pack file of the version of the newest id it uses', () => {
    const { level } = convertCc3dLevel(richLevel());
    expect(level.launcherLinks?.length).toBeGreaterThan(0);
    const text = serializePack('Pack', [level]);
    expect((JSON.parse(text) as { version: number }).version).toBe(PACK_JSON_VERSION_V17);
    const parsed = parsePackJson(text, ConfigRegistry.getLevelSizeBounds(), new Set(), Date.now, undefined, ConfigRegistry.getLevelTextLimits());
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.levels).toEqual([level]);
  });

  it('resolves every id and uses no cc3d_ id', () => {
    const { level } = convertCc3dLevel(richLevel());
    const tiles = ConfigRegistry.getTiles().tiles;
    for (const id of level.terrain.flat()) expect(tiles[id]?.layer, id).toBe('terrain');
    for (const id of level.items.flat()) if (id !== null) expect(tiles[id]?.layer, id).toBe('item');
    for (const entity of level.entities) expect(ConfigRegistry.getEntityDef(entity.type), entity.type).toBeDefined();
    for (const link of level.cloneLinks) expect(ConfigRegistry.getEntityDef(link.templateType), link.templateType).toBeDefined();
    const all = [...level.terrain.flat(), ...level.items.flat(), ...level.entities.map((e) => e.type), ...(level.underlays ?? []).map((u) => u.terrain)];
    expect(all.filter((id) => id !== null && id.startsWith('cc3d_'))).toEqual([]);
  });

  it('has as many mobs as entities and launchers', () => {
    const source = richLevel();
    const { level } = convertCc3dLevel(source);
    const launchers = level.terrain.flat().filter((id) => id.startsWith(SHOT_LAUNCHER_PREFIX)).length;
    expect(source.cc3d?.mobs.length).toBe(level.entities.length + launchers);
    expect(launchers).toBe(2);
  });

  it('has as many chips as fish and extra fish', () => {
    const source = richLevel();
    const { level } = convertCc3dLevel(source);
    const fish = source.cc3d?.cells.filter((c) => c.item?.kind === 'fish' || c.item?.kind === 'fish_extra').length;
    expect(level.items.flat().filter((id) => id === 'chip').length).toBe(fish);
    expect(level.chipsRequired).toBe(1);
  });

  it('rebuilds the panels from thin wall ids and cell edges', () => {
    const source = richLevel();
    const cc3d = source.cc3d as NonNullable<CompiledLevel['cc3d']>;
    const { level } = convertCc3dLevel(source);
    let panelled = 0;
    cc3d.cells.forEach((cell, index) => {
      const x = index % cc3d.width;
      const y = Math.floor(index / cc3d.width);
      const id = level.terrain[y][x];
      const fromId = id.startsWith('thin_wall_') ? (tileDefinition(id).blockedEdges as Direction[]) : [];
      const fromEdges = level.cellEdges?.find((e) => e.x === x && e.y === y)?.sides ?? [];
      const rebuilt = SIDES.filter((side) => fromId.includes(side) || fromEdges.includes(side));
      expect(rebuilt, `${x},${y}`).toEqual(cell.panels);
      if (cell.panels.length > 0) panelled += 1;
    });
    expect(panelled).toBe(2);
  });

  it('emits trap, clone and launcher links equal to the ones the CC3D engine resolves', () => {
    const source = richLevel();
    const cc3d = source.cc3d as NonNullable<CompiledLevel['cc3d']>;
    const links = cc3dLinks(cc3d);
    const point = (index: number) => ({ x: index % cc3d.width, y: Math.floor(index / cc3d.width) });
    const { level } = convertCc3dLevel(source);
    expect(level.trapLinks).toEqual(
      links.trapControls.map((l) => ({ buttonX: point(l.from).x, buttonY: point(l.from).y, trapX: point(l.to as number).x, trapY: point(l.to as number).y }))
    );
    expect(level.cloneLinks).toEqual(
      links.cloneSwitches.map((l) => ({
        buttonX: point(l.from).x,
        buttonY: point(l.from).y,
        clonerX: point(l.to as number).x,
        clonerY: point(l.to as number).y,
        templateType: 'walker_3d',
        templateDir: 'E'
      }))
    );
    expect(level.launcherLinks).toEqual(
      links.laserControllers.map((l) => ({
        buttonX: point(l.from).x,
        buttonY: point(l.from).y,
        launcherX: cc3d.mobs[l.to as number].x,
        launcherY: cc3d.mobs[l.to as number].y
      }))
    );
  });

  it('gives each teleport the previous teleport of its colour, which is the CC3D link rule', () => {
    const source = richLevel();
    const cc3d = source.cc3d as NonNullable<CompiledLevel['cc3d']>;
    const { level } = convertCc3dLevel(source);
    for (const id of ['teleport_turning', 'teleport_forward']) {
      const cells: number[] = [];
      level.terrain.forEach((row, y) => row.forEach((cell, x) => cell === id && cells.push(y * cc3d.width + x)));
      const expected = cc3dLinks(cc3d).teleports.filter((l) => cells.includes(l.from));
      // Epoxy takes the previous teleport of the colour in reading order, wrapping from the first to the last.
      const previous = cells.map((from, i) => ({ from, to: cells[(i + cells.length - 1) % cells.length] }));
      expect(previous).toEqual(expected);
      expect(cells.length).toBeGreaterThan(1);
    }
  });

  it('reports the exact, approximate and lost keys of the source', () => {
    const { source, report } = (() => {
      const s = richLevel();
      return { source: s, report: convertCc3dLevel(s).report };
    })();
    const verdict = classifyLevel(source.cc3d as never);
    expect(report.approx.map((e) => e.key)).toEqual(expect.arrayContaining(verdict.approx));
    expect(report.lost.map((e) => e.key)).toEqual(expect.arrayContaining(verdict.lost));
    for (const entry of [...report.approx, ...report.lost]) expect(entry.reason.length).toBeGreaterThan(0);
  });
});
